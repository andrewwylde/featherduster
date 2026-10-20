import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { semanticFixture } from './fixtures/semantic-fixture.js';
import { SemanticService, SEMANTIC_SUITE_VERSION } from '../src/jobs/semantic-service.js';
import { SEMANTIC_SYSTEM } from '../src/jobs/semantic-classifier.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const f of cleanups.splice(0)) await f(); });
function setup() {
  const f = semanticFixture();
  const now = new Date().toISOString(), draftId = randomUUID();
  f.jobs.saveDraft({ schema_version: 1, id: draftId, revision: 0, job_id: f.job.id, workspace_id: f.job.workspace_id,
    input_snapshot_id: f.input.id, parent_artifact_version_id: null, candidate: f.candidate, proposals: { proposals: [] }, created_at: now, updated_at: now }, null);
  const run = vi.fn(async (_request: any): Promise<unknown> => { throw Error('offline'); });
  const runner = { id: 'fake' as const, model: 'test', label: 'Fake', locality: 'local' as const, run, detect: async () => ({ available: true, detail: '' }) };
  let rules = C.PrivacyRulesConfigSchema.parse({});
  const service = new SemanticService(f.jobs, f.artifacts, { runner: () => runner, consent: () => true, timeoutMs: () => 1000, currentRules: () => rules });
  const target: C.SemanticTarget = { kind: 'draft', draft_id: draftId, candidate: f.candidate };
  cleanups.push(async () => { await service.dispose(); f.cleanup(); });
  return { ...f, service, target, run, runner, changePrivacy: () => { rules = { ...rules, banned_keywords: ['backend'] }; } };
}
it('reads never dispatch inference and manual confirmation works before any model inventory', () => {
  const f = setup(), read = f.service.read(f.job.id, f.target), fact = read.facts[0];
  expect(f.run).not.toHaveBeenCalled();
  const confirmed = f.service.clarify(f.job.id, { target: f.target, expected_job_revision: read.job_revision,
    expected_semantic_revision: read.semantic_revision, input_fingerprint: read.input_fingerprint, idempotency_key: randomUUID(),
    claim_ids: [fact.claim.id], fact: fact.claim.fact, assertion: 'I implemented these backend services.', kind: 'confirmation', source_ids: [], supersedes: null });
  expect(confirmed.facts[0].resolution?.provenance).toBe('human');
  expect(f.run).not.toHaveBeenCalled();
});
it('retains unresolved answers, rejects forged quotes and invalidates confirmation after changed wording', () => {
  const f = setup(), read = f.service.read(f.job.id, f.target), fact = read.facts[0];
  const body = { target: f.target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, idempotency_key: randomUUID(), claim_ids: [fact.claim.id], fact: fact.claim.fact,
    assertion: 'I need to verify this.', kind: 'confirmation' as const, confirmed: false, source_ids: [], supersedes: null };
  const saved = f.service.clarify(f.job.id, body);
  expect(saved.clarifications).toHaveLength(1); expect(saved.facts[0].resolution).toBeNull();
  const confirmed = f.service.clarify(f.job.id, { ...body, expected_semantic_revision: saved.semantic_revision,
    idempotency_key: randomUUID(), assertion: 'I implemented these handlers.', confirmed: true });
  expect(confirmed.facts[0].resolution?.provenance).toBe('human');
  const changed = { ...f.target, candidate: { ...f.candidate, summary: 'Owned backend architecture.' } } as C.SemanticTarget;
  expect(f.service.read(f.job.id, changed).facts[0].resolution).toBeNull();
  expect(() => f.service.clarify(f.job.id, { ...body, expected_semantic_revision: confirmed.semantic_revision,
    idempotency_key: randomUUID(), supporting_quotes: [{ evidence_id: 'ev-1', evidence_fingerprint: 'forged', field: 'summary', start: 0, end: 6, quote: 'forged' }] })).toThrow(/quotation/);
});
it('accepts source-verified claims independently of evaluation, caches unchanged text, and never starts inference from reads', async () => {
  const f = setup();
  f.run.mockImplementation(async req => {
    const batch = JSON.parse(req.prompt) as C.SemanticBatchRequest, source = batch.sources[0];
    return { passages: batch.subjects.map(p => ({ subject: p.subject, complete: true, claims: [{
      claim: { id: p.subject.id, subject: p.subject, text: p.text, start: 0, end: p.text.length,
        fact: { work_id: p.work_id, predicate: 'backend', qualifiers: [] }, qualifier_text: [] },
      state: 'supported', evidence: [{ evidence_id: source.evidence_id, evidence_fingerprint: source.evidence_fingerprint,
        field: source.field, start: source.start, end: source.start + source.text.length, quote: source.text }], explanation: 'Implemented server request handlers.',
    }] })) };
  });
  const check = async () => {
    const v = f.service.read(f.job.id, f.target);
    f.service.start(f.job.id, { target: f.target, expected_job_revision: v.job_revision, expected_semantic_revision: v.semantic_revision,
      input_fingerprint: v.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
    await f.service.wait(f.job.id);
  };
  await check();
  expect(f.service.read(f.job.id, f.target).facts[0]).toMatchObject({ state: 'supported', resolution: { provenance: 'model' } });
  f.service.store.saveEvaluation({ configuration_key: f.service.configurationKey(f.runner), suite_hash: SEMANTIC_SUITE_VERSION, passed: false, observations: [], recorded_at: new Date().toISOString() });
  expect(f.service.read(f.job.id, f.target).facts[0].resolution?.provenance).toBe('model');
  f.service.store.saveEvaluation({ configuration_key: f.service.configurationKey(f.runner), suite_hash: SEMANTIC_SUITE_VERSION, passed: true, observations: [], recorded_at: new Date().toISOString() });
  expect(f.service.read(f.job.id, f.target).facts[0].resolution?.provenance).toBe('model');
  await check(); expect(f.run).toHaveBeenCalledTimes(1);
  const support = f.service.support(f.job.id, f.input.id, f.candidate, [], f.target);
  expect(support.support[0]).toMatchObject({ resolved: true, citations: ['ev-1'] });
  expect(f.run).toHaveBeenCalledTimes(1);
});
it('records outage separately from unsupported content and does not retry on reads', async () => {
  const f = setup(), read = f.service.read(f.job.id, f.target);
  const operation = f.service.start(f.job.id, { target: f.target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
  await f.service.wait(f.job.id);
  expect(f.service.operation(f.job.id, operation.operation_id).state).toBe('unavailable');
  expect(f.service.read(f.job.id, f.target).facts[0].state).toBe('unavailable');
  f.service.read(f.job.id, f.target);
  expect(f.run).toHaveBeenCalledTimes(1);
});
it('budgets serialized source metadata before dispatching a large evidence collection', async () => {
  const f = setup(), context = f.service.context.bind(f.service);
  vi.spyOn(f.service, 'context').mockImplementation((...args) => {
    const ctx = context(...args);
    return { ...ctx, sources: Array.from({ length: 200 }, (_, i) => ({
      evidence_id: `evidence-${i}`, evidence_fingerprint: 'a'.repeat(64), work_id: `work-${i}`,
      field: 'summary' as const, start: 0, text: 'Built backend services. '.repeat(6),
    })) };
  });
  const read = f.service.read(f.job.id, f.target);
  f.service.start(f.job.id, { target: f.target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
  await f.service.wait(f.job.id);
  expect(f.run).toHaveBeenCalledOnce();
  const request = f.run.mock.calls[0][0];
  expect(request.prompt.length + SEMANTIC_SYSTEM.length).toBeLessThanOrEqual(C.SEMANTIC_LIMITS.inputChars);
  expect(JSON.parse(request.prompt).sources.length).toBeGreaterThan(0);
});
it('splits resume inventories into four-passage batches within the existing call budget', async () => {
  const f = setup();
  const target: C.SemanticTarget = { ...f.target, kind: 'draft', draft_id: (f.target as { draft_id: string }).draft_id,
    candidate: { ...f.candidate, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020',
      bullets: Array.from({ length: 5 }, (_, i) => ({ text: `Implemented backend service ${i}.` })) }] } };
  f.run.mockImplementation(async request => {
    const batch = JSON.parse(request.prompt);
    return { passages: batch.subjects.map((p: any) => ({ subject_ref: p.ref, claims: [{
      text: p.text, fact: { predicate: 'backend', qualifiers: [] }, qualifier_text: [], state: 'needs_clarification',
      evidence: [], explanation: 'Needs source detail.', question: 'Which service did you implement?',
    }] })) };
  });
  const read = f.service.read(f.job.id, target);
  f.service.start(f.job.id, { target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
  await f.service.wait(f.job.id);
  expect(f.run.mock.calls.map(([request]) => JSON.parse(request.prompt).subjects.length)).toEqual([4, 2]);
  expect(f.service.read(f.job.id, target).facts).toHaveLength(6);
});
it('does not dispatch against privacy rules that changed after capture', async () => {
  const f = setup(), read = f.service.read(f.job.id, f.target);
  f.changePrivacy();
  const op = f.service.start(f.job.id, { target: f.target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
  await f.service.wait(f.job.id);
  expect(f.run).not.toHaveBeenCalled();
  expect(f.service.operation(f.job.id, op.operation_id).reason).toMatch(/Privacy rules changed/);
});
