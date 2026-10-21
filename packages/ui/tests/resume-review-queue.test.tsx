/** @vitest-environment jsdom */
import { finishPreview } from './fixtures/rendered-preview.js';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ArtifactVersion, Job } from '@featherduster/core';
import { JobResumeReview } from '../src/views/jobs/JobResumeReview.js';
import { ResumeReviewQueue } from '../src/views/jobs/ResumeReviewQueue.js';
import { apiClient, ApiError, type JobsDetail, type JobReview, type PreparationBatchProgress } from '../src/api/client.js';
vi.mock('../src/api/events.js', () => ({ sseClient: { onJobs: () => () => {}, onStatus: () => () => {} } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
const spec = { profile: { name: 'Candidate', title: 'Engineer', email: 'candidate@example.com' }, experiences: [], skills: [], education: [] };
const time = '2026-10-20T00:00:00Z', ref = { id: 'pdf', fingerprint: 'bytes' };
const artifact = (jobId: string): ArtifactVersion => ({ schema_version: 1, workspace_id: 'workspace', attempt_id: 'attempt', source: ref, preview: ref, validation_report: ref, parent_version_id: null,
  id: `${jobId}-pdf`, job_id: jobId, version_fingerprint: `${jobId}-hash`, input_snapshot_id: 'input', input_fingerprint: 'input-hash', pdf: ref, validation_result: 'passed', created_at: time });
const job = (id: string): Job => ({ schema_version: 1, id, workspace_id: 'workspace', revision: 1, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null,
  company: id, role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'resume_ready', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null,
  template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [artifact(id).id], missing_inputs: [], confirmation_provenance: [], state_reason: null,
  created_at: time, updated_at: time, context_url: 'https://example.com/posting' });
function setup() {
  const ids = ['second-selected', 'first-display-sort', 'third-selected'];
  const progress: PreparationBatchProgress = { batch: { id: 'batch', workspace_id: 'workspace', created_at: '2026-10-20T00:00:00Z', members: ids.map((job_id, position) => ({ job_id, position, input_snapshot_id: 'input', input_fingerprint: 'input-hash' })) },
    members: ids.map(job_id => ({ job_id, state: 'ready' })), queue: ids.map(job_id => ({ job_id, artifact_id: artifact(job_id).id, artifact_fingerprint: artifact(job_id).version_fingerprint, approved: false })),
    counts: { preparing: 0, questions: 0, technical: 0, ready: 3, approved: 0 }, repairs: [{ id: 'mechanical', job_id: ids[0], before: 'SQL, SQL, invented', after: 'SQL', reason: 'Removed a duplicate and unknown reorder entry.', meaningful: false }], decisions: [] };
  vi.spyOn(apiClient, 'getPreparationBatch').mockResolvedValue(progress);
  vi.spyOn(apiClient, 'getJob').mockImplementation(async id => ({ job: job(id),
    artifacts: [artifact(id)], events: [], answers: [], posting: null, attempt: null, analysis: null, alignment: null, brief_markdown: null }) as JobsDetail);
  vi.spyOn(apiClient, 'getJobReview').mockImplementation(async id => ({ artifact: artifact(id), draft: { schema_version: 1, id: 'draft', workspace_id: 'workspace', job_id: id, revision: 0, input_snapshot_id: 'input', parent_artifact_version_id: null, created_at: time, updated_at: time, candidate: spec, proposals: { proposals: [] } }, base_resume: spec, analysis: null, alignment: null, brief_markdown: null, preview_count: 1, validation_report: { passed: true } }) as JobReview);
  return { ids, progress };
}
it('stays on a failed exact-version approval and advances only after success', async () => {
  const { ids } = setup(), approve = vi.spyOn(apiClient, 'approveJobResume').mockRejectedValueOnce(new ApiError('Reload this PDF', 409)).mockResolvedValue({} as never);
  render(<ResumeReviewQueue batchId="batch" navigate={vi.fn()} />);
  finishPreview(await screen.findByAltText('Resume page 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve & next' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload this PDF');
  expect(screen.getByRole('heading', { name: `${ids[0]} — Engineer` })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reload review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve & next' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Approve & next' }));
  await screen.findByRole('heading', { name: `${ids[1]} — Engineer` });
  expect(approve.mock.calls[0][2]).toMatchObject({ artifact_fingerprint: `${ids[0]}-hash`, input_fingerprint: 'input-hash' });
  expect(approve.mock.calls[1][2].idempotency_key).toBe(approve.mock.calls[0][2].idempotency_key);
});
it('defers three PDFs to completion without approving or looping, and keeps Details secondary', async () => {
  const { ids } = setup(), approve = vi.spyOn(apiClient, 'approveJobResume');
  render(<ResumeReviewQueue batchId="batch" navigate={vi.fn()} />);
  for (const id of ids) {
    await screen.findByRole('heading', { name: `${id} — Engineer` });
    finishPreview(await screen.findByAltText('Resume page 1'));
    expect(screen.getByRole('button', { name: 'Details' })).toBeVisible();
    if (id === ids[0]) {
      fireEvent.click(screen.getByRole('button', { name: 'Details' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Version history' }));
      fireEvent.click(screen.getByText('Automatic repair history'));
      expect(screen.getByText('Mechanical: Removed a duplicate and unknown reorder entry.')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
      expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Review later' }));
  }
  expect(await screen.findByRole('heading', { name: 'All remaining resumes reviewed later' })).toBeVisible();
  expect(approve).not.toHaveBeenCalled();
  expect(screen.getByText(/Deferred 3/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Revisit deferred resumes' }));
  await screen.findByRole('heading', { name: `${ids[0]} — Engineer` });
});
it('requires a loaded current page, exposes preview recovery, and never approves a failed image', async () => {
  setup(); const approve = vi.spyOn(apiClient, 'approveJobResume').mockResolvedValue({} as never);
  render(<ResumeReviewQueue batchId="batch" navigate={vi.fn()} />);
  const pending = await screen.findByAltText('Resume page 1');
  expect(screen.getByRole('button', { name: 'Approve & next' })).toBeDisabled();
  expect(screen.getByText('Loading current PDF preview…')).toBeVisible();
  fireEvent.error(pending);
  expect(await screen.findByRole('alert')).toHaveTextContent('Current PDF preview could not load');
  fireEvent.click(screen.getByRole('button', { name: 'Approve & next' })); expect(approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  const retry = screen.getByAltText('Resume page 1'); expect(retry).not.toBe(pending);
  finishPreview(retry);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve & next' })).toBeEnabled());
});
it('does not reuse a late decode from the preceding artifact as current preview readiness', async () => {
  const { ids } = setup(), id = ids[0], original = artifact(id), saved = await apiClient.getJobReview(id, original.id);
  let resolve!: () => void;
  const decoding = new Promise<void>(done => { resolve = done; });
  const props = { job: job(id), artifacts: [original], events: [], onSaved: vi.fn(), navigate: vi.fn(), queue: { artifactId: original.id, onApproved: vi.fn(), onLater: vi.fn() } };
  const view = render(<JobResumeReview {...props} />);
  const oldImage = await screen.findByAltText('Resume page 1');
  Object.defineProperty(oldImage, 'decode', { value: () => decoding }); finishPreview(oldImage);
  const newer = { ...original, id: 'new-current-artifact', version_fingerprint: 'new-current-hash' };
  vi.mocked(apiClient.getJobReview).mockResolvedValue({ ...saved, artifact: newer });
  view.rerender(<JobResumeReview {...props} artifacts={[original, newer]} queue={{ ...props.queue, artifactId: newer.id }} />);
  await waitFor(() => expect(screen.getByAltText('Resume page 1')).toHaveAttribute('src', expect.stringContaining(newer.id)));
  await act(async () => { resolve(); await decoding; });
  expect(screen.getByRole('button', { name: 'Approve & next' })).toBeDisabled();
  finishPreview(screen.getByAltText('Resume page 1'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve & next' })).toBeEnabled());
});
