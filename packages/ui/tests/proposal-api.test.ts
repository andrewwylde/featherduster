import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/api/client.js';
import type { CorpusWriteRequest, ProposalSaveRequest } from '@featherduster/core';

afterEach(() => vi.unstubAllGlobals());
it('uses typed proposal and corpus bindings without implicitly starting work', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetcher);
  const client = new ApiClient();
  const binding = { expected_job_revision: 2, expected_review_revision: 1, input_fingerprint: 'hash' };
  const save: ProposalSaveRequest = { ...binding, patches: [], groundings: [], feedback_kind: 'rejection', explanation: '', idempotency_key: 'save' };
  await client.getJobProposals('job'); await client.saveJobProposals('job', 'review', save);
  await client.recheckJobProposals('job', 'review', binding);
  expect(fetcher.mock.calls.map(c => (c as unknown as [string])[0])).toEqual(['/api/jobs/job/proposals', '/api/jobs/job/proposals/review', '/api/jobs/job/proposals/review/recheck']);
  expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual(save);
  await client.continueJobProposals('job', 'review', { ...binding, validation_fingerprint: 'validated', idempotency_key: 'continue' });
  await client.recoverJobProposals('job', { expected_job_revision: 2, input_snapshot_id: 'input', idempotency_key: 'recover' });
  const corpus: CorpusWriteRequest = { workspace_id: 'workspace', expected_revision: 0, idempotency_key: 'withdraw', explanation: 'Wrong source', change: { kind: 'withdrawal', update_id: 'update', reason: 'Wrong source' } };
  await client.getCorpus(); await client.previewCorpusChange(corpus); await client.rememberCorpusChange(corpus); await client.withdrawCorpusChange('update', corpus);
  expect(fetcher).toHaveBeenCalledTimes(9);
});
it('preserves actionable prevented-start errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ code: 'ineligible', error: 'Start prevented: stopped' }) })));
  await expect(new ApiClient().continueJobProposals('job', 'review', { expected_job_revision: 2, expected_review_revision: 1, input_fingerprint: 'hash', validation_fingerprint: 'hash', idempotency_key: 'start' })).rejects.toMatchObject({ name: 'ApiError', code: 'ineligible', status: 409 });
  expect(ApiError).toBeDefined();
});
it('rejects slow requests with a plain timeout error that keeps the endpoint out of the message', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))));
    const pending = new ApiClient().getJobProposals('job');
    const settled = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', endpoint: '/api/jobs/job/proposals', message: 'The host is taking longer than expected to respond.' });
    await vi.advanceTimersByTimeAsync(15000);
    await settled;
  } finally { vi.useRealTimers(); }
});
