/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import type { JobDraft, JobDraftCheck } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobDraftActions as Actions } from '../src/views/jobs/JobDraftActions.js';
import { useJobDraftChecks } from '../src/views/jobs/useJobDraftChecks.js';
function JobDraftActions(props: Omit<ComponentProps<typeof Actions>, 'checks'>) {
  const checks = useJobDraftChecks(props.draft.job_id, props.draft.id, props.candidate);
  return <Actions {...props} checks={checks} />;
}
const spec = { profile: { name: 'Name', title: 'Engineer', email: 'a@example.com' }, experiences: [], education: [], skills: [] };
const draft: JobDraft = { schema_version: 1, id: 'draft', workspace_id: 'workspace', job_id: 'job', revision: 2,
  input_snapshot_id: 'input', parent_artifact_version_id: 'artifact', candidate: spec, proposals: { proposals: [] },
  created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z' };
const ready: JobDraftCheck = { status: 'ready', issues: [], job_revision: 4, binding: {
  candidate_fingerprint: 'fp', context_fingerprint: 'ctx', input_snapshot_id: 'input', input_fingerprint: 'ifp',
  parent_artifact_id: 'artifact', parent_artifact_fingerprint: 'afp' } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
it('saves invalid edits even when checking fails', async () => {
  vi.spyOn(apiClient, 'checkJobDraft').mockRejectedValue(Error('offline'));
  const save = vi.spyOn(apiClient, 'saveJobDraft').mockResolvedValue({ draft: { ...draft, revision: 3 } });
  render(<JobDraftActions draft={draft} candidate={{ ...spec, profile: { ...spec.profile, name: '' } }}
    onSaved={() => {}} onBack={() => {}} onBusy={() => {}} onFocusIssue={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('job', 'draft', 2, expect.objectContaining({ profile: expect.objectContaining({ name: '' }) })));
  expect(screen.getByRole('button', { name: 'Finalize resume' })).toBeDisabled();
});
it('finalizes the saved edited revision and returns after success', async () => {
  vi.spyOn(apiClient, 'checkJobDraft').mockResolvedValue(ready);
  vi.spyOn(apiClient, 'saveJobDraft').mockResolvedValue({ draft: { ...draft, revision: 3 } });
  const finalize = vi.spyOn(apiClient, 'finalizeJobDraft').mockResolvedValue({ artifact: { id: 'new' } as never });
  const back = vi.fn();
  render(<JobDraftActions draft={draft} candidate={{ ...spec, profile: { ...spec.profile, name: 'Edited' } }}
    onSaved={() => {}} onBack={back} onBusy={() => {}} onFocusIssue={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Finalize resume' })).toBeEnabled(), { timeout: 2000 });
  fireEvent.click(screen.getByRole('button', { name: 'Finalize resume' }));
  await waitFor(() => expect(finalize).toHaveBeenCalledWith('job', 'draft', expect.objectContaining({ expected_draft_revision: 3, binding: ready.binding })));
  expect(back).toHaveBeenCalledOnce();
});

