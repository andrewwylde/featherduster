import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobsRuntime } from '../src/jobs/runtime.js';
import { EvidenceStore, parseEvidenceLedger } from '@featherduster/core';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-execution-'));
  const run = vi.fn(async () => ({ company: 'Synthetic', role: 'Engineer', seniority: '', mission: 'Build APIs', requirements: [], rows: [] }));
  const runner = { id: 'fake' as const, model: 'fake', label: 'Test', locality: 'local' as const, detect: async () => ({ available: true, detail: '' }), run };
  const loadResumes = vi.fn(() => { throw new Error('No resume allowed'); });
  const renderer = { preflight: vi.fn(), renderPdf: vi.fn() };
  let evidence = new EvidenceStore();
  let privacy: any = {};
  const deps = { loadResumes, loadEvidence: () => evidence, loadPrivacyRules: () => privacy, runnerFactory: () => runner, renderer };
  const runtime = createJobsRuntime(root, deps);
  cleanups.push(async () => { await runtime.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const preview = await runtime.intake.preview({ mode: 'text', input: 'Synthetic seeks an engineer to build APIs.' });
  const job = runtime.intake.commit(preview, 'save')[0].job!;
  const request = { expected_revision: job.revision, idempotency_key: 'fit', evidence_ids: [] };
  return { runtime, root, deps, runner, job, run, loadResumes, renderer, request, setEvidence: (value: EvidenceStore) => { evidence = value; }, setPrivacy: (value: any) => { privacy = value; } };
}
it('explicit fit saves a versioned assessment with two calls and no resume or renderer dependencies', async () => {
  const f = await fixture();
  expect(f.run).not.toHaveBeenCalled();
  f.runtime.assessFit(f.job.id, f.request);
  await f.runtime.service.worker.whenIdle();
  const result = f.runtime.readFit(f.job.id);
  expect(result.current?.assessment.coverage).toEqual({ backed: 0, transferable: 0, gap: 0 });
  expect(result.current?.stale).toBe(false);
  expect(result.history).toHaveLength(1);
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('saved');
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([]);
  expect(f.run).toHaveBeenCalledTimes(2);
  expect(f.loadResumes).not.toHaveBeenCalled();
  expect(f.renderer.preflight).not.toHaveBeenCalled();
  expect(f.renderer.renderPdf).not.toHaveBeenCalled();
  f.runtime.assessFit(f.job.id, f.request);
  await f.runtime.service.worker.whenIdle();
  expect(f.run).toHaveBeenCalledTimes(2);
});
it('Stop blocks explicit fit and never clears itself', async () => {
  const f = await fixture(); f.runtime.service.stopProcessing('stop');
  expect(() => f.runtime.assessFit(f.job.id, f.request)).toThrow(/stopped|paused/);
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime.repository.getControl().stopped_at).not.toBeNull();
});
it('late cancelled output cannot publish an assessment', async () => {
  const f = await fixture();
  let enter!: () => void; const entered = new Promise<void>(r => { enter = r; });
  let release!: (v: any) => void;
  f.run.mockImplementationOnce(() => { enter(); return new Promise(r => { release = r; }); });
  f.runtime.assessFit(f.job.id, f.request); await entered;
  f.runtime.service.stopProcessing('stop'); await f.runtime.service.worker.whenIdle();
  release({ requirements: [] }); await Promise.resolve();
  expect(f.runtime.readFit(f.job.id).current).toBeNull();
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('cancelled');
});

