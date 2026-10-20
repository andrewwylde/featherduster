import { expect, it, vi } from 'vitest';
import * as C from '@featherduster/core';
import { classifyBatch } from '../src/jobs/semantic-classifier.js';
import type { ModelRunner } from '../src/runners/types.js';
const subject = { id: 's1', path: 'summary', passage_fingerprint: 'hash' };
const text = 'Built backend APIs.', quote = 'Implemented server-side handlers.';
const request: C.SemanticBatchRequest = { subjects: [{ subject, text, work_id: 'api-a', inherited: true }],
  sources: [{ evidence_id: 'e1', evidence_fingerprint: 'source-hash', work_id: 'api-a', field: 'narrative', start: 0, text: quote }],
  configuration_key: 'fake:test', configuredStepTimeoutMs: 1000,
  coverage: { searched_source_count: 1, omitted_source_ids: [], truncated: false } };
const response = () => ({ passages: [{ subject, complete: true, claims: [{ claim: { id: 'c1', subject, text, start: 0, end: text.length,
  fact: { work_id: 'api-a', predicate: 'backend', qualifiers: [] }, qualifier_text: [] }, state: 'supported',
  explanation: 'Implemented server-side handlers', evidence: [{ evidence_id: 'e1', evidence_fingerprint: 'source-hash', field: 'narrative', start: 0, end: quote.length, quote }] }] }] });
function runner(value: unknown): ModelRunner { return { id: 'fake', model: 'test', label: 'fake', locality: 'local', detect: async () => ({ available: true, detail: '' }), run: vi.fn(async () => value) }; }
it('accepts exact source-bound support with one non-retrying call', async () => {
  const model = runner(response());
  expect((await classifyBatch(model, request, new AbortController().signal)).status).toBe('complete');
  expect(model.run).toHaveBeenCalledOnce();
  expect(model.run).toHaveBeenCalledWith(expect.objectContaining({ transportRetryCount: 0 }));
});
it('computes exact positions from unique literal quotations without trusting model counting', async () => {
  const value = response() as any;
  delete value.passages[0].claims[0].claim.start; delete value.passages[0].claims[0].claim.end;
  delete value.passages[0].claims[0].evidence[0].start; delete value.passages[0].claims[0].evidence[0].end;
  const result = await classifyBatch(runner(value), request, new AbortController().signal);
  expect(result.status).toBe('complete');
  if (result.status === 'complete') expect(result.passages[0].claims[0].evidence[0]).toMatchObject({ start: 0, end: quote.length });
  expect((await classifyBatch(runner(value), { ...request, sources: [{ ...request.sources[0], text: `${quote} ${quote}` }] }, new AbortController().signal)).status).toBe('unavailable');
});
it('rejects fabricated quotes, missing passages, duplicate claims, unknown work and oversized output', async () => {
  const badQuote = response(); badQuote.passages[0].claims[0].evidence[0].quote = 'invented';
  const badWork = response(); badWork.passages[0].claims[0].claim.fact.work_id = 'other';
  const duplicate = response(); duplicate.passages[0].claims.push(duplicate.passages[0].claims[0]);
  for (const value of [badQuote, badWork, duplicate, { passages: [] }, { excessive: 'x'.repeat(17000) }])
    expect((await classifyBatch(runner(value), request, new AbortController().signal)).status).toBe('unavailable');
});
it('bounds a runner that ignores abort without retrying', async () => {
  const model = runner(null); model.run = vi.fn(() => new Promise(() => {}));
  expect((await classifyBatch(model, { ...request, configuredStepTimeoutMs: 5 }, new AbortController().signal)).status).toBe('unavailable');
  expect(model.run).toHaveBeenCalledOnce();
});
