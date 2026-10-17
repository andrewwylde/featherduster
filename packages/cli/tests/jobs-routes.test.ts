import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceStore } from '@featherduster/core';
import { createApp } from '../src/server.js';
import { createJobsRuntime, type JobsRuntime } from '../src/jobs/runtime.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { defaultRunnerFactory, type RunnerFactory } from '../src/runners/registry.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); vi.useRealTimers(); });
function fixture(runnerFactory?: RunnerFactory) {
  const root = mkdtempSync(path.join(tmpdir(), 'jobs-api-'));
  mkdirSync(path.join(root, 'resumes/templates'), { recursive: true });
  writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify({ profile: { name: 'Test', title: 'Engineer', email: 'a@b.com' }, experiences: [], education: [], skills: [] }));
  let runtime!: JobsRuntime;
  const run = vi.fn(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const evidence = new EvidenceStore([{ entry: { id: 'ev-one', date: '2026-01-01', company: 'acme', title: 'Systems', summary: 'Built systems', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Preserve this narrative' }]);
  const app = createApp(root, {
    jobsRuntimeFactory: (w, d) => runtime = createJobsRuntime(w, d),
    jobsDependencies: { automaticDrain: false,
      loadEvidence: () => evidence,
      runnerFactory: runnerFactory ?? (() => ({ id: 'fake', model: 'fake', label: 'Fake', locality: 'local', detect: async () => ({ available: true, detail: '' }), run })),
      fetcher: async url => { if (url.includes('unavailable')) throw new Error('Unavailable'); return { original_url: url, html: '<html><body>Engineer posting</body></html>', final_url: url, retrieved_at: new Date().toISOString() }; },
      renderer: { preflight: async () => ({ available: true, tools: [], diagnostics: [] }), renderPdf: async () => ({ status: 'passed', source: 'latex', pdf: Buffer.from('pdf'), previews: [{ page: 1, mimeType: 'image/png', bytes: Buffer.from('png') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] }) },
    },
  });
  cleanup.push(async () => { await app.disposeJobs(); rmSync(root, { recursive: true, force: true }); });
  const request = (url: string, body?: unknown, method = 'POST') => app.request(url, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const add = async () => { const p = await (await request('/api/jobs/preview', { mode: 'text', input: 'Build systems' })).json(); const res = await request('/api/jobs', { preview_id: p.preview_id, idempotency_key: randomUUID() }); return (await res.json()).items[0].job_id as string; };
  return { root, app, request, add, run, evidence, runtime: () => runtime };
}
it.each(['codex', 'claude-code'] as const)('prepares with the %s CLI default model saved in the input snapshot', async runnerId => {
  const run = vi.fn(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const f = fixture((id, config) => {
    const runner = defaultRunnerFactory(id, config);
    if (runner) {
      runner.detect = async () => ({ available: true, detail: 'Installed and signed in' });
      runner.run = run;
    }
    return runner;
  });
  expect((await f.request('/api/settings/runner', { default: runnerId, [runnerId]: { model: '' } }, 'PUT')).status).toBe(200);
  expect((await f.request('/api/runners/consent', { runner: runnerId })).status).toBe(200);
  const id = await f.add(); const job = f.runtime().repository.getJob(id);
  const capture = await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision });
  expect(capture.status).toBe(201);
  const input = (await capture.json()).input_snapshot;
  const saved = f.runtime().repository.database.files.readSnapshot(input.runner_configuration, id, input.id);
  expect(JSON.parse(saved.toString())).toEqual({ runner: runnerId, model: '' });
  // Live settings must not replace the saved CLI-default choice on execution.
  await f.request('/api/settings/runner', { [runnerId]: { model: 'new-live-model' } }, 'PUT');
  expect((await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'cli-default' })).status).toBe(202);
  await f.runtime().service.worker.whenIdle();
  expect(f.runtime().repository.getJob(id).preparation_state).toBe('resume_ready');
  expect(run).toHaveBeenCalledTimes(4);
});
it('still rejects an Ollama runner without an explicit model', async () => {
  const f = fixture(defaultRunnerFactory);
  await f.request('/api/settings/runner', { default: 'ollama', ollama: { model: '' } }, 'PUT');
  const id = await f.add(); const job = f.runtime().repository.getJob(id);
  const capture = await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision });
  expect(capture.status).toBe(400);
  expect(await capture.json()).toMatchObject({ code: 'invalid_relationship', error: 'Configure a runner and model first' });
  expect(f.runtime().repository.database.db.prepare('SELECT COUNT(*) AS count FROM input_snapshots').get()).toEqual({ count: 0 });
});
it('preview is read-only, commit preserves identity, replay and forged tokens are safe', async () => {
  const f = fixture();
  const p = await (await f.request('/api/jobs/preview', { mode: 'text', input: 'Build things' })).json();
  expect((await (await f.request('/api/jobs')).json()).jobs).toEqual([]);
  const body = { preview_id: p.preview_id, idempotency_key: 'add' };
  expect((await (await f.request('/api/jobs', body)).json()).items[0].job_id).toBeTruthy();
  expect((await (await f.request('/api/jobs', body)).json()).items[0].replayed).toBe(true);
  expect((await f.request('/api/jobs', { ...body, preview_id: randomUUID() })).status).toBe(404);
  expect((await f.request('/api/jobs', { ...body, preview: p.preview })).status).toBe(400);
  expect(f.run).not.toHaveBeenCalled();
});
it('validates filters, JSON, strict shapes, revisions and protects localhost', async () => {
  const f = fixture(); const id = await f.add();
  expect((await f.request('/api/jobs?kind=bad')).status).toBe(400);
  expect((await f.request('/api/jobs?kind=job')).status).toBe(200);
  expect((await f.app.request('/api/jobs/preview', { method: 'POST', body: '{' })).status).toBe(400);
  for (const expected_revision of [undefined, -1, '0']) expect((await f.request(`/api/jobs/${id}`, { expected_revision, changes: { company: 'Acme' } }, 'PUT')).status).toBe(400);
  expect((await f.request(`/api/jobs/${id}`, { expected_revision: 0, changes: { preparation_state: 'preparing' } }, 'PUT')).status).toBe(400);
  const job = (await (await f.request(`/api/jobs/${id}`)).json()).job;
  expect((await f.request(`/api/jobs/${id}`, { expected_revision: job.revision, changes: { company: 'Acme' } }, 'PUT')).status).toBe(200);
  expect((await f.request(`/api/jobs/${id}`, { expected_revision: job.revision, changes: { company: 'Wrong' } }, 'PUT')).status).toBe(409);
  expect((await (await f.request(`/api/jobs/${id}`)).json()).job.company).toBe('Acme');
  expect((await f.app.request('/api/jobs', { headers: { Host: 'evil.example' } })).status).toBe(403);
  expect((await f.app.request('/api/jobs', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
});
it('captures inputs without work, enforces bindings and replays preparation without credentials', async () => {
  const f = fixture(); const id = await f.add(); const other = await f.add();
  const job = f.runtime().repository.getJob(id);
  const capture = await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision });
  expect(capture.status).toBe(201);
  const input = (await capture.json()).input_snapshot;
  expect(f.runtime().repository.database.files.readSnapshot(input.selected_evidence[0], id, input.id).toString()).toContain('Preserve this narrative');
  expect(f.run).not.toHaveBeenCalled();
  expect((await f.request(`/api/jobs/${other}/prepare`, { expected_revision: f.runtime().repository.getJob(other).revision, input_snapshot_id: input.id, idempotency_key: 'foreign' })).status).toBe(400);
  const body = { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'prepare' };
  const prepared = await f.request(`/api/jobs/${id}/prepare`, body);
  expect(prepared.status).toBe(202); expect(await prepared.text()).not.toContain('owner_token');
  await f.runtime().service.worker.whenIdle();
  expect((await f.request(`/api/jobs/${id}/prepare`, body)).status).toBe(202);
  expect(f.run).toHaveBeenCalledTimes(4);
  expect((await f.request(`/api/jobs/${id}/resume`, { ...body, expected_revision: f.runtime().repository.getJob(id).revision, idempotency_key: 'invalid-resume' })).status).toBe(409);
  expect(await (await f.request(`/api/jobs/${id}`)).text()).not.toContain('owner_token');
});
it('persists start, pause and stop without implicitly clearing stop on reopen', async () => {
  const f = fixture();
  for (const action of ['start', 'pause', 'stop']) expect((await f.request(`/api/jobs/control/${action}`, { idempotency_key: action })).status).toBe(200);
  await f.app.disposeJobs();
  const db = openJobsDatabase(f.root);
  try { const control = new JobsRepository(db).getControl(); expect(control.stopped_at).not.toBeNull(); expect(control.stop_generation).toBe(1); expect(control.automatic_preparation_enabled).toBe(false); } finally { db.close(); }
});
it('expires preview tokens and retains valid neighbors in URL batches', async () => {
  const f = fixture();
  const p = await (await f.request('/api/jobs/preview', { mode: 'urls', input: 'https://example.com/job\nnot-a-url' })).json();
  const items = (await (await f.request('/api/jobs', { preview_id: p.preview_id, idempotency_key: 'batch' })).json()).items;
  expect(items).toHaveLength(2); expect(items[1].disposition).toBe('error'); expect(items[0].job_id).toBeTruthy();
  const duplicate = await (await f.request('/api/jobs/preview', { mode: 'urls', input: 'https://example.com/job' })).json();
  expect(duplicate.preview.items[0].duplicate_id).toBe(items[0].job_id);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);
  expect((await f.request('/api/jobs', { preview_id: p.preview_id, idempotency_key: 'batch' })).status).toBe(404);
  vi.restoreAllMocks();
});
it('fans committed events out once and reconciles external writes on the existing SSE stream', async () => {
  const f = fixture(); const id = await f.add();
  vi.useFakeTimers();
  const a = (await f.app.request('/api/events')).body!.getReader();
  const b = (await f.app.request('/api/events')).body!.getReader();
  const read = async (reader: typeof a) => new TextDecoder().decode((await reader.read()).value);
  expect(await read(a)).toContain('event: connected'); expect(await read(b)).toContain('event: connected');
  await Promise.resolve();
  const events: string[] = []; const off = f.runtime().subscribe(e => events.push(e.id));
  const db = openJobsDatabase(f.root);
  try {
    const r = new JobsRepository(db); const job = r.getJob(id);
    r.transitionApplication(id, 'draft', job.revision, 'external');
  } finally { db.close(); }
  await vi.advanceTimersByTimeAsync(5001);
  const frameA = await read(a); const frameB = await read(b);
  expect(frameA).toContain('event: jobs'); expect(frameB).toBe(frameA);
  f.runtime().flushEvents(); expect(events).toHaveLength(1);
  await a.cancel(); off(); await b.cancel();
});
it('rejects stale fallback previews and commits while allowing identical commit retries', async () => {
  const f = fixture();
  const p = await (await f.request('/api/jobs/preview', { mode: 'urls', input: 'https://example.com/unavailable' })).json();
  const id = (await (await f.request('/api/jobs', { preview_id: p.preview_id, idempotency_key: 'failed-fetch' })).json()).items[0].job_id;
  const revision = f.runtime().repository.getJob(id).revision;
  const fallback = { mode: 'text', input: 'Captured posting', fallback_job_id: id, expected_revision: revision };
  expect((await f.request('/api/jobs/preview', { ...fallback, expected_revision: revision + 1 })).status).toBe(409);
  const a = await (await f.request('/api/jobs/preview', fallback)).json();
  const b = await (await f.request('/api/jobs/preview', fallback)).json();
  const commit = { preview_id: a.preview_id, idempotency_key: 'fallback' };
  expect((await f.request('/api/jobs', commit)).status).toBe(200);
  expect((await f.request('/api/jobs', commit)).status).toBe(200);
  expect((await f.request('/api/jobs', { preview_id: b.preview_id, idempotency_key: 'stale-fallback' })).status).toBe(409);
});
it('reports conflicting intake keys and rejects missing snapshots and unknown input selections', async () => {
  const f = fixture();
  for (const [input, status] of [['First', 200], ['Second', 409]] as const) {
    const p = await (await f.request('/api/jobs/preview', { mode: 'text', input })).json();
    expect((await f.request('/api/jobs', { preview_id: p.preview_id, idempotency_key: 'same-key' })).status).toBe(status);
  }
  const id = await f.add(); const job = f.runtime().repository.getJob(id);
  expect((await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: randomUUID(), idempotency_key: 'missing' })).status).toBe(404);
  for (const selection of [{ base_resume_id: 'no' }, { evidence_ids: ['no'] }, { template_id: 'no' }]) {
    expect((await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision, ...selection })).status).toBe(400);
  }
  expect(f.run).not.toHaveBeenCalled();
});
it('does not capture the synthetic starter when no valid persisted base resume exists', async () => {
  const f = fixture(); const id = await f.add();
  rmSync(path.join(f.root, 'resumes/templates/base.json'));
  writeFileSync(path.join(f.root, 'resumes/templates/starter.yaml'), 'not a valid resume');
  const revision = f.runtime().repository.getJob(id).revision;
  expect((await f.request(`/api/jobs/${id}/inputs`, { expected_revision: revision })).status).toBe(400);
  expect(f.run).not.toHaveBeenCalled();
});
it('saves scope-bound answers without starting work and rejects stale or foreign scopes', async () => {
  const f = fixture(); const id = await f.add(); const job = f.runtime().repository.getJob(id);
  const body = { expected_revision: job.revision, key: 'salary', question: 'Expected salary?', scope: { kind: 'job', job_id: id }, status: 'confirmed', value: 100000 };
  const saved = await f.request(`/api/jobs/${id}/answers`, body, 'PUT');
  expect(saved.status).toBe(200);
  expect((await saved.json()).answer.confirmed_at).toBeTruthy();
  expect((await f.request(`/api/jobs/${id}/answers`, body, 'PUT')).status).toBe(409);
  expect((await f.request(`/api/jobs/${id}/answers`, { ...body, expected_revision: job.revision + 1, scope: { kind: 'employer', employer_id: 'foreign' } }, 'PUT')).status).toBe(400);
  const detail = await (await f.request(`/api/jobs/${id}`)).json();
  expect(detail.answers).toHaveLength(1); expect(detail.analysis).toBeNull(); expect(f.run).not.toHaveBeenCalled();
});
it('serves verified historical review and bytes, binds approvals and forks editable drafts', async () => {
  const f = fixture(); const id = await f.add(); const other = await f.add();
  const job = f.runtime().repository.getJob(id);
  const input = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision })).json()).input_snapshot;
  expect((await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'prepare-review' })).status).toBe(202);
  await f.runtime().service.worker.whenIdle();
  const detail = await (await f.request(`/api/jobs/${id}`)).json(); const artifact = detail.artifacts[0];
  const prefix = `/api/jobs/${id}/artifacts/${artifact.id}`;
  const response = await f.request(`${prefix}/review`); expect(response.status).toBe(200);
  const review = await response.json(); expect(review.base_resume.profile.name).toBe('Test'); expect(review.preview_count).toBe(1);
  expect((await f.request(`${prefix}/pdf`)).headers.get('Content-Type')).toBe('application/pdf');
  expect(await (await f.request(`${prefix}/previews/1`)).text()).toBe('png');
  expect((await f.request(`${prefix}/previews/0`)).status).toBe(400);
  expect((await f.request(`${prefix}/previews/2`)).status).toBe(404);
  expect((await f.request(`/api/jobs/${other}/artifacts/${artifact.id}/review`)).status).toBe(400);
  const binding = { expected_job_revision: detail.job.revision, artifact_fingerprint: artifact.version_fingerprint, idempotency_key: 'approve-review', input_snapshot_id: input.id, input_fingerprint: input.fingerprint };
  expect((await f.request(`${prefix}/approve`, binding)).status).toBe(200);
  expect((await f.request(`${prefix}/approve`, binding)).status).toBe(200);
  const forkBody = { expected_job_revision: detail.job.revision, artifact_fingerprint: artifact.version_fingerprint, idempotency_key: 'fork-review' };
  const fork = await (await f.request(`${prefix}/continue-editing`, forkBody)).json();
  const draftUrl = `/api/jobs/${id}/drafts/${fork.draft.id}`;
  expect((await f.request(`/api/jobs/${other}/drafts/${fork.draft.id}`)).status).toBe(400);
  const save = { expected_revision: fork.draft.revision, candidate: { ...fork.draft.candidate, summary: 'Edited locally' } };
  expect((await f.request(draftUrl, save, 'PUT')).status).toBe(200);
  expect((await f.request(draftUrl, save, 'PUT')).status).toBe(409);
  expect((await (await f.request(`${prefix}/review`)).json()).draft.candidate.summary).not.toBe('Edited locally');
  writeFileSync(path.join(f.root, artifact.pdf.id), 'tampered');
  expect((await f.request(`${prefix}/review`)).status).toBe(500);
  expect((await f.request(`${prefix}/pdf`)).status).toBe(500);
});

