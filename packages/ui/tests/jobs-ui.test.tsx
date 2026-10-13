/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ArtifactVersion, Job, ResumeSpec } from '@featherduster/core';
import { apiClient, ApiError, type JobReview, type JobsControl, type JobsDetail } from '../src/api/client.js';
import { JobsView, matchesJobFilter } from '../src/views/jobs/JobsView.js';
import { JobDetail } from '../src/views/jobs/JobDetail.js';
import { JobIntake } from '../src/views/jobs/JobIntake.js';
import { JobAnswers } from '../src/views/jobs/JobAnswers.js';
import { WorkerControls } from '../src/views/jobs/WorkerControls.js';
import { JobResumeReview } from '../src/views/jobs/JobResumeReview.js';
import { jobsViewForPath, jobDraftForPath, tabForPath } from '../src/routing.js';
import { useJobsData } from '../src/hooks/useJobsData.js';

vi.mock('../src/api/events.js', () => ({ sseClient: { onJobs: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) } }));
const id = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';
const time = '2026-06-01T00:00:00Z';
function job(patch: Partial<Job> = {}): Job {
  return { schema_version: 1, id, workspace_id: 'workspace', revision: 2, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: time, updated_at: time, ...patch };
}
const stopped: JobsControl = { control: { schema_version: 1, workspace_id: 'workspace', revision: 1, automatic_preparation_enabled: false, pause_after_current: false, stop_generation: 1, stopped_at: time, updated_at: time }, active: [] };
const detail = (j = job()): JobsDetail => ({ job: j, posting: null, attempt: null, artifacts: [], events: [], answers: [], analysis: null, alignment: null, brief_markdown: null });
const spec: ResumeSpec = { profile: { name: 'Candidate', title: 'Engineer', email: 'a@example.com' }, summary: 'Original wording', experiences: [], education: [], skills: [] };
const ref = { id: 'immutable-ref', fingerprint: 'hash' };
const artifact: ArtifactVersion = { schema_version: 1, id: version, workspace_id: 'workspace', job_id: id, attempt_id: id, input_snapshot_id: id, input_fingerprint: 'input-hash', parent_version_id: null, created_at: time, source: ref, pdf: ref, preview: ref, validation_report: ref, validation_result: 'passed', version_fingerprint: 'artifact-hash' };
const review: JobReview = { artifact, draft: { schema_version: 1, id, workspace_id: 'workspace', job_id: id, revision: 0, input_snapshot_id: id, parent_artifact_version_id: null, candidate: { ...spec, summary: 'Actual cleaned candidate' }, proposals: { proposals: [] }, created_at: time, updated_at: time }, base_resume: spec, analysis: null, alignment: null, brief_markdown: '# Interview brief\nEvidence backed', validation_report: { passed: true }, preview_count: 1 };

