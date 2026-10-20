/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { JobDraft, ResumeSpec } from '@featherduster/core';
import { apiClient, ApiError } from '../src/api/client.js';
import { JobDraftActions, type JobLeaveGuard } from '../src/views/jobs/JobDraftActions.js';
import type { JobDraftChecks } from '../src/views/jobs/useJobDraftChecks.js';
const id = '11111111-1111-4111-8111-111111111111';
const candidate: ResumeSpec = { profile: { name: 'Saved', title: 'Engineer', email: 'saved@example.com' }, experiences: [], education: [], skills: [] };
const changed = { ...candidate, profile: { ...candidate.profile, name: 'Local edits' } };
const draft: JobDraft = { schema_version: 1, id, job_id: id, workspace_id: id, revision: 1, input_snapshot_id: id,
  parent_artifact_version_id: id, candidate, proposals: { proposals: [] }, created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z' };
const check: JobDraftChecks = { ready: true, status: 'ready', issues: [], retry: vi.fn(), error: undefined, check: {
  status: 'ready', issues: [], job_revision: 2, binding: { candidate_fingerprint: 'candidate', context_fingerprint: 'context',
    input_snapshot_id: id, input_fingerprint: 'input', parent_artifact_id: id, parent_artifact_fingerprint: 'parent' } } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
function setup(extra = {}) {
  const props = { draft, candidate: changed, checks: check, onSaved: vi.fn(), onBack: vi.fn(), onBusy: vi.fn(), onFocusIssue: vi.fn(), ...extra };
  return { props, view: render(<JobDraftActions {...props} />) };
}
it('opens input review directly for saved stale drafts instead of retrying checks', () => {
  const onReviewInputs = vi.fn();
  setup({ candidate, onReviewInputs, checks: { ...check, ready: false, status: 'unavailable',
    error: 'Job scope changed. Review current inputs first.' } });
  expect(screen.getByText('Current inputs need review. Saving is available.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry checks' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Finalize resume' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review current inputs' }));
  expect(onReviewInputs).toHaveBeenCalledOnce();
});
it('keeps edits in the canvas until saving succeeds before input review', async () => {
  const onReviewInputs = vi.fn();
  const save = vi.spyOn(apiClient, 'saveJobDraft').mockRejectedValueOnce(Error('Offline'))
    .mockResolvedValueOnce({ draft: { ...draft, revision: 2, candidate: changed } });
  const { props } = setup({ onReviewInputs, checks: { ...check, ready: false, status: 'unavailable',
    error: 'Job scope changed. Review current inputs first.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review current inputs' }));
  expect(onReviewInputs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
  await screen.findByText('Offline');
  expect(onReviewInputs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
  await waitFor(() => expect(onReviewInputs).toHaveBeenCalledOnce());
  expect(save).toHaveBeenLastCalledWith(id, id, 1, changed);
  expect(props.onBack).not.toHaveBeenCalled();
});
it('offers a working retry for temporary check failures', () => {
  const retry = vi.fn(), onReviewInputs = vi.fn();
  setup({ onReviewInputs, checks: { ...check, retry, ready: false, status: 'unavailable', error: 'Offline' } });
  expect(screen.queryByRole('button', { name: 'Review current inputs' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry checks' }));
  expect(retry).toHaveBeenCalledOnce();
});
it('saves invalid content before following the requested internal destination', async () => {
  let guard: JobLeaveGuard | null = null;
  const proceed = vi.fn();
  const save = vi.spyOn(apiClient, 'saveJobDraft').mockResolvedValue({ draft: { ...draft, revision: 2, candidate: changed } });
  const { props } = setup({ candidate: { ...changed, profile: { ...changed.profile, name: '' } },
    checks: { ...check, ready: false, status: 'blocked' }, onLeaveGuard: (next: JobLeaveGuard | null) => { guard = next; } });
  act(() => guard!(() => proceed()));
  await screen.findByRole('region', { name: 'Unsaved changes' });
  expect(screen.getByRole('button', { name: 'Save and return' })).toHaveFocus();
  expect(proceed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
  await waitFor(() => expect(proceed).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(id, id, 1, props.candidate);
  expect(props.onBack).not.toHaveBeenCalled();
});
it('stays with local edits or explicitly discards to the saved candidate', async () => {
  const discard = vi.fn(); const { props } = setup({ onDiscard: discard });
  const back = screen.getByRole('button', { name: 'Back to resume' });
  fireEvent.click(back); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(back).toHaveFocus(); expect(props.onBack).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled();
  fireEvent.click(back); fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes and return' }));
  expect(discard).toHaveBeenCalledWith(candidate); expect(props.onBack).toHaveBeenCalledOnce();
});
it('never leaves if new edits arrive during an earlier save', async () => {
  let finish!: (value: { draft: JobDraft }) => void;
  vi.spyOn(apiClient, 'saveJobDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { props, view } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
  view.rerender(<JobDraftActions {...props} candidate={{ ...changed, summary: 'Newer words' }} />);
  finish({ draft: { ...draft, revision: 2, candidate: changed } });
  await screen.findByText('New edits arrived while saving. Save again before leaving.');
  expect(props.onBack).not.toHaveBeenCalled();
});
it('conflict reload exposes the latest saved content without replacing local edits', async () => {
  vi.spyOn(apiClient, 'saveJobDraft').mockRejectedValueOnce(new ApiError('A newer revision exists', 409))
    .mockResolvedValueOnce({ draft: { ...draft, revision: 4, candidate: changed } });
  vi.spyOn(apiClient, 'getJobDraft').mockResolvedValue({ draft: { ...draft, revision: 3, candidate: { ...candidate, summary: 'Other saved words' } } });
  const { props } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review latest saved revision' }));
  await screen.findByText('Latest saved revision loaded. Your local edits are retained; review before saving over it.');
  expect(screen.getByText(/Other saved words/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(apiClient.saveJobDraft).toHaveBeenLastCalledWith(id, id, 3, props.candidate));
});
it('recovers a lost finalization receipt after remount with the original intent', async () => {
  vi.spyOn(apiClient, 'saveJobDraft').mockResolvedValue({ draft: { ...draft, candidate: changed, revision: 2 } });
  const finalize = vi.spyOn(apiClient, 'finalizeJobDraft').mockRejectedValueOnce(Error('Response lost'))
    .mockResolvedValueOnce({ artifact: { id } as never });
  const { props, view } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Finalize resume' }));
  await screen.findByText('Response lost');
  const original = finalize.mock.calls[0][2];
  view.unmount();
  render(<JobDraftActions {...props} draft={{ ...draft, revision: 2, candidate: changed }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check finalization result' }));
  await waitFor(() => expect(props.onBack).toHaveBeenCalledOnce());
  expect(finalize.mock.calls[1][2]).toEqual(original);
  expect(sessionStorage.getItem(`job-finalize:${id}:${id}`)).toBeNull();
});
