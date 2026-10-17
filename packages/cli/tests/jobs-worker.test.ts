import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Job } from '@featherduster/core';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { JobArtifactsService } from '../src/jobs/artifacts.js';
import { JobPreparation } from '../src/jobs/preparation.js';
import { PostingIntakeService } from '../src/jobs/intake.js';
import { JobsService } from '../src/jobs/service.js';
import { fingerprint } from '../src/jobs/files.js';
import { getLatexTemplate } from '../src/jobs/templates.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'worker-'));
  const db = openJobsDatabase(root); const repo = new JobsRepository(db); const artifacts = new JobArtifactsService(repo);
  const run = vi.fn(async () => ({ company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const runner = { id: 'fake' as const, model: 'fake', label: 'Fake', locality: 'local' as const, detect: vi.fn(async () => ({ available: true, detail: '' })), run };
  const renderer = { preflight: vi.fn(async () => ({ available: true, tools: [], diagnostics: [] })), renderPdf: vi.fn(async () => ({ status: 'passed' as const, source: 'latex', pdf: Buffer.from('pdf'), previews: [{ page: 1, mimeType: 'image/png' as const, bytes: Buffer.from('png') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] })) };
  const prep = new JobPreparation({ repository: repo, artifacts, renderer, resolveRunner: () => runner, hasConsent: () => true });
  const inputs = new Map<string, string>(); const onEvent = vi.fn();
  const deps = { repository: repo, preparation: prep, resolveInput: (j: Job) => j.current_attempt_id ? repo.getAttempt(j.current_attempt_id).input_snapshot_id : inputs.get(j.id)!, onEvent, leaseMs: 3000 };
  const service = new JobsService(deps);
  cleanups.push(async () => { await service.dispose(); db.close(); rmSync(root, { recursive: true, force: true }); });
  function seed(timeout = 10000, state: Job['preparation_state'] = 'queued') {
    const now = new Date().toISOString();
    const job: Job = { schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, revision: 0, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: state, application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: now, updated_at: now };
    repo.createJob(job, randomUUID());
    const posting = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: job.workspace_id, job_id: job.id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: now, text: 'Build things', content_fingerprint: fingerprint('Build things') });
    const input = artifacts.captureInputs({ job_id: job.id, posting_id: posting.id, base_resume: yaml.dump({ profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [], education: [], skills: [] }), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'fake', model: 'fake' }, policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: 1, max_model_calls: 4, timeout_ms: timeout, max_repair_attempts: 0, model_retry_count: 0 } });
    inputs.set(job.id, input.id); return { job, input };
  }
  const request = (j: ReturnType<typeof seed>) => ({ job_id: j.job.id, expected_revision: repo.getJob(j.job.id).revision, input_snapshot_id: j.input.id, idempotency_key: randomUUID() });
  return { root, repo, db, service, seed, run, runner, renderer, onEvent, request, deps };
}
it('idle is silent and performs no input resolution or model calls', async () => {
  const f = fixture(); const resolve = vi.spyOn(f.deps, 'resolveInput');
  f.service.initialize(); await f.service.worker.whenIdle();
  f.service.startAutomaticPreparation('start'); f.service.durableEnqueue(); await f.service.worker.whenIdle();
  expect(f.run).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); expect(f.onEvent).not.toHaveBeenCalled(); expect(f.repo.active()).toEqual([]);
});
it('drains candidates with four bounded calls each and no human approval', async () => {
  const f = fixture(); const a = f.seed(); const b = f.seed(); f.service.startAutomaticPreparation('start'); await f.service.worker.whenIdle();
  for (const j of [a, b]) { expect(f.repo.getJob(j.job.id).preparation_state).toBe('resume_ready'); expect(f.repo.getJob(j.job.id).application_lifecycle).toBe('not_started'); }
  expect(f.run).toHaveBeenCalledTimes(8); expect(f.renderer.renderPdf).toHaveBeenCalledTimes(2);
  expect(f.run.mock.calls.every(c => (c as unknown as [{ transportRetryCount: number }])[0].transportRetryCount === 0)).toBe(true);
  expect(f.onEvent.mock.calls.some(([e]) => e.payload.kind === 'resume_review')).toBe(false);
});
it('persistent stop cancels ignored-abort output and prevents later claims and receipt revival', async () => {
  const f = fixture(); const a = f.seed(); const b = f.seed(); const entered = deferred<void>(); const late = deferred<any>();
  f.run.mockImplementationOnce(() => { entered.resolve(); return late.promise; });
  f.service.startAutomaticPreparation('start'); await entered.promise; f.service.stopProcessing('stop'); await f.service.worker.whenIdle();
  late.resolve({}); await Promise.resolve();
  f.service.startAutomaticPreparation('start'); f.service.durableEnqueue(); await f.service.worker.whenIdle();
  expect(f.repo.getJob(a.job.id).preparation_state).toBe('cancelled'); expect(f.repo.getJob(b.job.id).preparation_state).toBe('queued'); expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.repo.getJob(a.job.id).artifact_version_ids).toEqual([]);
  expect(new JobsRepository(f.db).getControl().stopped_at).not.toBeNull();
});
it('pause finishes active work but leaves the next job queued', async () => {
  const f = fixture(); const a = f.seed(); const b = f.seed(); const entered = deferred<void>(); const gate = deferred<any>();
  f.run.mockImplementationOnce(() => { entered.resolve(); return gate.promise; }); f.service.startAutomaticPreparation('s'); await entered.promise;
  f.service.pauseAfterCurrent('p'); gate.resolve({ company: '', role: '', seniority: '', mission: '', requirements: [] }); await f.service.worker.whenIdle();
  expect(f.repo.getJob(a.job.id).preparation_state).toBe('resume_ready'); expect(f.repo.getJob(b.job.id).preparation_state).toBe('queued');
  f.service.startAutomaticPreparation('again'); await f.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(8);
});
it('default schema failure makes one call; explicit retry reuses a valid contiguous prefix', async () => {
  const f = fixture(); const a = f.seed(); f.run.mockImplementationOnce(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [] } as any)).mockImplementationOnce(async () => null as any);
  f.service.prepare(f.request(a)); await f.service.worker.whenIdle(); const first = f.repo.getJob(a.job.id).current_attempt_id!;
  expect(f.repo.getJob(a.job.id).preparation_state).toBe('failed'); expect(f.run).toHaveBeenCalledTimes(2);
  const request = f.request(a); f.service.retry(request); await f.service.worker.whenIdle(); f.service.retry(request); await f.service.worker.whenIdle();
  expect(f.run).toHaveBeenCalledTimes(5); expect(f.repo.getJob(a.job.id).preparation_state).toBe('resume_ready'); expect(f.repo.listCheckpoints(first).map(c => c.completed_stage)).toEqual(['preflight', 'analysis']);
});
it('tampered checkpoints fail safely without another model invocation', async () => {
  const f = fixture(); const a = f.seed(); f.run.mockResolvedValueOnce(null as any); f.service.prepare(f.request(a)); await f.service.worker.whenIdle();
  const cp = f.repo.listCheckpoints(f.repo.getJob(a.job.id).current_attempt_id!)[0]!;
  writeFileSync(path.join(f.root, cp.output_references[0]!.id), 'tampered'); f.service.retry(f.request(a)); await f.service.worker.whenIdle();
  expect(f.run).toHaveBeenCalledTimes(1); expect(f.repo.getJob(a.job.id).preparation_state).toBe('failed');
});
it('deadline bounds hung preflight and persists diagnostics with zero calls', async () => {
  vi.useFakeTimers(); const f = fixture(); const a = f.seed(100); f.runner.detect.mockReturnValue(new Promise(() => {}));
  f.service.prepare(f.request(a)); await vi.advanceTimersByTimeAsync(101); await f.service.worker.whenIdle();
  const attempt = f.repo.getAttempt(f.repo.getJob(a.job.id).current_attempt_id!); expect(attempt.error?.code).toBe('timeout'); expect(attempt.resource_usage.elapsed_ms).toBe(100); expect(f.run).not.toHaveBeenCalled();
});
it('missing tools block once without calling a model', async () => {
  const f = fixture(); const a = f.seed(); f.renderer.preflight.mockResolvedValue({ available: false, tools: [], diagnostics: [{ code: 'tool', message: 'Install tools' }] } as any);
  f.service.startAutomaticPreparation('s'); await f.service.worker.whenIdle(); const count = f.onEvent.mock.calls.length; f.service.durableEnqueue(); await f.service.worker.whenIdle();
  expect(f.repo.getJob(a.job.id).preparation_state).toBe('needs_input'); expect(f.onEvent).toHaveBeenCalledTimes(count); expect(f.run).not.toHaveBeenCalled();
});
it('two connections cannot claim while another worker is running', async () => {
  const f = fixture(); const a = f.seed(); const b = f.seed(); const entered = deferred<void>(); const gate = deferred<any>();
  f.run.mockImplementationOnce(() => { entered.resolve(); return gate.promise; }); f.service.prepare(f.request(a)); await entered.promise;
  const db = openJobsDatabase(f.root); const other = new JobsRepository(db);
  try { expect(other.claimJob({ job_id: b.job.id, input_snapshot_id: b.input.id, mode: 'manual', stop_generation: 0, lease_ms: 3000, idempotency_key: 'race' }).result).toBeNull(); other.stopProcessing('external'); }
  finally { db.close(); }
  f.service.worker.abortActive(); await f.service.worker.whenIdle(); gate.resolve({}); expect(f.run).toHaveBeenCalledTimes(1);
});

