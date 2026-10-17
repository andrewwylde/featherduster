/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ArtifactVersion, Job, ResumeSpec } from '@featherduster/core';
import { apiClient, ApiError, type JobReview, type JobsControl, type JobsDetail } from '../src/api/client.js';
import { JobsView, matchesJobFilter, getJobPriority, compareJobs, isNeedsInput, isQueued } from '../src/views/jobs/JobsView.js';
import { JobDetail } from '../src/views/jobs/JobDetail.js';
import { JobDetailsEditor } from '../src/views/jobs/JobDetailsEditor.js';
import { JobIntake } from '../src/views/jobs/JobIntake.js';
import { JobAnswers } from '../src/views/jobs/JobAnswers.js';
import { WorkerControls } from '../src/views/jobs/WorkerControls.js';
import { QueueVisualization } from '../src/views/jobs/QueueVisualization.js';
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
  const heading = await screen.findByRole('heading', { level: 2, name: 'Acme — Engineer' });
  expect(within(heading).getByRole('link')).toHaveAttribute('href', `/jobs/${id}`);
  expect(screen.queryByText(/Application: not_started/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Filter saved jobs and retained history'));
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
  fireEvent.click(screen.getByRole('button', { name: 'URLs' }));
  fireEvent.change(screen.getByLabelText('Job URLs'), { target: { value: 'https://example.com/job\nbad' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add jobs' }));
  expect(await screen.findByText('Saved. Preparation starts only when you request it.')).toBeInTheDocument();
  expect(add).toHaveBeenCalledWith(version, expect.any(String));
  expect(screen.getByText('Invalid URL')).toBeInTheDocument();
  expect(apiClient.controlJobs).not.toHaveBeenCalled(); expect(apiClient.prepareJob).not.toHaveBeenCalled();
});
it('retains fallback text on expired preview and sends the expected revision', async () => {
  const preview = vi.spyOn(apiClient, 'previewJobs').mockResolvedValue({ preview_id: version, preview: { workspace_id: 'workspace', items: [] } });
  vi.spyOn(apiClient, 'addJobs').mockRejectedValue(new ApiError('Preview expired', 404));
  render(<JobIntake fallback={{ id, revision: 2 }} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Posting text'), { target: { value: 'Keep this posting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save job' }));
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
  vi.spyOn(apiClient, 'getJobFit').mockResolvedValue({ current: null, history: [] });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  render(<JobDetail id={id} section="fit" navigate={navigate} />);
  expect(await screen.findByText(/Not assessed yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'History' }));
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
it('keeps the previously loaded resume review visible when a reload times out', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, latest_input_snapshot_id: id, input_snapshot_id: id });
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValueOnce(review).mockRejectedValueOnce(new Error('Request timed out after 15s: /api/jobs/job/artifacts/review'));
  render(<JobResumeReview job={job()} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  await screen.findByText('Base to candidate diff');
  fireEvent.click(screen.getByRole('button', { name: 'Reload review' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Base to candidate diff')).toBeInTheDocument();
  expect(screen.getByTitle('Resume PDF preview')).toHaveAttribute('src', `/api/jobs/${id}/artifacts/${version}/pdf`);
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
it('sorts jobs by needs_input, queued, then others, sub-sorted by created date', async () => {
  const jobOlderSubmitted = job({
    id: '00000000-0000-4000-8000-000000000001',
    company: 'Alpha Corp',
    role: 'Engineer 1',
    preparation_state: 'skipped',
    application_lifecycle: 'submitted',
    created_at: '2026-06-01T00:00:00Z',
  });
  const jobNewerSubmitted = job({
    id: '00000000-0000-4000-8000-000000000002',
    company: 'Beta Inc',
    role: 'Engineer 2',
    preparation_state: 'skipped',
    application_lifecycle: 'submitted',
    created_at: '2026-06-02T00:00:00Z',
  });
  const jobOlderQueued = job({
    id: '00000000-0000-4000-8000-000000000003',
    company: 'Gamma LLC',
    role: 'Engineer 3',
    preparation_state: 'queued',
    application_lifecycle: 'not_started',
    created_at: '2026-06-03T00:00:00Z',
  });
  const jobNewerQueued = job({
    id: '00000000-0000-4000-8000-000000000004',
    company: 'Delta Co',
    role: 'Engineer 4',
    preparation_state: 'queued',
    application_lifecycle: 'not_started',
    created_at: '2026-06-04T00:00:00Z',
  });
  const jobNeedsInput = job({
    id: '00000000-0000-4000-8000-000000000005',
    company: 'Epsilon Tech',
    role: 'Engineer 5',
    preparation_state: 'needs_input',
    application_lifecycle: 'not_started',
    created_at: '2026-06-05T00:00:00Z',
  });

  expect(getJobPriority(jobNeedsInput)).toBe(0);
  expect(getJobPriority(jobOlderQueued)).toBe(1);
  expect(getJobPriority(jobOlderSubmitted)).toBe(2);

  const unsorted = [jobOlderSubmitted, jobNewerSubmitted, jobOlderQueued, jobNewerQueued, jobNeedsInput];
  const sortedDesc = [...unsorted].sort((a, b) => compareJobs(a, b, 'desc'));
  expect(sortedDesc.map(j => j.company)).toEqual([
    'Epsilon Tech',
    'Delta Co',
    'Gamma LLC',
    'Beta Inc',
    'Alpha Corp',
  ]);

  const sortedAsc = [...unsorted].sort((a, b) => compareJobs(a, b, 'asc'));
  expect(sortedAsc.map(j => j.company)).toEqual([
    'Epsilon Tech',
    'Gamma LLC',
    'Delta Co',
    'Alpha Corp',
    'Beta Inc',
  ]);

  vi.spyOn(apiClient, 'getJobs').mockResolvedValue({ jobs: unsorted });
  render(<JobsView navigate={vi.fn()} />);

  await screen.findByText(/Epsilon Tech — Engineer 5/);
  const headings = screen
    .getAllByRole('heading', { level: 2 })
    .map(h => h.textContent)
    .filter(t => t !== 'Save a job');
  expect(headings[0]).toContain('Epsilon Tech — Engineer 5');
  expect(headings[1]).toContain('Delta Co — Engineer 4');
  expect(headings[2]).toContain('Gamma LLC — Engineer 3');
  expect(headings[3]).toContain('Beta Inc — Engineer 2');
  expect(headings[4]).toContain('Alpha Corp — Engineer 1');

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sort order' }));
  const toggledHeadings = screen
    .getAllByRole('heading', { level: 2 })
    .map(h => h.textContent)
    .filter(t => t !== 'Save a job');
  expect(toggledHeadings[0]).toContain('Epsilon Tech — Engineer 5');
  expect(toggledHeadings[1]).toContain('Gamma LLC — Engineer 3');
  expect(toggledHeadings[2]).toContain('Delta Co — Engineer 4');
  expect(toggledHeadings[3]).toContain('Alpha Corp — Engineer 1');
  expect(toggledHeadings[4]).toContain('Beta Inc — Engineer 2');
});

it('keeps isQueued and isNeedsInput strictly mutually exclusive for jobs with missing inputs', () => {
  const jobWithMissingInput = job({
    preparation_state: 'queued',
    missing_inputs: [{
      key: 'preparation_setup',
      question: 'Configure runner',
      scope: { kind: 'job', job_id: id },
      reason: 'Setup required',
    }],
  });
  expect(isNeedsInput(jobWithMissingInput)).toBe(true);
  expect(isQueued(jobWithMissingInput)).toBe(false);
  expect(matchesJobFilter(jobWithMissingInput, 'Needs input')).toBe(true);
  expect(matchesJobFilter(jobWithMissingInput, 'Queued')).toBe(false);
});


it.each([false, true])('routes setup to Settings independently of existing review (%s)', async (hasReview) => {
  const navigate = vi.fn();
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(job({ preparation_state: 'needs_input', recovery: { kind: 'setup' } as Job['recovery'] })), ...(hasReview ? { proposal_review: { availability: 'available' as const, review_id: 'review', revision: 0, status: 'blocked' as const, blocking_count: 1, input_stale: true } } : {}) });
  render(<JobDetail id={id} section="posting" navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve setup' }));
  expect(navigate).toHaveBeenLastCalledWith('/settings');
  if (hasReview) {
    fireEvent.click(screen.getByRole('button', { name: 'Resolve proposals' }));
    expect(navigate).toHaveBeenLastCalledWith(`/jobs/${id}/resume`);
  }
  expect(apiClient.prepareJob).not.toHaveBeenCalled();
});

it('offers explicit preparation for a saved job without generating on entry', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue(detail(job({ preparation_state: 'saved' })));
  render(<JobDetail id={id} section="posting" navigate={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Tailor resume' })).toBeInTheDocument();
  expect(apiClient.prepareJob).not.toHaveBeenCalled();
  expect(apiClient.controlJobs).not.toHaveBeenCalled();
});


it('keeps populated details textareas named by their field, not their saved content', () => {
  localStorage.clear();
  render(<JobDetailsEditor job={job({ notes: 'Saved note that must not become the field name' })} posting={null} onSaved={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Saved note that must not become the field name');
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('aria-label', 'Notes');
  expect(screen.getByRole('textbox', { name: 'Posting and context' })).toHaveAttribute('aria-label', 'Posting and context');
});

it('retains manual detail drafts across polling, remount and conflicts without generation', async () => {
  localStorage.clear();
  const original = job({ preparation_state: 'saved', notes: 'Saved note' });
  const saved = vi.spyOn(apiClient, 'saveJobDetails').mockResolvedValue({ result: { job: { ...original, revision: 4, notes: 'My note' } }, replayed: false });
  const onSaved = vi.fn();
  const view = render(<JobDetailsEditor job={original} posting={null} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'My note' } });
  view.rerender(<JobDetailsEditor job={{ ...original, revision: 3, notes: 'Other tab' }} posting={null} onSaved={onSaved} />);
  expect(screen.getByLabelText('Notes')).toHaveValue('My note');
  expect(screen.getByRole('button', { name: 'Save job details' })).toBeDisabled();
  view.unmount();
  render(<JobDetailsEditor job={{ ...original, revision: 3 }} posting={null} onSaved={onSaved} />);
  expect(screen.getByLabelText('Notes')).toHaveValue('My note');
  fireEvent.click(screen.getByRole('button', { name: 'Keep my draft against current revision' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save job details' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(saved).toHaveBeenCalledWith(id, expect.objectContaining({ expected_revision: 3, changes: expect.objectContaining({ notes: 'My note' }) }));
  expect(apiClient.prepareJob).not.toHaveBeenCalled();
  expect(localStorage.getItem(`job-details:workspace:${id}`)).toBeNull();
});

it('leads ready review with the current PDF and discloses earlier corrections', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue(review);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  expect(await screen.findByTitle('Resume PDF preview')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Current resume' })).toBeVisible();
  expect(screen.getByText('Earlier corrections').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Comparison, evidence and preparation history').closest('details')).not.toHaveAttribute('open');
});

it('labels working edits separately from the validated PDF and returns to the durable linked draft', async () => {
  const navigate = vi.fn();
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue({ ...review, working_draft: { ...review.draft, id: 'working', revision: 1, candidate: { ...spec, summary: 'Pending working wording' } } });
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={navigate} />);
  expect(await screen.findByRole('heading', { name: 'Current working resume — edits pending checks' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Last validated resume' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Approve Resume' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Return to working resume' }));
  expect(navigate).toHaveBeenCalledWith(`/tailor/canvas/jobs/${id}/working`);
});

it('visualizes active worker task stages, metrics, and allows cancelling active task', async () => {
  const cancelSpy = vi.spyOn(apiClient, 'cancelJob').mockResolvedValue({});
  const activeJob = job({ id: 'active-job-1', company: 'Stripe', role: 'Staff Engineer', revision: 3, preparation_state: 'preparing' });
  const queuedJob = job({ id: 'queued-job-2', company: 'Linear', role: 'Frontend Engineer', revision: 1, preparation_state: 'queued' });
  const activeAttempt = {
    schema_version: 1 as const,
    id: 'attempt-1',
    workspace_id: 'workspace',
    job_id: activeJob.id,
    attempt_number: 1,
    status: 'active' as const,
    current_stage: 'alignment' as const,
    input_snapshot_id: 'snap-1',
    runner: 'mock',
    policy_fingerprint: 'fp-1',
    lease_expires_at: time,
    stop_generation: 1,
    checkpoint_ids: [],
    started_at: new Date(Date.now() - 65000).toISOString(),
    finished_at: null,
    cancelled_at: null,
    error: null,
    resource_usage: { model_calls: 4, repair_attempts: 0, elapsed_ms: 65000 },
  };

  const onRefresh = vi.fn();
  render(
    <QueueVisualization
      activeAttempts={[activeAttempt]}
      jobs={[activeJob, queuedJob]}
      onRefresh={onRefresh}
      navigate={vi.fn()}
    />
  );

  // Active worker task card is displayed with stage progress and metrics
  expect(screen.getByText('Active Worker Task')).toBeInTheDocument();
  expect(screen.getByText(/Stripe — Staff Engineer/)).toBeInTheDocument();
  expect(screen.getByText('Alignment:')).toBeInTheDocument();
  expect(screen.getByText(/Grounding requirements against verified accomplishment ledger entries/)).toBeInTheDocument();
  expect(screen.getByText('4 calls')).toBeInTheDocument();

  // Upcoming queue is displayed with ranking badge
  expect(screen.getByText('Upcoming Queue')).toBeInTheDocument();
  expect(screen.getByText('#1 Next')).toBeInTheDocument();
  expect(screen.getByText(/Linear — Frontend Engineer/)).toBeInTheDocument();

  // Cancel active task interaction with confirmation
  fireEvent.click(screen.getByRole('button', { name: /Cancel task/ }));
  expect(screen.getByText('Cancel active?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));

  await waitFor(() => {
    expect(cancelSpy).toHaveBeenCalledWith('active-job-1', {
      expected_revision: 3,
      idempotency_key: expect.any(String),
      reason: 'Cancelled by user from queue',
    });
  });
  expect(onRefresh).toHaveBeenCalled();
});

it('allows cancelling a queued job from queue visualization and jobs view', async () => {
  const cancelSpy = vi.spyOn(apiClient, 'cancelJob').mockResolvedValue({});
  const queuedJob = job({ id: 'queued-job-2', company: 'Notion', role: 'Product Engineer', revision: 2, preparation_state: 'queued' });

  // 1. In QueueVisualization
  const onRefresh = vi.fn();
  render(
    <QueueVisualization
      activeAttempts={[]}
      jobs={[queuedJob]}
      onRefresh={onRefresh}
    />
  );
  expect(screen.queryByText('Queue is empty.')).not.toBeInTheDocument();
  expect(screen.getByText(/Notion — Product Engineer/)).toBeInTheDocument();

  // Click cancel button on queue item
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Cancel?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

  await waitFor(() => {
    expect(cancelSpy).toHaveBeenCalledWith('queued-job-2', {
      expected_revision: 2,
      idempotency_key: expect.any(String),
      reason: 'Cancelled by user from queue',
    });
  });
});

it('supports cancelling jobs from JobsView and JobDetail', async () => {
  const cancelSpy = vi.spyOn(apiClient, 'cancelJob').mockResolvedValue({});
  const testJob = job({ id: 'job-cancel-test', company: 'Figma', role: 'Design Tech', revision: 4, preparation_state: 'queued' });

  // In JobDetail
  vi.spyOn(apiClient, 'getJob').mockResolvedValue(detail(testJob));
  render(<JobDetail id={testJob.id} section="posting" navigate={vi.fn()} />);

  expect(await screen.findByRole('button', { name: 'Cancel job' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }));

  await waitFor(() => {
    expect(cancelSpy).toHaveBeenCalledWith('job-cancel-test', {
      expected_revision: 4,
      idempotency_key: expect.any(String),
      reason: 'Cancelled by user from job details',
    });
  });
});
