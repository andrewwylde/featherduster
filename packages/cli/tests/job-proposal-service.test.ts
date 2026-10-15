import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import * as C from '@featherduster/core';
import { ProposalRepository } from '../src/jobs/proposal-repository.js';
import { ProposalService, claimFingerprint } from '../src/jobs/proposal-service.js';
import { CorpusRepository } from '../src/corpus/repository.js';
import { CorpusService } from '../src/corpus/service.js';
import { sourceFingerprint } from '../src/corpus/load.js';
import type { Job } from '@featherduster/core';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { JobArtifactsService } from '../src/jobs/artifacts.js';
import { JobPreparation, PreparationBlocked } from '../src/jobs/preparation.js';
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
  const evidence = new C.EvidenceStore([{ entry: C.EvidenceEntrySchema.parse({ id: 'ev-1', date: '2026-01-01', company: 'Acme', title: 'APIs', summary: 'Built APIs.', impact: '', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }), narrative: 'Built APIs and fixed BFF authentication.' }]);
  const corpus = new CorpusService(new CorpusRepository(repo), () => evidence);
  const proposals = new ProposalRepository(repo);
  const prep = new JobPreparation({ repository: repo, artifacts, renderer, resolveRunner: () => runner, hasConsent: () => true });
  const inputs = new Map<string, string>(); const onEvent = vi.fn();
  const deps = { repository: repo, preparation: prep, resolveInput: (j: Job) => j.current_attempt_id ? repo.getAttempt(j.current_attempt_id).input_snapshot_id : inputs.get(j.id)!, onEvent, leaseMs: 3000 };
  const service = new JobsService({ ...deps, automaticDrain: false });
  const reviews = new ProposalService(repo, proposals, artifacts, corpus, service);
  cleanups.push(async () => { await service.dispose(); db.close(); rmSync(root, { recursive: true, force: true }); });
  function seed(timeout = 10000) {
    const now = new Date().toISOString();
    const job: Job = { schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, revision: 0, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: now, updated_at: now };
    repo.createJob(job, randomUUID());
    const posting = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: job.workspace_id, job_id: job.id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: now, text: 'Build things', content_fingerprint: fingerprint('Build things') });
    const input = artifacts.captureInputs({ job_id: job.id, posting_id: posting.id, base_resume: yaml.dump({ profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [], education: [], skills: [] }), selected_evidence: evidence.getAll().map(e => ({ source_id: e.id, bytes: C.serializeEvidenceMarkdown(e.entry, e.narrative) })), privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'fake', model: 'fake' }, policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: 1, max_model_calls: 4, timeout_ms: timeout, max_repair_attempts: 0, model_retry_count: 0 } });
    inputs.set(job.id, input.id); return { job, input };
  }
  const request = (j: ReturnType<typeof seed>) => ({ job_id: j.job.id, expected_revision: repo.getJob(j.job.id).revision, input_snapshot_id: j.input.id, idempotency_key: randomUUID() });
  return { root, repo, db, service, seed, run, runner, renderer, onEvent, request, deps, reviews, proposals, corpus, evidence, artifacts };
}
const analysis = { company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [{ id: 'r1', text: 'Backend', terms: ['backend', 'Kafka'], tier: 'must', quote: 'Build things' }] };
async function blocked() {
  const f = fixture(); const seeded = f.seed();
  f.run.mockResolvedValueOnce(analysis as any).mockResolvedValueOnce({ rows: [] } as any).mockResolvedValueOnce({ proposals: [{ id: 'p', type: 'summary.rewrite', target: {}, before: '', after: 'Built backend APIs.', citations: ['ev-1'], requirement_ids: ['r1'] }] } as any);
  f.service.prepare(f.request(seeded)); await f.service.worker.whenIdle();
  const view = f.reviews.read(seeded.job.id);
  if (view.availability !== 'available') throw new Error(JSON.stringify(f.repo.getAttempt(f.repo.getJob(seeded.job.id).current_attempt_id!)));
  expect(view.review.validation.status).toBe('blocked');
  const binding = () => ({ job_id: seeded.job.id, review_id: view.review.id, expected_job_revision: f.repo.getJob(seeded.job.id).revision, expected_review_revision: f.proposals.getActive(seeded.job.id)!.revision, input_fingerprint: seeded.input.fingerprint });
  const save = (patches: C.ProposalPatch[] = [{ proposal_id: 'p', edited_after: 'Built APIs.' }]) => ({ ...binding(), patches, groundings: [], feedback_kind: 'wording' as const, explanation: 'Correct wording', idempotency_key: randomUUID() });
  return { ...f, seeded, view, binding, save };
}
it('retains semantic failure separately from checkpoints and saves/rechecks without execution', async () => {
  const f = await blocked(); const attempt = f.repo.getAttempt(f.view.generation.attempt_id);
  expect(attempt.resource_usage.model_calls).toBe(3);
  expect(f.repo.listCheckpoints(attempt.id).map(c => c.completed_stage)).toEqual(['preflight', 'analysis', 'alignment']);
  expect(f.repo.getJob(f.seeded.job.id).recovery?.kind).toBe('proposals');
  const request = f.save(); const saved = f.reviews.save(request);
  expect(saved.result.review.validation.status).toBe('ready');
  expect(saved.result.review.candidate_preview.summary).toBe('Built APIs.');
  expect(f.reviews.save(request).replayed).toBe(true);
  expect(() => f.reviews.save({ ...request, explanation: 'different' })).toThrow();
  const count = f.repo.listEvents(f.seeded.job.id).length;
  expect(f.reviews.recheck(f.binding()).review).toEqual(saved.result.review);
  expect(f.reviews.recheck(f.binding()).review.validation.fingerprint).toBe(saved.result.review.validation.fingerprint);
  expect(f.repo.listEvents(f.seeded.job.id)).toHaveLength(count);
  expect(f.run).toHaveBeenCalledTimes(3); expect(f.renderer.renderPdf).not.toHaveBeenCalled();
  expect(f.corpus.repository.snapshot().revision).toBe(0);
  expect(() => f.reviews.save({ ...request, idempotency_key: randomUUID() })).toThrow(/Stale/);
  const second = f.reviews.save(f.save([{ proposal_id: 'p', citations: ['ev-1'] }]));
  expect(second.result.review.candidate_preview.summary).toBe('Built APIs.');
  f.reviews.save(f.save([{ proposal_id: 'p', decision: 'rejected' }]));
  expect(f.proposals.getActive(f.seeded.job.id)!.candidate_preview.summary).toBeUndefined();
  f.reviews.save(f.save([{ proposal_id: 'p', decision: 'pending' }]));
  expect(f.proposals.getActive(f.seeded.job.id)!.candidate_preview.summary).toBe('Built APIs.');
});
it('continues the frozen revision with only a brief call, rejecting generic bypasses', async () => {
  const f = await blocked(); f.reviews.save(f.save());
  expect(() => f.service.resume(f.request(f.seeded))).toThrow(/exact proposal/);
  const review = f.proposals.getActive(f.seeded.job.id)!;
  const request = { ...f.binding(), validation_fingerprint: review.validation.fingerprint, idempotency_key: randomUUID() };
  const receipt = f.reviews.continue(request);
  expect(f.proposals.getAttemptReview(receipt.result.attempt.id)?.revision).toBe(review.revision);
  expect(() => f.reviews.save(f.save())).toThrow(/active/);
  await f.service.worker.whenIdle();
  expect(f.repo.getJob(f.seeded.job.id).preparation_state).toBe('resume_ready');
  expect(f.run).toHaveBeenCalledTimes(4);
  expect((f.renderer.renderPdf.mock.calls[0] as any)[0].spec.summary).toBe('Built APIs.');
  expect(f.reviews.continue(request).replayed).toBe(true);
  await f.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(4);
});
it('Stop and pause prevent admission without clearing blockers', async () => {
  const f = await blocked(); f.reviews.save(f.save()); f.service.stopProcessing('stop');
  const request = { ...f.binding(), validation_fingerprint: f.proposals.getActive(f.seeded.job.id)!.validation.fingerprint, idempotency_key: 'continue' };
  const before = f.repo.getJob(f.seeded.job.id);
  expect(() => f.reviews.continue(request)).toThrow(/prevented/);
  expect(f.repo.getJob(f.seeded.job.id)).toEqual(before); expect(f.repo.active()).toEqual([]);
  f.service.startAutomaticPreparation('start'); await f.service.worker.whenIdle(); f.service.pauseAfterCurrent('pause');
  expect(() => f.reviews.continue(request)).toThrow(/prevented/);
  expect(f.run).toHaveBeenCalledTimes(3);
});
const memory = (f: Awaited<ReturnType<typeof blocked>>) => ({ expected_corpus_revision: f.corpus.repository.snapshot().revision, change: { kind: 'skill_support' as const, value: { skill: 'backend', facet: 'applications', permitted_terms: ['backend'], support: 'direct' as const, scope: { kind: 'workspace' as const }, sources: [{ evidence_id: 'ev-1', evidence_fingerprint: sourceFingerprint(f.evidence.get('ev-1')!), quote: 'Built APIs' }], explanation: 'API application development' } } });
it('grounds exact passages, remembers atomically and invalidates changed claims', async () => {
  const f = await blocked(); const remember = memory(f);
  const grounding = { proposal_id: 'p', claim_fingerprint: claimFingerprint(f.view.generation.proposals.proposals[0]), term: 'backend', sources: remember.change.value.sources, explanation: 'API application development' };
  const request = { ...f.save([]), groundings: [grounding], remember };
  expect(() => f.reviews.save({ ...request, groundings: [{ ...grounding, sources: [{ ...grounding.sources[0], quote: 'fabricated' }] }] })).toThrow(/passage/);
  expect(f.corpus.repository.snapshot().revision).toBe(0);
  const saved = f.reviews.save(request);
  expect(saved.result.review.validation.status).toBe('ready'); expect(saved.result.corpus_revision).toBe(1);
  expect(saved.result.review.groundings[0].recorded_by).toBe('local-human');
  const again = f.reviews.save({ ...request, ...f.binding(), idempotency_key: randomUUID(), remember: memory(f) });
  expect(again.result.corpus_revision).toBe(1); expect(f.corpus.repository.snapshot().updates).toHaveLength(1);
  expect(() => f.reviews.save({ ...f.save(), removed_grounding_ids: [randomUUID()] })).toThrow('Unknown grounding removal');
  const removed = f.reviews.save({ ...f.save([]), removed_grounding_ids: again.result.review.groundings.map(g => g.id) });
  expect(removed.result.review.groundings).toEqual([]);
  expect(removed.result.review.validation.status).toBe('blocked');
  expect(f.corpus.repository.snapshot().revision).toBe(1);
  const edited = f.reviews.save(f.save([{ proposal_id: 'p', edited_after: 'Built backend Kafka APIs.' }]));
  expect(edited.result.review.groundings).toEqual([]); expect(edited.result.review.validation.status).toBe('blocked');
  expect(f.run).toHaveBeenCalledTimes(3);
});
it('rolls back feedback, memory, heads and receipts on review publication failure', async () => {
  const f = await blocked(); const before = f.proposals.getActive(f.seeded.job.id);
  const request = { ...f.save(), remember: memory(f) };
  const spy = vi.spyOn(f.proposals, 'appendReview').mockImplementationOnce(() => { throw new Error('disk'); });
  expect(() => f.reviews.save(request)).toThrow('disk'); spy.mockRestore();
  expect(f.corpus.repository.snapshot().revision).toBe(0); expect(f.corpus.repository.listFeedback()).toEqual([]);
  expect(f.proposals.getActive(f.seeded.job.id)).toEqual(before);
  expect(f.reviews.save(request).replayed).toBe(false);
});
it('retains render failures and retries from generation prefix rather than failed preflight', async () => {
  const f = await blocked(); f.reviews.save(f.save());
  f.renderer.renderPdf.mockResolvedValueOnce({ status: 'failed', source: 'failed latex', previews: [], diagnostics: [{ code: 'pages', message: 'Too many pages' }] } as any);
  const go = () => f.reviews.continue({ ...f.binding(), validation_fingerprint: f.proposals.getActive(f.seeded.job.id)!.validation.fingerprint, idempotency_key: randomUUID() });
  go(); await f.service.worker.whenIdle();
  const job = f.repo.getJob(f.seeded.job.id); expect(job.recovery?.kind).toBe('render'); expect(job.artifact_version_ids).toEqual([]);
  const failure = JSON.parse(f.db.files.readArtifact(job.recovery!.failed_output!, job.id).toString());
  expect(failure.result.source).toBe('failed latex'); expect(failure.review_revision).toBe(1);
  f.renderer.preflight.mockResolvedValueOnce({ available: false, tools: [], diagnostics: [{ code: 'tools', message: 'Install' }] } as any);
  go(); await f.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(4);
  go(); await f.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(5);
  expect(f.repo.getJob(job.id).preparation_state).toBe('resume_ready');
});
it('rejects tampered durable output before continuation', async () => {
  const f = await blocked(); f.reviews.save(f.save());
  writeFileSync(path.join(f.root, f.view.generation.raw_output.id), '{}');
  expect(() => f.reviews.recheck(f.binding())).toThrow(/changed/); expect(f.run).toHaveBeenCalledTimes(3);
});
it('recovers historical output exactly once and pauses even valid output for inspection', async () => {
  const f = fixture(); const seeded = f.seed();
  f.run.mockResolvedValueOnce(analysis as any).mockResolvedValueOnce({ rows: [] } as any).mockImplementationOnce(async () => { throw new PreparationBlocked('lost legacy output'); });
  f.service.prepare(f.request(seeded)); await f.service.worker.whenIdle();
  const old = f.repo.getJob(seeded.job.id);
  const request = { job_id: old.id, expected_job_revision: f.repo.getJob(old.id).revision, input_snapshot_id: seeded.input.id, idempotency_key: 'recover' };
  expect(f.reviews.read(old.id)).toMatchObject({ availability: 'missing_output', recoverable: true });
  f.reviews.recover(request); await f.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(4);
  expect(f.reviews.read(old.id)).toMatchObject({ availability: 'available', review: { validation: { status: 'ready' } } });
  expect(f.repo.getJob(old.id).preparation_state).toBe('needs_input'); expect(f.renderer.renderPdf).not.toHaveBeenCalled();
  expect(f.reviews.recover(request).replayed).toBe(true); await f.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(4);
});
it('keeps historical recovery available when a recovery attempt fails before saving its prefix', async () => {
  const f = fixture(); const seeded = f.seed();
  f.run.mockResolvedValueOnce(analysis as any).mockResolvedValueOnce({ rows: [] } as any).mockImplementationOnce(async () => { throw new PreparationBlocked('lost legacy output'); });
  f.service.prepare(f.request(seeded)); await f.service.worker.whenIdle();
  let job = f.repo.getJob(seeded.job.id);
  f.renderer.preflight.mockResolvedValueOnce({ available: false, tools: [], diagnostics: [{ code: 'tool-unavailable', message: 'pdfinfo timeout' }] } as any);
  f.reviews.recover({ job_id: job.id, expected_job_revision: job.revision, input_snapshot_id: seeded.input.id, idempotency_key: 'recover-preflight-fails' });
  await f.service.worker.whenIdle();
  expect(f.reviews.read(job.id)).toMatchObject({ availability: 'missing_output', recoverable: true });
  job = f.repo.getJob(job.id);
  f.reviews.recover({ job_id: job.id, expected_job_revision: job.revision, input_snapshot_id: seeded.input.id, idempotency_key: 'recover-after-preflight-failure' });
  await f.service.worker.whenIdle();
  expect(f.reviews.read(job.id)).toMatchObject({ availability: 'available', review: { validation: { status: 'ready' } } });
  expect(f.run).toHaveBeenCalledTimes(4);
});
it('does not persist late proposal results after cancellation', async () => {
  const f = fixture(); const seeded = f.seed(); const entered = deferred<void>(); const late = deferred<any>();
  f.run.mockResolvedValueOnce(analysis as any).mockResolvedValueOnce({ rows: [] } as any).mockImplementationOnce(() => { entered.resolve(); return late.promise; });
  f.service.prepare(f.request(seeded)); await entered.promise; f.service.stopProcessing('stop'); await f.service.worker.whenIdle();
  late.resolve({ proposals: [] }); await Promise.resolve();
  expect(f.reviews.read(seeded.job.id)).toMatchObject({ availability: 'missing_output', recoverable: false });
  expect(f.repo.getJob(seeded.job.id).preparation_state).toBe('cancelled'); expect(f.run).toHaveBeenCalledTimes(3);
  expect(f.db.db.prepare('SELECT * FROM proposal_generations').all()).toEqual([]);
});
it('retains a thrown renderer diagnostic and its historical reference after retry', async () => {
  const f = await blocked(); f.reviews.save(f.save());
  f.renderer.renderPdf.mockRejectedValueOnce(new Error('renderer crash'));
  const go = () => f.reviews.continue({ ...f.binding(), validation_fingerprint: f.proposals.getActive(f.seeded.job.id)!.validation.fingerprint, idempotency_key: randomUUID() });
  go(); await f.service.worker.whenIdle();
  const failed = f.repo.getJob(f.seeded.job.id).recovery!.failed_output!;
  expect(JSON.parse(f.db.files.readArtifact(failed, f.seeded.job.id).toString()).result.diagnostics[0].message).toContain('renderer crash');
  go(); await f.service.worker.whenIdle();
  expect(f.repo.listEvents(f.seeded.job.id).some(e => e.payload.kind === 'preparation_transition' && e.payload.recovery?.failed_output?.id === failed.id)).toBe(true);
});
it('rejects foreign review and snapshot binding and stale live-source memory without side effects', async () => {
  const f = await blocked();
  expect(() => f.reviews.save({ ...f.save(), review_id: randomUUID() })).toThrow(/Stale/);
  expect(() => f.reviews.save({ ...f.save(), input_fingerprint: 'foreign' })).toThrow(/mismatch/);
  const remember = memory(f); remember.change.value.sources[0].evidence_fingerprint = 'a'.repeat(64);
  const before = f.repo.getJob(f.seeded.job.id);
  expect(() => f.reviews.save({ ...f.save(), remember })).toThrow(/Source version/);
  expect(f.repo.getJob(f.seeded.job.id)).toEqual(before); expect(f.corpus.repository.listFeedback()).toEqual([]);
});
it('fences admission binding and rolls back the claim before worker launch', async () => {
  const f = await blocked(); f.reviews.save(f.save()); const before = f.repo.getJob(f.seeded.job.id);
  vi.spyOn(f.proposals, 'bindAttempt').mockImplementationOnce(() => { throw new Error('binding failure'); });
  expect(() => f.reviews.continue({ ...f.binding(), validation_fingerprint: f.proposals.getActive(before.id)!.validation.fingerprint, idempotency_key: 'binding' })).toThrow('binding failure');
  expect(f.repo.getJob(before.id)).toEqual(before); expect(f.repo.active()).toEqual([]); expect(f.run).toHaveBeenCalledTimes(3);
});
it('keeps frozen knowledge after withdrawal and requires refresh for factual amendments', async () => {
  const f = await blocked(); const remember = memory(f);
  const g = { proposal_id: 'p', claim_fingerprint: claimFingerprint(f.view.generation.proposals.proposals[0]), term: 'backend', sources: remember.change.value.sources, explanation: 'API application development' };
  const saved = f.reviews.save({ ...f.save([]), groundings: [g], remember });
  f.corpus.withdraw({ workspace_id: f.db.workspaceId, expected_revision: 1, idempotency_key: 'withdraw', explanation: 'Review later', supersedes: null, change: { kind: 'withdrawal', update_id: saved.result.update!.id, reason: 'Review later' } });
  expect(f.reviews.recheck(f.binding()).review.validation.status).toBe('ready');
  expect(f.corpus.read().support).toEqual([]);
  const record = f.evidence.get('ev-1')!;
  const amendment = { kind: 'evidence_amendment' as const, value: { evidence_id: record.id, base_fingerprint: sourceFingerprint(record), entry: { ...record.entry, confidence: 'provisional' as const, summary: 'Built APIs and owned the component.' }, narrative: record.narrative, confirmation_basis: 'user_confirmed' as const, explanation: 'Added ownership' } };
  const amended = f.reviews.save({ ...f.save([]), remember: { expected_corpus_revision: 2, change: amendment } });
  expect(amended.result.requires_refresh).toBe(true); expect(amended.result.job.recovery?.kind).toBe('stale_inputs');
  f.reviews.save(f.save([]));
  expect(() => f.reviews.continue({ ...f.binding(), validation_fingerprint: f.proposals.getActive(f.seeded.job.id)!.validation.fingerprint, idempotency_key: 'stale' })).toThrow(/ready/);
  expect(f.artifacts.capturedContext(f.seeded.input.id).evidence.get('ev-1')!.summary).toBe('Built APIs.');
});

