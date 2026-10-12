import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JobSchema } from '@featherduster/core';
import type { Context, Hono } from 'hono';
import type { IntakePreview } from './intake.js';
import { RepositoryError } from './repository.js';
import { jobDetail, publicJobsResult, type JobsRuntime } from './runtime.js';

const uuid = z.string().uuid();
const revision = z.number().int().nonnegative();
const key = z.string().trim().min(1);
export const jobFilters = JobSchema.pick({ preparation_state: true, application_lifecycle: true, kind: true }).partial().strict();
export const preparationRequest = z.object({ expected_revision: revision, input_snapshot_id: uuid, idempotency_key: key }).strict();
export function mountJobsRoutes(app: Hono, getRuntime: () => JobsRuntime) {
  const previews = new Map<string, { preview: IntakePreview; expires: number; fallback?: string; revision?: number }>();
  const handle = (fn: (c: Context, runtime: JobsRuntime) => unknown | Promise<unknown>, status: 200 | 201 | 202 = 200) => async (c: Context) => {
    try { const runtime = getRuntime(); const result = await fn(c, runtime); runtime.flushEvents(); return result instanceof Response ? result : c.json(publicJobsResult(result), status); }
    catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ code: 'invalid_request', error: 'Invalid request', ...(error instanceof z.ZodError ? { issues: error.issues } : {}) }, 400);
      if (error instanceof RepositoryError) return c.json({ code: error.code, error: error.message }, error.code === 'not_found' ? 404 : error.code === 'invalid_relationship' ? 400 : error.code === 'corrupt_data' ? 500 : 409);
      return c.json({ code: 'internal_error', error: 'Jobs operation failed' }, 500);
    }
  };
  const checkFallback = (r: JobsRuntime, id?: string, rev?: number) => { if (id && r.repository.getJob(id).revision !== rev) throw new RepositoryError('revision_conflict', 'Stale fallback revision'); };
  app.get('/api/jobs', handle((c, r) => { const filters = jobFilters.parse(c.req.query()); return { jobs: r.repository.listJobs().filter(job => Object.entries(filters).every(([k, v]) => job[k as keyof typeof job] === v)) }; }));
  app.post('/api/jobs/preview', handle(async (c, r) => {
    const body = z.object({ mode: z.enum(['urls', 'text']), input: z.string().min(1), fallback_job_id: uuid.optional(), expected_revision: revision.optional() }).strict().refine(v => !v.fallback_job_id || (v.mode === 'text' && v.expected_revision !== undefined)).parse(await c.req.json());
    checkFallback(r, body.fallback_job_id, body.expected_revision);
    for (const [id, entry] of previews) if (entry.expires <= Date.now()) previews.delete(id);
    while (previews.size >= 100) previews.delete(previews.keys().next().value!);
    const preview = await r.intake.preview(body); const preview_id = randomUUID();
    previews.set(preview_id, { preview, expires: Date.now() + 600000, fallback: body.fallback_job_id, revision: body.expected_revision });
    return { preview_id, preview };
  }));
  app.post('/api/jobs', handle(async (c, r) => {
    const body = z.object({ preview_id: uuid, idempotency_key: key }).strict().parse(await c.req.json());
    const entry = previews.get(body.preview_id);
    if (!entry || entry.expires <= Date.now()) throw new RepositoryError('not_found', 'Preview expired or unknown');
    // Replayed commits must remain acknowledgements even after a fallback changed revision.
    const receipt = r.repository.database.db.prepare("SELECT 1 FROM mutation_receipts WHERE operation='intake' AND idempotency_key=?").get(`${body.idempotency_key}:0`);
    if (!receipt) checkFallback(r, entry.fallback, entry.revision);
    const items = r.intake.commit(entry.preview, body.idempotency_key);
    if (items.some(i => i.disposition !== 'error' && i.disposition !== 'duplicate' && !('replayed' in i && i.replayed))) r.service.durableEnqueue();
    const conflict = items.find(i => i.error && ['revision_conflict', 'idempotency_conflict', 'ineligible', 'invalid_ownership'].includes(i.error.code));
    if (conflict?.error) return c.json(publicJobsResult({ code: conflict.error.code, error: conflict.error.message, items }), 409);
    const failure = items.find(i => i.error && ['corrupt_data', 'commit_failed'].includes(i.error.code));
    if (failure) return c.json(publicJobsResult({ code: 'internal_error', error: 'Intake commit failed', items }), 500);
    return { items };
  }));
  app.get('/api/jobs/control', handle((_c, r) => r.service.status()));
  for (const action of ['start', 'stop', 'pause'] as const) app.post(`/api/jobs/control/${action}`, handle(async (c, r) => {
    const body = z.object({ idempotency_key: key }).strict().parse(await c.req.json());
    return action === 'start' ? r.service.startAutomaticPreparation(body.idempotency_key) : action === 'stop' ? r.service.stopProcessing(body.idempotency_key) : r.service.pauseAfterCurrent(body.idempotency_key);
  }));
  app.get('/api/jobs/:id', handle((c, r) => jobDetail(r, uuid.parse(c.req.param('id')))));
  app.put('/api/jobs/:id', handle(async (c, r) => {
    const id = uuid.parse(c.req.param('id'));
    const body = z.object({ expected_revision: revision, changes: JobSchema.pick({ company: true, role: true, employer_id: true, base_resume_id: true, template_id: true, runner: true }).partial().strict() }).strict().parse(await c.req.json());
    return { job: r.repository.updateJob({ ...r.repository.getJob(id), ...body.changes }, body.expected_revision) };
  }));
  app.post('/api/jobs/:id/inputs', handle(async (c, r) => {
    const body = z.object({ expected_revision: revision, base_resume_id: z.string().min(1).optional(), template_id: z.string().min(1).optional(), runner: z.enum(['claude-code', 'codex', 'anthropic-api', 'ollama', 'fake']).optional(), evidence_ids: z.array(z.string().min(1)).optional() }).strict().parse(await c.req.json());
    return { input_snapshot: r.captureInputs(uuid.parse(c.req.param('id')), body.expected_revision, body) };
  }, 201));
  for (const action of ['prepare', 'resume', 'retry'] as const) app.post(`/api/jobs/:id/${action}`, handle(async (c, r) => r.service[action]({ ...preparationRequest.parse(await c.req.json()), job_id: uuid.parse(c.req.param('id')) }), 202));
}