beforeEach(() => {
  vi.spyOn(apiClient, 'getJobsControl').mockResolvedValue(stopped);
  vi.spyOn(apiClient, 'controlJobs').mockResolvedValue({});
  vi.spyOn(apiClient, 'prepareJob').mockResolvedValue({});
  vi.spyOn(apiClient, 'getJobs').mockResolvedValue({ jobs: [job()] });
  vi.spyOn(apiClient, 'getJob').mockResolvedValue(detail());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('routes validated job sections and linked drafts without interpreting them as runs', () => {
  expect(tabForPath(`/jobs/${id}/resume`)).toBe('jobs');
  expect(jobsViewForPath(`/jobs/${id}/answers/`)).toEqual({ id, section: 'answers' });
  expect(jobsViewForPath(`/jobs/${id}`)?.section).toBe('posting');
  expect(jobsViewForPath('/jobs/not-an-id/resume')).toBeNull();
  expect(jobsViewForPath(`/jobs/${id}/bad`)).toBeNull();
  expect(jobDraftForPath(`/tailor/canvas/jobs/${id}/${version}`)).toEqual({ jobId: id, draftId: version });
});
it('keeps application and preparation filters independent and retains archived records', async () => {
  expect(matchesJobFilter(job({ preparation_state: 'resume_ready' }), 'Applied')).toBe(false);
  expect(matchesJobFilter(job({ application_lifecycle: 'needs_input' }), 'Needs input')).toBe(true);
  for (const [filter, state] of [['Queued', 'queued'], ['Preparing', 'preparing'], ['Needs input', 'needs_input'], ['Resume ready', 'resume_ready'], ['Archived', 'cancelled']] as const) expect(matchesJobFilter(job({ preparation_state: state }), filter)).toBe(true);
  expect(matchesJobFilter(job({ application_lifecycle: 'submitted' }), 'Applied')).toBe(true);
  expect(matchesJobFilter(job({ preparation_state: 'failed' }), 'All')).toBe(true);
  render(<JobsView navigate={vi.fn()} />);
  expect(await screen.findByText('Acme — Engineer')).toBeInTheDocument();
  expect(screen.getByText('Preparation: queued · Application: not_started')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'Archived' } });
  expect(screen.getByText('Skipped and cancelled jobs; records are retained.')).toBeInTheDocument();
  expect(screen.getByText('No jobs match this filter.')).toBeInTheDocument();
  expect(apiClient.prepareJob).not.toHaveBeenCalled(); expect(apiClient.controlJobs).not.toHaveBeenCalled();
});
it('requires preview before committing mixed intake and never starts stopped work', async () => {
  const good = { index: 0, original: 'https://example.com/job', valid: true, error: null, fallback_available: false, job: job(), duplicate_id: null, candidates: [] };
  const invalid = { ...good, index: 1, original: 'bad', valid: false, error: { code: 'invalid', message: 'Invalid URL' }, job: null };
  vi.spyOn(apiClient, 'previewJobs').mockResolvedValue({ preview_id: version, preview: { workspace_id: 'workspace', items: [good, invalid, { ...good, index: 2, duplicate_id: id }] } });
  const add = vi.spyOn(apiClient, 'addJobs').mockResolvedValue({ items: [{ ...good, disposition: 'created', job_id: id }, { ...invalid, disposition: 'error', job_id: null }] });
  render(<JobIntake onSaved={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Add jobs' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Job URLs'), { target: { value: 'https://example.com/job\nbad' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add jobs' }));
  expect(await screen.findByText('Saved; automatic preparation is stopped.')).toBeInTheDocument();
  expect(add).toHaveBeenCalledWith(version, expect.any(String));
  expect(screen.getByText('Invalid URL')).toBeInTheDocument();
  expect(apiClient.controlJobs).not.toHaveBeenCalled(); expect(apiClient.prepareJob).not.toHaveBeenCalled();
});
it('retains fallback text on expired preview and sends the expected revision', async () => {
  const preview = vi.spyOn(apiClient, 'previewJobs').mockResolvedValue({ preview_id: version, preview: { workspace_id: 'workspace', items: [] } });
  vi.spyOn(apiClient, 'addJobs').mockRejectedValue(new ApiError('Preview expired', 404));
  render(<JobIntake fallback={{ id, revision: 2 }} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Posting text'), { target: { value: 'Keep this posting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add jobs' }));
  expect(await screen.findByText(/Preview expired/)).toBeInTheDocument();
  expect(screen.getByLabelText('Posting text')).toHaveValue('Keep this posting');
  expect(preview).toHaveBeenCalledWith({ mode: 'text', input: 'Keep this posting', fallback_job_id: id, expected_revision: 2 });
});
it('uses distinct worker mutations, keeps stop reachable and reuses keys after failures', async () => {
  const control = vi.mocked(apiClient.controlJobs);
  let finish!: (value: unknown) => void;
  control.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<WorkerControls />); await screen.findByText('Stopped');
  fireEvent.click(screen.getByRole('button', { name: 'Start automatic preparation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop processing' }));
  await waitFor(() => expect(control).toHaveBeenCalledWith('stop', expect.any(String)));
  finish({}); await waitFor(() => expect(screen.getByRole('button', { name: 'Pause after current' })).toBeEnabled());
  control.mockRejectedValue(new Error('Offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Pause after current' })); await screen.findByText('Offline');
  const key = control.mock.calls.at(-1)![1];
  fireEvent.click(screen.getByRole('button', { name: 'Pause after current' }));
  await waitFor(() => expect(control.mock.calls.at(-1)).toEqual(['pause', key]));
  expect(screen.getByText('Stopped')).toBeInTheDocument();
});
it('renders direct detail sections read-only and updates section URLs', async () => {
  const navigate = vi.fn();
  render(<JobDetail id={id} section="fit" navigate={navigate} />);
  expect(await screen.findByText('Not assessed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Application History' }));
  expect(navigate).toHaveBeenCalledWith(`/jobs/${id}/history`);
  expect(apiClient.prepareJob).not.toHaveBeenCalled();
});
it('retains a scoped answer after conflict and never resumes implicitly', async () => {
  const q: Job['missing_inputs'][number] = { key: 'salary', question: 'Expected salary?', scope: { kind: 'job', job_id: id }, reason: 'Required by employer' };
  const save = vi.spyOn(apiClient, 'saveJobAnswer').mockRejectedValue(new ApiError('Stale revision', 409));
  render(<JobAnswers job={job({ missing_inputs: [q] })} answers={[]} onSaved={vi.fn()} />);
  expect(screen.getByText(`Job: ${id}`)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'confirmed' } });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '125000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm answer' }));
  await screen.findByText('Stale revision');
  expect(screen.getByRole('textbox')).toHaveValue('125000');
  expect(save).toHaveBeenCalledWith(id, { expected_revision: 2, ...q, reason: undefined, status: 'confirmed', value: 125000 });
  expect(apiClient.controlJobs).not.toHaveBeenCalled(); expect(apiClient.prepareJob).not.toHaveBeenCalled();
});
it('shows immutable actual candidate diff, PDF, brief and exact approval binding', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue(review);
  const approve = vi.spyOn(apiClient, 'approveJobResume').mockResolvedValue({ review: { schema_version: 1, id, workspace_id: 'workspace', job_id: id, artifact_version_id: version, artifact_fingerprint: 'artifact-hash', input_snapshot_id: id, input_fingerprint: 'input-hash', reviewer_id: 'human', reviewed_at: time, decision: 'approved' } });
  const onSaved = vi.fn();
  render(<JobResumeReview job={job()} artifacts={[artifact]} events={[]} onSaved={onSaved} navigate={vi.fn()} />);
  await screen.findByText('Base to candidate diff');
  expect([...document.querySelectorAll('ins')].map(n => n.textContent).join(' ')).toContain('Actual cleaned candidate');
  expect(screen.getByTitle('Resume PDF preview')).toHaveAttribute('src', `/api/jobs/${id}/artifacts/${version}/pdf`);
  expect(screen.getByAltText('Resume page 1')).toHaveAttribute('src', `/api/jobs/${id}/artifacts/${version}/previews/1`);
  expect(screen.getByText('Evidence backed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Approve Resume' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(approve).toHaveBeenCalledWith(id, version, { expected_job_revision: 2, artifact_fingerprint: 'artifact-hash', input_snapshot_id: id, input_fingerprint: 'input-hash', idempotency_key: expect.any(String) });
});
it('blocks failed validation but permits explicit historical draft fork', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue({ ...review, artifact: { ...artifact, validation_result: 'failed' } });
  const fork = vi.spyOn(apiClient, 'editJobResume').mockResolvedValue({ draft: review.draft }); const navigate = vi.fn();
  render(<JobResumeReview job={job()} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={navigate} />);
  expect(await screen.findByRole('button', { name: 'Approve Resume' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue Editing' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/tailor/canvas/jobs/${id}/${id}`));
  expect(fork).toHaveBeenCalledTimes(1);
});
it('suppresses late reads from a previous job and reconciles without writes', async () => {
  let resolve!: (value: string) => void;
  const first = vi.fn(() => new Promise<string>(r => { resolve = r; }));
  const second = vi.fn(async () => 'second job');
  function View({ load }: { load: () => Promise<string> }) { const { data } = useJobsData(load); return <p>{data}</p>; }
  const view = render(<View load={first} />);
  view.rerender(<View load={second} />); await screen.findByText('second job');
  resolve('stale job'); await waitFor(() => expect(screen.queryByText('stale job')).not.toBeInTheDocument());
  expect(apiClient.controlJobs).not.toHaveBeenCalled();
});