it('returns the durable latest snapshot on reads without executing or rewriting review history', async () => {
  const f = await blocked();
  const before = f.proposals.getActive(f.seeded.job.id)!;
  const calls = f.run.mock.calls.length;
  expect(f.reviews.read(f.seeded.job.id)).toMatchObject({ latest_input_snapshot_id: f.seeded.input.id, input_stale: false });
  // Capture an identical immutable bundle as a new snapshot, just as refresh does.
  const ctx = f.artifacts.capturedContext(f.seeded.input.id);
  const newer = f.artifacts.captureInputs({ job_id: f.seeded.job.id, posting_id: f.seeded.input.posting.id, base_resume: yaml.dump(ctx.base_resume), selected_evidence: f.evidence.getAll().map(e => ({ source_id: e.id, bytes: C.serializeEvidenceMarkdown(e.entry, e.narrative) })), privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'fake', model: 'fake' }, policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: 1, max_model_calls: 4, timeout_ms: 10000, max_repair_attempts: 0, model_retry_count: 0 } });
  expect(f.reviews.read(f.seeded.job.id)).toMatchObject({ latest_input_snapshot_id: newer.id, input_stale: true });
  expect(() => f.reviews.save(f.save())).toThrow(/Inputs changed/);
  expect(f.proposals.getActive(f.seeded.job.id)).toEqual(before);
  expect(f.run).toHaveBeenCalledTimes(calls);
});
