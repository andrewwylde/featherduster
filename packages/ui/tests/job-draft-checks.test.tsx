/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { JobDraftCheck } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { useJobDraftChecks } from '../src/views/jobs/useJobDraftChecks.js';
const candidate = { profile: { name: 'A', title: 'Engineer', email: 'a@example.com' }, experiences: [], education: [], skills: [] };
const ready: JobDraftCheck = { status: 'ready', issues: [], job_revision: 1, binding: {
  candidate_fingerprint: 'candidate', context_fingerprint: 'context', input_snapshot_id: 'input', input_fingerprint: 'input-fp',
  parent_artifact_id: 'artifact', parent_artifact_fingerprint: 'artifact-fp',
} };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('does not enable finalization from an older in-flight result', async () => {
  vi.useFakeTimers();
  let finish!: (value: JobDraftCheck) => void;
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ...ready, status: 'blocked' });
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: '' } } });
  expect(h.result.current.ready).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => { finish(ready); await vi.advanceTimersByTimeAsync(1); });
  expect(h.result.current.ready).toBe(false);
  expect(check).toHaveBeenCalledTimes(2);
  expect(h.result.current.status).toBe('blocked');
});
it('marks failures unavailable and retries without changing content', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'checkJobDraft').mockRejectedValueOnce(Error('offline')).mockResolvedValue(ready);
  const h = renderHook(() => useJobDraftChecks('job', 'draft', candidate));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.result.current.status).toBe('unavailable');
  act(() => h.result.current.retry());
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.result.current.ready).toBe(true);
});

it('ignores an older error and checks the newest candidate', async () => {
  vi.useFakeTimers();
  let rejectOld!: (error: Error) => void;
  vi.spyOn(apiClient, 'checkJobDraft').mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; })).mockResolvedValue(ready);
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: 'New' } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); rejectOld(Error('old request failed')); await vi.advanceTimersByTimeAsync(1); });
  expect(h.result.current.status).toBe('ready');
  expect(h.result.current.error).toBeUndefined();
});
it('invalidates readiness on focus before rechecking', async () => {
  vi.useFakeTimers();
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockResolvedValue(ready);
  const h = renderHook(() => useJobDraftChecks('job', 'draft', candidate));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.result.current.ready).toBe(true);
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(h.result.current.ready).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(check).toHaveBeenCalledTimes(2);
});
it('does not schedule queued edits after unmount', async () => {
  vi.useFakeTimers();
  let finish!: (value: JobDraftCheck) => void;
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: 'New' } } });
  h.unmount();
  await act(async () => { finish(ready); await vi.advanceTimersByTimeAsync(1000); });
  expect(check).toHaveBeenCalledTimes(1);
});

it('rejects an earlier success even when editing returns to identical text', async () => {
  vi.useFakeTimers();
  let finish!: (value: JobDraftCheck) => void;
  vi.spyOn(apiClient, 'checkJobDraft').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockImplementation(() => new Promise(() => {}));
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: 'Intervening edit' } } });
  h.rerender({ spec: candidate });
  await act(async () => { finish(ready); });
  expect(h.result.current.ready).toBe(false);
});