it('lease recovery requires explicit retry and never steals a live attempt', async () => {
  vi.useFakeTimers(); const f = fixture(); const a = f.seed();
  const claim = f.repo.claimJob({ job_id: a.job.id, input_snapshot_id: a.input.id, mode: 'manual', stop_generation: 0, lease_ms: 100, idempotency_key: 'crashed' }).result!;
  f.service.startAutomaticPreparation('start'); await f.service.worker.whenIdle(); expect(f.repo.getAttempt(claim.id).status).toBe('active');
  await vi.advanceTimersByTimeAsync(101); f.service.durableEnqueue(); await f.service.worker.whenIdle();
  expect(f.repo.getAttempt(claim.id).status).toBe('interrupted'); expect(f.run).not.toHaveBeenCalled();
  const count = f.onEvent.mock.calls.length; f.service.durableEnqueue(); await f.service.worker.whenIdle(); expect(f.onEvent).toHaveBeenCalledTimes(count);
  f.service.retry(f.request(a)); await f.service.worker.whenIdle(); expect(f.repo.getJob(a.job.id).preparation_state).toBe('resume_ready');
});

it('renews active leases and observes stop from a second connection without awaiting the model', async () => {
  vi.useFakeTimers(); const f = fixture(); const a = f.seed(); const entered = deferred<void>();
  f.run.mockImplementationOnce(() => { entered.resolve(); return new Promise(() => {}); }); f.service.prepare(f.request(a)); await entered.promise;
  const id = f.repo.getJob(a.job.id).current_attempt_id!; const expiry = f.repo.getAttempt(id).lease_expires_at;
  await vi.advanceTimersByTimeAsync(2000); expect(f.repo.getAttempt(id).lease_expires_at > expiry).toBe(true);
  const db = openJobsDatabase(f.root); try { new JobsRepository(db).stopProcessing('external'); } finally { db.close(); }
  await vi.advanceTimersByTimeAsync(1000); await f.service.worker.whenIdle(); expect(f.repo.getJob(a.job.id).preparation_state).toBe('cancelled'); expect(f.run).toHaveBeenCalledTimes(1);
});

