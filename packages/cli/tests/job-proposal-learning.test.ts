import { claimFingerprint } from '../src/jobs/proposal-service.js';
import { sourceFingerprint } from '../src/corpus/load.js';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceStore, queryCorpus, serializeEvidenceMarkdown } from '@featherduster/core';
import { createApp } from '../src/server.js';
import { createJobsRuntime, type JobsRuntime } from '../src/jobs/runtime.js';
import { type RunnerFactory } from '../src/runners/registry.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); vi.useRealTimers(); });
function fixture(runnerFactory?: RunnerFactory) {
  const root = mkdtempSync(path.join(tmpdir(), 'jobs-api-'));
  mkdirSync(path.join(root, 'resumes/templates'), { recursive: true });
  writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify({ profile: { name: 'Test', title: 'Engineer', email: 'a@b.com' }, experiences: [], education: [], skills: [] }));
  let runtime!: JobsRuntime;
  const run = vi.fn(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const evidence = new EvidenceStore([{ entry: { id: 'ev-one', date: '2026-01-01', company: 'acme', title: 'Systems', summary: 'Built APIs', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Built APIs and fixed BFF authentication.' }]);
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
  const add = async () => { const p = await (await request('/api/jobs/preview', { mode: 'text', input: `Backend engineer opening ${randomUUID()}` })).json(); const res = await request('/api/jobs', { preview_id: p.preview_id, idempotency_key: randomUUID() }); return (await res.json()).items[0].job_id as string; };
  return { root, app, request, add, run, evidence, runtime: () => runtime };
}

it('learns a source-bound correction across A/B, withdraws before C, and keeps historical inputs', async () => {
  const f = fixture();
  const analysis = { company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [{ id: 'r1', text: 'Backend applications', terms: ['backend', 'Kafka'], tier: 'must', quote: 'Backend' }] };
  const proposals = { proposals: [{ id: 'p', type: 'summary.rewrite', target: {}, before: '', after: 'Built backend APIs.', citations: ['ev-one'], requirement_ids: ['r1'] }] };
  const start = async () => {
    const id = await f.add(); const runtime = f.runtime(); const job = runtime.repository.getJob(id);
    const capture = await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision });
    expect(capture.status).toBe(201); const input = (await capture.json()).input_snapshot;
    f.run.mockResolvedValueOnce(analysis as any).mockResolvedValueOnce({ rows: [] } as any).mockResolvedValueOnce(proposals as any).mockResolvedValueOnce({} as any);
    expect((await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: randomUUID() })).status).toBe(202);
    await runtime.service.worker.whenIdle();
    return { id, input, view: await (await f.request(`/api/jobs/${id}/proposals`)).json() };
  };
  const a = await start(); expect(a.view.review.validation.status).toBe('blocked');
  // Blocked runs do not consume the brief slot.
  f.run.mockReset();
  const original = f.runtime().artifacts.capturedContext(a.input.id);
  const source = f.evidence.get('ev-one')!;
  const sources = [{ evidence_id: source.id, evidence_fingerprint: sourceFingerprint(source), quote: 'Built APIs and fixed BFF authentication.' }];
  const save = await f.request(`/api/jobs/${a.id}/proposals/${a.view.review.id}`, {
    expected_job_revision: f.runtime().repository.getJob(a.id).revision, expected_review_revision: 0, input_fingerprint: a.input.fingerprint,
    patches: [], groundings: [{ proposal_id: 'p', claim_fingerprint: claimFingerprint(a.view.generation.proposals.proposals[0]), term: 'backend', sources, explanation: 'API/BFF application development' }], feedback_kind: 'grounding', explanation: 'Broader terminology supported by this passage',
    remember: { expected_corpus_revision: 0, change: { kind: 'skill_support', value: { skill: 'backend', facet: 'applications', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'workspace' }, sources, explanation: 'API/BFF application development' } } }, idempotency_key: 'learn-A',
  }, 'PUT');
  expect(save.status).toBe(200); const saved = (await save.json()).result;
  expect(saved.review.validation.status).toBe('ready'); expect(f.run).not.toHaveBeenCalled();
  f.run.mockResolvedValue({} as any);
  expect((await f.request(`/api/jobs/${a.id}/proposals/${saved.review.id}/continue`, { expected_job_revision: saved.job.revision, expected_review_revision: saved.review.revision, input_fingerprint: a.input.fingerprint, validation_fingerprint: saved.review.validation.fingerprint, idempotency_key: 'continue-A' })).status).toBe(202);
  await f.runtime().service.worker.whenIdle(); expect(f.runtime().repository.getJob(a.id).preparation_state).toBe('resume_ready');
  expect(f.run).toHaveBeenCalledTimes(1);
  const matches = queryCorpus(f.runtime().corpus.read(), { search: 'backend' });
  expect(matches.map(m => m.record.id)).toEqual(['ev-one']); expect(matches[0].literal).toBe(false);
  f.run.mockClear(); const b = await start();
  expect(b.view.review.validation.status).toBe('ready');
  expect(f.runtime().repository.getJob(b.id).preparation_state).toBe('resume_ready');
  expect(JSON.stringify(f.run.mock.calls)).toContain('API/BFF application development');
  expect(b.input.fingerprint).not.toBe(a.input.fingerprint);
  expect(serializeEvidenceMarkdown(f.runtime().artifacts.capturedContext(a.input.id).evidence.get('ev-one')!.entry, original.evidence.get('ev-one')!.narrative)).toBe(serializeEvidenceMarkdown(source.entry, source.narrative));
  const withdraw = await f.request(`/api/corpus/updates/${saved.update.id}/withdraw`, { workspace_id: saved.job.workspace_id, expected_revision: 1, idempotency_key: 'withdraw', explanation: 'Revisit support', change: { kind: 'withdrawal', update_id: saved.update.id, reason: 'Revisit support' } });
  expect(withdraw.status).toBe(200);
  const c = await start(); expect(c.view.review.validation.status).toBe('blocked');
  expect(queryCorpus(f.runtime().corpus.read(), { search: 'backend' })).toHaveLength(0);
  expect((await (await f.request(`/api/jobs/${b.id}/proposals`)).json()).review.validation.status).toBe('ready');
});

it('returns captured source fingerprints so browser grounding never serializes node-only markdown', async () => {
  const f = fixture(); const id = await f.add(); const job = f.runtime().repository.getJob(id);
  const input = (await (await f.request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision })).json()).input_snapshot;
  await f.request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'fingerprints' });
  await f.runtime().service.worker.whenIdle();
  const view = await (await f.request(`/api/jobs/${id}/proposals`)).json();
  expect(view.captured.source_fingerprints).toEqual({ 'ev-one': sourceFingerprint(f.evidence.get('ev-one')!) });
});
