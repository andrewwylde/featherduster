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
it('prioritizes selected summary evidence within the prompt budget, even when other sources rank higher', async () => {
  const f = setup(), ctx = f.service.context(f.job.id, f.target);
  const common = { evidence_fingerprint: 'captured', work_id: 'work', company: 'Acme', field: 'summary' as const, start: 0 };
  const sources = [
    { ...common, evidence_id: 'other', text: 'Implemented backend services selected_evidence. '.repeat(950) },
    { ...common, evidence_id: 'ev-052', text: 'ARIA component contributions. '.repeat(150) },
  ];
  vi.spyOn(f.service, 'context').mockReturnValue({ ...ctx, sources, passages: ctx.passages.map(p => ({ ...p, work_context: JSON.stringify({ selected_evidence: ['ev-052'] }) })) });
  const read = f.service.read(f.job.id, f.target);
  f.service.start(f.job.id, { target: f.target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
  await f.service.wait(f.job.id);
  expect(f.run).toHaveBeenCalledOnce();
  const request = f.run.mock.calls[0][0], sent = JSON.parse(request.prompt);
  expect(sent.sources[0].evidence_id).toBe('ev-052');
  expect(request.system.length + request.prompt.length).toBeLessThanOrEqual(C.SEMANTIC_LIMITS.inputChars);
});


it('keeps an explicitly confirmed answer resolved on reread and cached recheck', async () => {
  const f = setup();
  f.run.mockImplementation(async req => {
    const batch = JSON.parse(req.prompt);
    return { passages: batch.subjects.map((p: any) => ({ subject_ref: p.ref, claims: [{ text: p.text,
      fact: { predicate: 'backend', qualifiers: [] }, qualifier_text: [], state: 'needs_clarification', evidence: [],
      explanation: 'Confirm contribution.', question: 'Did you implement these handlers?' }] })) };
  });
  const check = async () => {
    const v = f.service.read(f.job.id, f.target);
    f.service.start(f.job.id, { target: f.target, expected_job_revision: v.job_revision, expected_semantic_revision: v.semantic_revision,
      input_fingerprint: v.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
    await f.service.wait(f.job.id);
  };
  await check();
  const v = f.service.read(f.job.id, f.target), fact = v.facts[0];
  f.service.clarify(f.job.id, { target: f.target, expected_job_revision: v.job_revision, expected_semantic_revision: v.semantic_revision,
    input_fingerprint: v.input_fingerprint, idempotency_key: randomUUID(), claim_ids: [fact.claim.id], fact: fact.claim.fact,
    assertion: 'I implemented these handlers.', confirmed: true, reuse: 'job', kind: 'confirmation', source_ids: [], supersedes: null });
  await check();
  const reread = f.service.read(f.job.id, f.target);
  expect(reread.facts[0].resolution).toEqual({ provenance: 'human', explanation: 'I implemented these handlers.' });
  expect(reread.clarifications.filter(c => c.confirmed)).toHaveLength(1);
  expect(f.run).toHaveBeenCalledOnce();
});

it('preserves successful classification batches and retains structured diagnostic on batch schema error', async () => {
  const f = setup();
  const target: C.SemanticTarget = {
    ...f.target,
    kind: 'draft',
    draft_id: (f.target as { draft_id: string }).draft_id,
    candidate: {
      ...f.candidate,
      experiences: [{
        company: 'Acme',
        role: 'Engineer',
        startDate: '2020',
        bullets: Array.from({ length: 9 }, (_, i) => ({ text: `Implemented backend service ${i}.` })),
      }],
    },
  };

  let callCount = 0;
  f.run.mockImplementation(async request => {
    callCount++;
    if (callCount === 3) {
      throw new Error('Malformed wire JSON at line 1 col 12');
    }
    const batch = JSON.parse(request.prompt);
    return {
      passages: batch.subjects.map((p: any) => ({
        subject_ref: p.ref,
        claims: [{
          text: p.text,
          fact: { predicate: 'backend', qualifiers: [] },
          qualifier_text: [],
          state: 'supported',
          evidence: batch.sources[0] ? [{
            source_ref: 's1',
            quote: batch.sources[0].text,
          }] : [],
          explanation: 'Supported by source.',
        }],
      })),
    };
  });

  const read = f.service.read(f.job.id, target);
  f.service.start(f.job.id, {
    target,
    expected_job_revision: read.job_revision,
    expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint,
    reason: 'check',
    idempotency_key: randomUUID(),
  });
  await f.service.wait(f.job.id);

  const result = f.service.read(f.job.id, target);
  expect(result.batchesSucceeded).toBe(2);
  expect(result.batchesFailed).toBe(1);
  expect(result.facts[0].state).toBe('supported');
  expect(result.failures).toContainEqual(expect.objectContaining({
    batch_index: 3,
    stage: 'schema_validation',
    code: 'wire_shape_invalid',
    safe_diagnostic: expect.stringContaining('Malformed wire JSON'),
  }));

  const supportedFacts = result.facts.filter(fact => fact.state === 'supported');
  expect(supportedFacts.length).toBeGreaterThanOrEqual(8);

  f.run.mockClear();
  f.run.mockImplementation(async request => {
    const batch = JSON.parse(request.prompt);
    return {
      passages: batch.subjects.map((p: any) => ({
        subject_ref: p.ref,
        claims: [{
          text: p.text,
          fact: { predicate: 'backend', qualifiers: [] },
          qualifier_text: [],
          state: 'supported',
          evidence: batch.sources[0] ? [{
            source_ref: 's1',
            quote: batch.sources[0].text,
          }] : [],
          explanation: 'Supported by source on retry.',
        }],
      })),
    };
  });

  const readBeforeRetry = f.service.read(f.job.id, target);
  f.service.start(f.job.id, {
    target,
    expected_job_revision: readBeforeRetry.job_revision,
    expected_semantic_revision: readBeforeRetry.semantic_revision,
    input_fingerprint: readBeforeRetry.input_fingerprint,
    reason: 'retry',
    idempotency_key: randomUUID(),
  });
  await f.service.wait(f.job.id);

  const retriedSubjects = f.run.mock.calls.flatMap(([req]) => JSON.parse(req.prompt).subjects.map((s: any) => s.text));
  expect(retriedSubjects).not.toContain(result.facts[0].claim.text);
  expect(retriedSubjects).not.toContain(result.facts[1].claim.text);

  const finalResult = f.service.read(f.job.id, target);
  expect(finalResult.facts.every(fact => fact.state === 'supported')).toBe(true);
});

it('classifyJobPassages preserves successful classification batches and retains structured diagnostic on batch schema error', async () => {
  const f = setup();
  const target: C.SemanticTarget = {
    ...f.target,
    kind: 'draft',
    draft_id: (f.target as { draft_id: string }).draft_id,
    candidate: {
      ...f.candidate,
      experiences: [{
        company: 'Acme',
        role: 'Engineer',
        startDate: '2020',
        bullets: Array.from({ length: 9 }, (_, i) => ({ text: `Implemented backend service ${i}.` })),
      }],
    },
  };

  let callCount = 0;
  f.run.mockImplementation(async request => {
    callCount++;
    if (callCount === 3) {
      throw new Error('Malformed wire JSON at line 1 col 12');
    }
    const batch = JSON.parse(request.prompt);
    return {
      passages: batch.subjects.map((p: any) => ({
        subject_ref: p.ref,
        claims: [{
          text: p.text,
          fact: { predicate: 'backend', qualifiers: [] },
          qualifier_text: [],
          state: 'supported',
          evidence: batch.sources[0] ? [{
            source_ref: 's1',
            quote: batch.sources[0].text,
          }] : [],
          explanation: 'Supported by source.',
        }],
      })),
    };
  });

  const result = await f.service.classifyJobPassages(f.job.id, { target });
  expect(result.batchesSucceeded).toBe(2);
  expect(result.batchesFailed).toBe(1);
  expect(result.passages[0].status).toBe('supported');
  expect(result.failures).toContainEqual(expect.objectContaining({
    batch_index: 3,
    stage: 'schema_validation',
    code: 'wire_shape_invalid',
    safe_diagnostic: expect.stringContaining('Malformed wire JSON'),
  }));
});