it('headless manual execution never drains a second queued job even when enabled', async () => {
  const f = fixture(); const a = f.seed(); const b = f.seed();
  const service = new JobsService({ ...f.deps, automaticDrain: false });
  try {
    f.repo.startAutomaticPreparation('enabled');
    service.prepare(f.request(a)); await service.worker.whenIdle();
    expect(f.repo.getJob(a.job.id).preparation_state).toBe('resume_ready');
    expect(f.repo.getJob(b.job.id).preparation_state).toBe('queued');
    expect(f.run).toHaveBeenCalledTimes(4);
  } finally { await service.dispose(); }
});

it('transitions queued job to needs_input and attaches missing_inputs when setup resolution fails', async () => {
  const f = fixture(); const a = f.seed();
  const service = new JobsService({
    ...f.deps,
    resolveInput() { throw new Error('Configure a runner and model first'); },
  });
  try {
    f.repo.startAutomaticPreparation('start');
    service.durableEnqueue();
    await service.worker.whenIdle();
    const updated = f.repo.getJob(a.job.id);
    expect(updated.preparation_state).toBe('needs_input');
    expect(updated.missing_inputs.length).toBeGreaterThan(0);
    expect(updated.missing_inputs[0].key).toBe('preparation_setup');
    expect(updated.state_reason).toContain('Configure a runner and model first');
  } finally { await service.dispose(); }
});


it.each([false, true])('saving is inert across reconciliation with automatic mode %s', async automatic => {
  vi.useFakeTimers();
  const f = fixture();
  const resolve = vi.spyOn(f.deps, 'resolveInput');
  f.service.initialize();
  if (automatic) f.service.startAutomaticPreparation('enable');
  const control = f.repo.getControl();
  const intake = new PostingIntakeService(f.repo);
  const preview = await intake.preview({ mode: 'text', input: 'Build accessible interfaces' });
  const id = intake.commit(preview, 'save')[0]!.job_id!;
  intake.commit(preview, 'save');
  await vi.advanceTimersByTimeAsync(16000);
  f.service.durableEnqueue();
  await f.service.worker.whenIdle();
  expect(new JobsRepository(f.db).getJob(id).preparation_state).toBe('saved');
  expect(f.repo.listJobs()).toHaveLength(1);
  expect(f.repo.getJob(id).current_attempt_id).toBeNull();
  expect(f.repo.getJob(id).artifact_version_ids).toEqual([]);
  expect(resolve).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
  expect(f.renderer.preflight).not.toHaveBeenCalled();
  expect(f.repo.getControl()).toEqual(control);
});

it('explicit preparation admits a saved job but never clears Stop', async () => {
  const f = fixture();
  const seeded = f.seed(10000, 'saved');
  f.service.stopProcessing('stop');
  const control = f.repo.getControl();
  expect(() => f.service.prepare(f.request(seeded))).toThrow(/stopped|paused/i);
  expect(f.repo.getJob(seeded.job.id).preparation_state).toBe('saved');
  expect(f.repo.getControl()).toEqual(control);
  f.service.startAutomaticPreparation('start');
  await f.service.worker.whenIdle();
  expect(f.run).not.toHaveBeenCalled();
  f.service.prepare(f.request(seeded));
  await f.service.worker.whenIdle();
  expect(f.repo.getJob(seeded.job.id).preparation_state).toBe('resume_ready');
});