it('cancels a queued job via POST /api/jobs/:id/cancel and rejects stale revisions', async () => {
  const f = fixture();
  const id = await f.add();
  const repo = f.runtime().repository;
  const saved = repo.getJob(id);
  repo.transitionPreparation(id, 'prepare', saved.revision, 'legacy-admission');
  const original = repo.getJob(id);
  const res = await f.request(`/api/jobs/${id}/cancel`, {
    expected_revision: original.revision,
    idempotency_key: 'cancel-op',
    reason: 'Not interested anymore',
  });
  expect(res.status).toBe(202);
  const updated = repo.getJob(id);
  expect(updated.preparation_state).toBe('cancelled');
  expect(updated.state_reason).toBe('Not interested anymore');

  const stale = await f.request(`/api/jobs/${id}/cancel`, {
    expected_revision: original.revision,
    idempotency_key: 'cancel-stale',
  });
  expect(stale.status).toBe(409);
});


it('captures applicable selected-source support once, independent of later withdrawals and source edits', async () => {
  const f = fixture(); const id = await f.add(); const runtime = f.runtime();
  const view = runtime.corpus.read(); const source = view.records[0];
  const request = { workspace_id: view.workspace_id, expected_revision: 0, idempotency_key: 'learn', explanation: 'Systems are backend work', change: { kind: 'skill_support' as const, value: { skill: 'backend', facet: 'systems', permitted_terms: ['backend'], support: 'direct' as const, scope: { kind: 'workspace' as const }, sources: [{ evidence_id: source.source.id, evidence_fingerprint: source.fingerprint, quote: 'Built systems' }], explanation: 'Systems' } } };
  const update = runtime.corpus.remember(request).result;
  const job = runtime.repository.getJob(id);
  const input = runtime.captureInputs(id, job.revision);
  const captured = runtime.artifacts.capturedContext(input.id);
  expect(captured.skillSupport).toHaveLength(1);
  expect(captured.knowledge.materialized?.sources[0].entry).toEqual(source.source.entry);
  expect(runtime.artifacts.capturedContext(runtime.captureInputs(id, job.revision, { evidence_ids: [] }).id).skillSupport).toEqual([]);
  runtime.corpus.withdraw({ ...request, expected_revision: 1, idempotency_key: 'withdraw', change: { kind: 'withdrawal', update_id: update.id, reason: 'Withdraw' } });
  f.evidence.add({ ...source.source.entry, summary: 'Changed source', confidence: 'retracted' }, 'Changed narrative');
  expect(runtime.artifacts.capturedContext(input.id).skillSupport).toEqual(captured.skillSupport);
  const fresh = runtime.captureInputs(id, job.revision);
  expect(fresh.fingerprint).not.toBe(input.fingerprint);
  expect(runtime.artifacts.capturedContext(fresh.id).skillSupport).toEqual([]);
  // Execution sees frozen support, not the now-withdrawn live relationship.
  f.run.mockResolvedValueOnce({ company: '', role: '', seniority: '', mission: '', requirements: [{ id: 'r', tier: 'must', text: 'backend', quote: 'Build systems', terms: ['backend'] }] } as any)
    .mockResolvedValueOnce({ rows: [] } as any)
    .mockResolvedValueOnce({ proposals: [{ id: 'p', type: 'summary.rewrite', target: {}, after: 'Built backend', citations: ['ev-one'] }] } as any);
  expect((await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'captured' })).status).toBe(202);
  await runtime.service.worker.whenIdle();
  expect(runtime.repository.getJob(id).preparation_state).toBe('resume_ready');
  expect(f.run).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(f.run.mock.calls)).toContain('backend');
});

