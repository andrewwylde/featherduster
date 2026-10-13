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

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); vi.useRealTimers(); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'jobs-api-'));
  mkdirSync(path.join(root, 'resumes/templates'), { recursive: true });
  writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify({ profile: { name: 'Test', title: 'Engineer', email: 'a@b.com' }, experiences: [], education: [], skills: [] }));
  let runtime!: JobsRuntime;
  const run = vi.fn(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const app = createApp(root, {
    jobsRuntimeFactory: (w, d) => runtime = createJobsRuntime(w, d),
    jobsDependencies: { automaticDrain: false,
      loadEvidence: () => new EvidenceStore([{ entry: { id: 'ev-one', date: '2026-01-01', company: 'acme', title: 'Systems', summary: 'Built systems', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Preserve this narrative' }]),
      runnerFactory: () => ({ id: 'fake', model: 'fake', label: 'Fake', locality: 'local', detect: async () => ({ available: true, detail: '' }), run }),
      fetcher: async url => { if (url.includes('unavailable')) throw new Error('Unavailable'); return { original_url: url, html: '<html><body>Engineer posting</body></html>', final_url: url, retrieved_at: new Date().toISOString() }; },
      renderer: { preflight: async () => ({ available: true, tools: [], diagnostics: [] }), renderPdf: async () => ({ status: 'passed', source: 'latex', pdf: Buffer.from('pdf'), previews: [{ page: 1, mimeType: 'image/png', bytes: Buffer.from('png') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] }) },
    },
  });
  cleanup.push(async () => { await app.disposeJobs(); rmSync(root, { recursive: true, force: true }); });
  const request = (url: string, body?: unknown, method = 'POST') => app.request(url, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const add = async () => { const p = await (await request('/api/jobs/preview', { mode: 'text', input: 'Build systems' })).json(); const res = await request('/api/jobs', { preview_id: p.preview_id, idempotency_key: randomUUID() }); return (await res.json()).items[0].job_id as string; };
  return { root, app, request, add, run, runtime: () => runtime };
}
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