const ledger = (summary = 'Built APIs with TypeScript.') => {
  const store = new EvidenceStore();
  for (const record of parseEvidenceLedger(`entries:
  - id: api
    date: '2026-01-01'
    company: Synthetic Company
    title: API project
    summary: ${summary}
    impact: Reliability
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
`)) store.add(record);
  return store;
};
it('binds evidence, distinguishes supported/transferable/unknown and retains history on source changes and reopen', async () => {
  const f = await fixture(); f.setEvidence(ledger());
  f.run.mockResolvedValueOnce({ company: 'Synthetic', role: 'Engineer', seniority: '', mission: '', requirements: [
    { id: 'direct', tier: 'must', text: 'APIs', quote: 'build APIs', terms: ['APIs'] },
    { id: 'adjacent', tier: 'nice', text: 'Engineering', quote: 'engineer', terms: [] },
    { id: 'invented', tier: 'must', text: 'Kubernetes', quote: 'Kubernetes', terms: ['Kubernetes'] },
  ] } as any).mockResolvedValueOnce({ rows: [
    { requirement_id: 'direct', classification: 'backed', citations: ['api'], rationale: 'API delivery' },
    { requirement_id: 'adjacent', classification: 'transferable', citations: ['api'], adjacent_tool: 'TypeScript', rationale: 'Related API work' },
    { requirement_id: 'invented', classification: 'backed', citations: ['api'], rationale: 'Model guess' },
  ] } as any);
  f.runtime.assessFit(f.job.id, { ...f.request, evidence_ids: ['api'] }); await f.runtime.service.worker.whenIdle();
  const first = f.runtime.readFit(f.job.id);
  expect(first.current?.assessment.rows.map(row => row.classification)).toEqual(['backed', 'transferable', 'gap']);
  expect(first.current?.assessment.coverage).toEqual({ backed: 1, transferable: 1, gap: 1 });
  expect(first.current?.evidence[0].summary).toBe('Built APIs with TypeScript.');
  expect(first.current?.stale).toBe(false);
  f.setEvidence(ledger('Built interfaces.'));
  expect(f.runtime.readFit(f.job.id).current?.stale).toBe(true);
  expect(first.current?.evidence[0].summary).toBe('Built APIs with TypeScript.');
  f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'again' });
  await f.runtime.service.worker.whenIdle();
  expect(f.runtime.readFit(f.job.id).history).toHaveLength(2);
  await f.runtime.dispose();
  const reopened = createJobsRuntime(f.root, f.deps);
  try { expect(reopened.readFit(f.job.id).history).toHaveLength(2); } finally { await reopened.dispose(); }
});
it('blocks unconsented cloud calls, then applies captured privacy before sending prompts', async () => {
  const f = await fixture(); (f.runner as any).locality = 'cloud';
  f.runtime.assessFit(f.job.id, f.request); await f.runtime.service.worker.whenIdle();
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime.repository.getJob(f.job.id).state_reason).toMatch(/consent/);
  fs.writeFileSync(path.join(f.root, '.featherduster/config.yaml'), `runner_consent:
  fake: permitted-synthetic-test
`);
  f.setEvidence(ledger('Built APIs for SecretClient.'));
  f.setPrivacy({ replacements: [{ search: 'SecretClient', replace: 'a client' }] });
  f.runtime.assessFit(f.job.id, { expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'consented' });
  await f.runtime.service.worker.whenIdle();
  expect(f.run).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(f.run.mock.calls)).not.toContain('SecretClient');
  expect(JSON.stringify(f.run.mock.calls)).toContain('a client');
});
it('rejects stale revisions and changed idempotency intent without invoking', async () => {
  const f = await fixture();
  expect(() => f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: 999 })).toThrow(/changed job/);
  f.runtime.assessFit(f.job.id, f.request); await f.runtime.service.worker.whenIdle();
  expect(() => f.runtime.assessFit(f.job.id, { ...f.request, evidence_ids: ['other'] })).toThrow();
  expect(f.run).toHaveBeenCalledTimes(2);
});
it('detects immutable output tampering instead of presenting it as current', async () => {
  const f = await fixture(); f.runtime.assessFit(f.job.id, f.request); await f.runtime.service.worker.whenIdle();
  const attempt = f.runtime.repository.getJob(f.job.id).current_attempt_id!;
  const checkpoint = f.runtime.repository.listCheckpoints(attempt)[0];
  fs.writeFileSync(path.join(f.root, checkpoint.output_references[0].id), '{}');
  expect(() => f.runtime.readFit(f.job.id)).toThrow();
});
it('HTTP fit results survive normal detail reads and refuse cross-job input reuse', async () => {
  const { Hono } = await import('hono');
  const { mountJobsRoutes } = await import('../src/jobs/routes.js');
  const f = await fixture(); const app = new Hono(); mountJobsRoutes(app, () => f.runtime);
  const response = await app.request(`/api/jobs/${f.job.id}/fit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.request) });
  expect(response.status).toBe(202); await f.runtime.service.worker.whenIdle();
  expect((await app.request(`/api/jobs/${f.job.id}`)).status).toBe(200);
  const saved = await (await app.request(`/api/jobs/${f.job.id}/fit`)).json();
  expect(saved.current.assessment.job_id).toBe(f.job.id);
  expect(JSON.stringify(saved)).not.toContain('owner_token');
  const preview = await f.runtime.intake.preview({ mode: 'text', input: 'Another synthetic posting' });
  const other = f.runtime.intake.commit(preview, 'other')[0].job!;
  expect(() => f.runtime.service.prepare({ job_id: other.id, expected_revision: other.revision, input_snapshot_id: saved.current.input_snapshot_id, idempotency_key: 'wrong' })).toThrow();
  const changed = await app.request(`/api/jobs/${f.job.id}/details`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'edit', changes: {}, posting_text: 'Changed synthetic posting' }) });
  expect(changed.status).toBe(200);
  expect(f.runtime.readFit(f.job.id).current?.stale).toBe(true);
  expect(f.run).toHaveBeenCalledTimes(2);
});
it('deadline cancels a hung fit detection without model calls', async () => {
  const f = await fixture();
  fs.writeFileSync(path.join(f.root, '.featherduster/config.yaml'), 'runner:\n  step_timeout_seconds: 0.02\n');
  f.runner.detect = () => new Promise(() => {});
  f.runtime.assessFit(f.job.id, f.request); await f.runtime.service.worker.whenIdle();
  const attempt = f.runtime.repository.getAttempt(f.runtime.repository.getJob(f.job.id).current_attempt_id!);
  expect(attempt.error?.code).toBe('timeout');
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime.readFit(f.job.id).history).toEqual([]);
});
it('saved transferable support is never upgraded to direct proof by the model', async () => {
  const { sourceFingerprint } = await import('../src/corpus/load.js');
  const f = await fixture(); const evidence = ledger(); f.setEvidence(evidence);
  f.runtime.corpus.remember({ workspace_id: f.runtime.repository.database.workspaceId, expected_revision: 0, idempotency_key: 'support', supersedes: null, explanation: 'Synthetic transferability', change: { kind: 'skill_support', value: {
    skill: 'APIs', facet: 'development', permitted_terms: ['APIs'], support: 'transferable', scope: { kind: 'job', key: f.job.id }, explanation: 'Adjacent practice only',
    sources: [{ evidence_id: 'api', evidence_fingerprint: sourceFingerprint(evidence.get('api')!), quote: 'Built APIs' }],
  } } });
  f.run.mockResolvedValueOnce({ company: '', role: '', seniority: '', mission: '', requirements: [{ id: 'r', tier: 'must', text: 'APIs', quote: 'build APIs', terms: ['APIs'] }] } as any)
    .mockResolvedValueOnce({ rows: [{ requirement_id: 'r', classification: 'backed', citations: ['api'], rationale: 'Model overstatement' }] } as any);
  f.runtime.assessFit(f.job.id, { ...f.request, evidence_ids: ['api'] }); await f.runtime.service.worker.whenIdle();
  expect(f.runtime.readFit(f.job.id).current?.assessment.rows[0].classification).toBe('transferable');
});
it('fit success, failure and Stop preserve an existing ready resume and its review inputs', async () => {
  const f = await fixture();
  const spec = { profile: { name: 'Synthetic', title: 'Engineer', email: 'synthetic@example.com' }, experiences: [], education: [], skills: [] };
  fs.writeFileSync(path.join(f.root, 'base.yaml'), JSON.stringify(spec));
  f.loadResumes.mockImplementation(() => [{ id: 'base', type: 'template', filePath: 'base.yaml', spec }] as never);
  f.run.mockImplementation(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  f.renderer.preflight.mockResolvedValue({ available: true, tools: [], diagnostics: [] });
  f.renderer.renderPdf.mockResolvedValue({ status: 'passed', source: 'synthetic source', pdf: Buffer.from('unit-test-pdf'), previews: [{ bytes: Buffer.from('unit-test-preview') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] });
  const input = f.runtime.captureInputs(f.job.id, f.job.revision);
  f.runtime.service.prepare({ job_id: f.job.id, expected_revision: f.job.revision, input_snapshot_id: input.id, idempotency_key: 'resume' });
  await f.runtime.service.worker.whenIdle();
  const ready = f.runtime.repository.getJob(f.job.id);
  expect(ready.preparation_state).toBe('resume_ready');
  const beforeReview = f.runtime.proposals.read(f.job.id);
  f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: ready.revision }); await f.runtime.service.worker.whenIdle();
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('resume_ready');
  expect(f.runtime.proposals.read(f.job.id)).toEqual(beforeReview);
  f.run.mockRejectedValueOnce(new Error('Synthetic provider failure'));
  f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'failure' }); await f.runtime.service.worker.whenIdle();
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('resume_ready');
  let enter!: () => void; const entered = new Promise<void>(r => { enter = r; });
  f.run.mockImplementationOnce(() => { enter(); return new Promise(() => {}); });
  f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'cancel-ready' }); await entered;
  f.runtime.service.stopProcessing('stop-ready'); await f.runtime.service.worker.whenIdle();
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('resume_ready');
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual(ready.artifact_version_ids);
  expect(f.runtime.proposals.read(f.job.id)).toEqual(beforeReview);
  expect(f.runtime.readFit(f.job.id).history).toHaveLength(1);
});
it('does not launch if the outer admission receipt cannot commit', async () => {
  const f = await fixture();
  f.runtime.repository.database.db.exec("CREATE TEMP TRIGGER reject_fit_receipt BEFORE INSERT ON mutation_receipts WHEN NEW.operation='assess_fit' BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;");
  expect(() => f.runtime.assessFit(f.job.id, f.request)).toThrow('synthetic receipt failure');
  await f.runtime.service.worker.whenIdle();
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime.repository.active()).toEqual([]);
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('saved');
});