it('rejects changed captured knowledge before constructing or calling a runner', async () => {
  const factory = vi.fn(() => ({ id: 'fake' as const, model: 'fake', label: 'Fake', locality: 'local' as const, detect: vi.fn(async () => ({ available: true, detail: '' })), run: vi.fn() }));
  const f = fixture(factory); const id = await f.add(); const runtime = f.runtime(); const job = runtime.repository.getJob(id);
  const input = runtime.captureInputs(id, job.revision); factory.mockClear();
  writeFileSync(path.join(f.root, input.corpus_knowledge!.id), 'changed');
  await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'changed' });
  await runtime.service.worker.whenIdle();
  expect(factory).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});

it('exposes strict zero-model review transport, exact admission, and explicit input refresh', async () => {
  const f = fixture(); const id = await f.add();
  const input = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: f.runtime().repository.getJob(id).revision })).json()).input_snapshot;
  await f.request(`/api/jobs/${id}/prepare`, { expected_revision: f.runtime().repository.getJob(id).revision, input_snapshot_id: input.id, idempotency_key: 'first' });
  await f.runtime().service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(4);
  const view = await (await f.request(`/api/jobs/${id}/proposals`)).json();
  expect(view.availability).toBe('available'); expect(JSON.stringify(view)).not.toContain('owner_token');
  const binding = () => ({ expected_job_revision: f.runtime().repository.getJob(id).revision, expected_review_revision: view.review.revision, input_fingerprint: input.fingerprint });
  const url = `/api/jobs/${id}/proposals/${view.review.id}`;
  for (const extra of [{ ready: true }, { job_id: id }, { candidate_preview: {} }, { recorded_by: 'human' }]) {
    expect((await f.request(url, { ...binding(), patches: [], groundings: [], feedback_kind: 'rejection', explanation: '', idempotency_key: 'invalid', ...extra }, 'PUT')).status).toBe(400);
  }
  expect((await f.app.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
  expect((await f.request(`${url}/recheck`, { ...binding(), input_fingerprint: 'foreign' })).status).toBe(400);
  const foreign = await f.add();
  expect((await f.request(`/api/jobs/${foreign}/proposals/${view.review.id}/recheck`, binding())).status).toBe(409);
  const save = { ...binding(), patches: [], groundings: [], feedback_kind: 'rejection', explanation: '', idempotency_key: 'save' };
  const savedResponse = await f.request(url, save, 'PUT'); expect(savedResponse.status).toBe(200);
  const saved = (await savedResponse.json()).result; view.review = saved.review;
  expect((await f.request(url, save, 'PUT')).status).toBe(200);
  expect((await f.request(url, { ...save, explanation: 'changed' }, 'PUT')).status).toBe(409);
  expect((await f.request(`${url}/recheck`, binding())).status).toBe(200);
  expect(f.run).toHaveBeenCalledTimes(4);
  const controls = await (await f.request('/api/jobs/control')).json(); expect(controls).toHaveProperty('needs_review_count');
  await f.request('/api/jobs/control/stop', { idempotency_key: 'stop' });
  const continuation = { ...binding(), validation_fingerprint: saved.review.validation.fingerprint, idempotency_key: 'continue' };
  expect((await f.request(`${url}/continue`, continuation)).status).toBe(409);
  await f.request('/api/jobs/control/start', { idempotency_key: 'start' }); await f.runtime().service.worker.whenIdle();
  const admitted = await f.request(`${url}/continue`, continuation); expect(admitted.status).toBe(202); expect(await admitted.text()).not.toContain('owner_token');
  await f.runtime().service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(5);
  expect((await f.request(`${url}/continue`, continuation)).status).toBe(202);
  const refreshed = await f.request(`/api/jobs/${id}/inputs`, { expected_revision: f.runtime().repository.getJob(id).revision }); expect(refreshed.status).toBe(201);
  const nextInput = (await refreshed.json()).input_snapshot;
  expect((await (await f.request(`/api/jobs/${id}/proposals`)).json()).input_stale).toBe(true);
  expect((await f.request(`${url}/recheck`, binding())).status).toBe(409);
  expect(f.run).toHaveBeenCalledTimes(5);
  expect((await f.request(`/api/jobs/${id}/reprepare`, { expected_revision: f.runtime().repository.getJob(id).revision, input_snapshot_id: nextInput.id, idempotency_key: 'new-version' })).status).toBe(202);
  await f.runtime().service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(9);
});
it('saves remembered review corrections in the same transaction and emits corpus only once', async () => {
  const f = fixture(); const id = await f.add(); const runtime = f.runtime();
  const input = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: runtime.repository.getJob(id).revision })).json()).input_snapshot;
  await f.request(`/api/jobs/${id}/prepare`, { expected_revision: runtime.repository.getJob(id).revision, input_snapshot_id: input.id, idempotency_key: 'prepare' }); await runtime.service.worker.whenIdle();
  const view = await (await f.request(`/api/jobs/${id}/proposals`)).json();
  const record = runtime.corpus.read().records[0]; const listener = vi.fn(); const unsub = runtime.subscribeCorpus(listener);
  const change = { kind: 'skill_support', value: { skill: 'backend', facet: 'applications', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'workspace' }, sources: [{ evidence_id: record.source.id, evidence_fingerprint: record.fingerprint, quote: 'Built systems' }], explanation: 'Application systems' } };
  const url = `/api/jobs/${id}/proposals/${view.review.id}`;
  const request = { expected_job_revision: runtime.repository.getJob(id).revision, expected_review_revision: 0, input_fingerprint: input.fingerprint, patches: [], groundings: [], feedback_kind: 'grounding', explanation: 'Application systems', remember: { expected_corpus_revision: 0, change }, idempotency_key: 'remember' };
  const response = await f.request(url, request, 'PUT'); expect(response.status).toBe(200);
  const saved = (await response.json()).result; expect(saved.corpus_revision).toBe(1);
  expect(saved.review.corpus_update_ids).toEqual([saved.update.id]); expect(listener).toHaveBeenCalledTimes(1);
  expect((await (await f.request('/api/corpus')).json()).snapshot.updates).toHaveLength(1);
  expect((await f.request(url, request, 'PUT')).status).toBe(200); runtime.flushEvents(); expect(listener).toHaveBeenCalledTimes(1);
  expect(f.run).toHaveBeenCalledTimes(4); unsub();
});

it('HTTP saving neither wakes unrelated work nor requests preparation', async () => {
  const f = fixture();
  await f.request('/api/jobs/control/start', { idempotency_key: 'enable' });
  const runtime = f.runtime();
  await runtime.service.worker.whenIdle();
  const wake = vi.spyOn(runtime.service, 'durableEnqueue');
  const control = runtime.repository.getControl();
  const id = await f.add();
  const reopened = await (await f.request(`/api/jobs/${id}`)).json();
  expect(reopened.job.preparation_state).toBe('saved');
  expect(reopened.job.current_attempt_id).toBeNull();
  expect(reopened.posting.text).toBe('Build systems');
  expect(wake).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
  expect(runtime.repository.getControl()).toEqual(control);
});

it('saves manual context without capture, versions posting edits and rejects stale or conflicting retries', async () => {
  const f = fixture(() => null);
  rmSync(path.join(f.root, 'resumes'), { recursive: true, force: true });
  const details = { company: 'Manual Co', role: 'Systems engineer', notes: 'Ask about team', context_url: 'https://example.com/position' };
  const p = await (await f.request('/api/jobs/preview', { mode: 'text', input: 'Original posting', details })).json();
  const saved = await (await f.request('/api/jobs', { preview_id: p.preview_id, idempotency_key: 'manual' })).json();
  const id = saved.items[0].job_id;
  const before = await (await f.request(`/api/jobs/${id}`)).json();
  expect(before.job).toMatchObject({ ...details, preparation_state: 'saved' });
  const body = { expected_revision: before.job.revision, idempotency_key: 'edit-details', changes: { notes: 'Updated notes' }, posting_text: 'Revised posting' };
  expect((await f.request(`/api/jobs/${id}/details`, body, 'PUT')).status).toBe(200);
  expect((await f.request(`/api/jobs/${id}/details`, body, 'PUT')).status).toBe(200);
  expect((await f.request(`/api/jobs/${id}/details`, { ...body, posting_text: 'Wrong' }, 'PUT')).status).toBe(409);
  expect((await f.request(`/api/jobs/${id}/details`, { ...body, idempotency_key: 'stale' }, 'PUT')).status).toBe(409);
  const after = await (await f.request(`/api/jobs/${id}`)).json();
  expect(after.job).toMatchObject({ ...details, notes: 'Updated notes', preparation_state: 'saved', current_attempt_id: null });
  expect(after.posting.text).toBe('Revised posting');
  expect(after.posting.id).not.toBe(before.posting.id);
  const reopened = openJobsDatabase(f.root);
  try {
    const repository = new JobsRepository(reopened);
    expect(repository.getJob(id)).toEqual(after.job);
    expect(repository.getPostingSnapshot(after.posting.id)).toEqual(after.posting);
  } finally { reopened.close(); }
  expect(f.runtime().repository.getPostingSnapshot(before.posting.id).text).toBe('Original posting');
  expect(f.run).not.toHaveBeenCalled();
  expect((await f.request('/api/jobs/preview', { mode: 'text', input: 'Posting', details: { context_url: 'javascript:alert(1)' } })).status).toBe(400);
});


it('retains prior output on context edits and requires current inputs without starting work', async () => {
  const f = fixture(); const id = await f.add();
  let job = f.runtime().repository.getJob(id);
  const input = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision })).json()).input_snapshot;
  await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'initial-resume' });
  await f.runtime().service.worker.whenIdle();
  job = f.runtime().repository.getJob(id);
  expect(job.preparation_state).toBe('resume_ready');
  const controls = f.runtime().repository.getControl();
  const calls = f.run.mock.calls.length;
  await f.request(`/api/jobs/${id}/details`, { expected_revision: job.revision, idempotency_key: 'notes-only', changes: { notes: 'Private reminder' } }, 'PUT');
  job = f.runtime().repository.getJob(id);
  expect(job.preparation_state).toBe('resume_ready');
  const artifacts = job.artifact_version_ids;
  await f.request(`/api/jobs/${id}/details`, { expected_revision: job.revision, idempotency_key: 'posting-edit', changes: {}, posting_text: 'Different requirements' }, 'PUT');
  job = f.runtime().repository.getJob(id);
  expect(job).toMatchObject({ preparation_state: 'needs_input', recovery: { kind: 'stale_inputs' }, artifact_version_ids: artifacts });
  expect((await f.request(`/api/jobs/${id}/resume`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'old-input' })).status).toBe(409);
  expect(f.run).toHaveBeenCalledTimes(calls);
  expect(f.runtime().repository.getControl()).toEqual(controls);
});

it('corrects a job-local starting snapshot with CAS and receipts without touching shared files or starting work', async () => {
  const f = fixture();
  const id = await f.add();
  const job = f.runtime().repository.getJob(id);
  const input = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision })).json()).input_snapshot;
  const original = f.runtime().artifacts.capturedContext(input.id).base_resume;
  const control = f.runtime().repository.getControl();
  const body = { expected_job_revision: job.revision, input_snapshot_id: input.id, idempotency_key: randomUUID(), base_resume: { ...original, summary: 'Job-local correction' } };
  const response = await f.request(`/api/jobs/${id}/starting-resume`, body, 'PUT');
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.result.input_snapshot.id).not.toBe(input.id);
  expect(f.runtime().artifacts.capturedContext(saved.result.input_snapshot.id).base_resume.summary).toBe('Job-local correction');
  expect(f.runtime().artifacts.capturedContext(input.id).base_resume).toEqual(original);
  expect(f.runtime().repository.getJob(id).revision).toBe(job.revision + 1);
  expect((await (await f.request(`/api/jobs/${id}/starting-resume`, body, 'PUT')).json()).replayed).toBe(true);
  expect((await f.request(`/api/jobs/${id}/starting-resume`, { ...body, idempotency_key: randomUUID() }, 'PUT')).status).toBe(409);
  expect((await f.request(`/api/jobs/${id}/starting-resume`, { ...body, expected_job_revision: job.revision + 1, idempotency_key: randomUUID() }, 'PUT')).status).toBe(409);
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime().repository.getControl()).toEqual(control);
  expect(f.runtime().repository.getJob(id).current_attempt_id).toBeNull();
  const fresh = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision + 1 })).json()).input_snapshot;
  expect(f.runtime().artifacts.capturedContext(fresh.id).base_resume).toEqual(original);
});
