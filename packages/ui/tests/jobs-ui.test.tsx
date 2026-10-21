/** @vitest-environment jsdom */
import { finishPreview } from './fixtures/rendered-preview.js';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ArtifactVersion, Job, ResumeSpec } from '@featherduster/core';
import { apiClient, ApiError, type JobReview, type JobsControl, type JobsDetail } from '../src/api/client.js';
import { JobsView, filters, matchesJobFilter, getJobPriority, compareJobs, isNeedsInput, isQueued } from '../src/views/jobs/JobsView.js';
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

it('shows actual current inputs and captures a fresh selection only on explicit preparation', async () => {
  const data = detail(job({ preparation_state: 'needs_input', recovery: { kind: 'stale_inputs', subject: {}, action: 'refresh_inputs' } }));
  data.posting = { text: 'Current saved posting text' } as JobsDetail['posting'];
  data.proposal_review = { availability: 'available', review_id: id, revision: 1, status: 'ready', blocking_count: 0, input_stale: false };
  vi.mocked(apiClient.getJob).mockResolvedValue(data);
  vi.spyOn(apiClient, 'getResumes').mockResolvedValue([{ id: 'base', name: 'Saved base resume', filePath: 'base.yaml', type: 'template', spec }]);
  const capture = vi.spyOn(apiClient, 'captureJobInputs').mockResolvedValue({ input_snapshot: { id: version } } as never);
  const navigate = vi.fn();
  render(<JobDetail id={id} section="inputs" navigate={navigate} />);
  expect(await screen.findByRole('heading', { name: 'Current resume inputs' })).toBeInTheDocument();
  expect(screen.getByText('Current saved posting text')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Starting resume')).toHaveValue('base'));
  expect(screen.getByText(/edits in the old draft are not automatically carried over/)).toBeInTheDocument();
  expect(capture).not.toHaveBeenCalled();
  expect(apiClient.prepareJob).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare with current inputs' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/jobs/${id}/resume`));
  expect(capture).toHaveBeenCalledWith(id, 2, { base_resume_id: 'base' });
  expect(apiClient.prepareJob).toHaveBeenCalledWith(id, 'resume', { expected_revision: 2, input_snapshot_id: version, idempotency_key: expect.any(String) });
  expect(jobsViewForPath(`/jobs/${id}/inputs`)).toEqual({ id, section: 'inputs' });
});

it('offers input recovery ahead of an older proposal review', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(job({ preparation_state: 'needs_input', recovery: { kind: 'stale_inputs', subject: {}, action: 'refresh_inputs' } })), proposal_review: { availability: 'available', review_id: id, revision: 1, status: 'ready', blocking_count: 0, input_stale: false } });
  const navigate = vi.fn();
  render(<JobDetail id={id} section="posting" navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review current inputs' }));
  expect(navigate).toHaveBeenCalledWith(`/jobs/${id}/inputs`);
  expect(screen.queryByRole('button', { name: 'Resolve proposals' })).not.toBeInTheDocument();
});

it('routes validated job sections and linked drafts without interpreting them as runs', () => {
  expect(tabForPath(`/jobs/${id}/resume`)).toBe('jobs');
  expect(jobsViewForPath(`/jobs/${id}/answers/`)).toEqual({ id, section: 'answers' });
  expect(jobsViewForPath(`/jobs/${id}`)?.section).toBe('posting');
  expect(jobsViewForPath('/jobs/not-an-id/resume')).toBeNull();
  expect(jobsViewForPath(`/jobs/${id}/bad`)).toBeNull();
  expect(jobDraftForPath(`/tailor/canvas/jobs/${id}/${version}`)).toEqual({ jobId: id, draftId: version });
});
it('keeps application and preparation filters independent and retains archived records', async () => {
  expect(filters).toContain('Applied');
  expect(matchesJobFilter(job({ application_lifecycle: 'needs_input' }), 'Needs input')).toBe(true);
  for (const [filter, state] of [['Queued', 'queued'], ['Preparing', 'preparing'], ['Needs input', 'needs_input'], ['Resume ready', 'resume_ready'], ['Archived', 'cancelled']] as const) expect(matchesJobFilter(job({ preparation_state: state }), filter)).toBe(true);
  expect(matchesJobFilter(job({ preparation_state: 'resume_ready', application_lifecycle: 'submitted' }), 'Resume ready')).toBe(true);
  expect(matchesJobFilter(job({ preparation_state: 'failed' }), 'All')).toBe(true);
  render(<JobsView navigate={vi.fn()} />);
  const heading = await screen.findByRole('heading', { level: 2, name: 'Acme — Engineer' });
  expect(within(heading).getByRole('link')).toHaveAttribute('href', `/jobs/${id}`);
  expect(screen.queryByText(/Application: not_started/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'Archived' } });
  expect(screen.getByText('Archived, skipped and cancelled jobs; resumes and history are retained.')).toBeInTheDocument();
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
  // Once started, automatic work is on and Pause becomes available.
  vi.mocked(apiClient.getJobsControl).mockResolvedValue({ ...stopped, control: { ...stopped.control, automatic_preparation_enabled: true, stopped_at: null } });
  finish({}); await waitFor(() => expect(screen.getByRole('button', { name: 'Pause after current' })).toBeEnabled());
  control.mockRejectedValue(new Error('Offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Pause after current' })); await screen.findByText('Offline');
  const key = control.mock.calls.at(-1)![1];
  fireEvent.click(screen.getByRole('button', { name: 'Pause after current' }));
  await waitFor(() => expect(control.mock.calls.at(-1)).toEqual(['pause', key]));
  expect(screen.getByText('Idle')).toBeInTheDocument();
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
  finishPreview(await screen.findByAltText('Resume page 1'));
  openDetails('Comparison & evidence');
  await screen.findByText('Base to candidate diff');
  expect([...document.querySelectorAll('ins')].map(n => n.textContent).join(' ')).toContain('Actual cleaned candidate');
  if (!screen.queryByRole('link', { name: 'Open PDF' })) fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', `/api/jobs/${id}/artifacts/${version}/pdf`);
  expect(screen.getByAltText('Resume page 1')).toHaveAttribute('src', `/api/jobs/${id}/artifacts/${version}/previews/1`);
  openDetails('Comparison & evidence');
  expect(screen.getByText('Evidence backed')).toBeInTheDocument();
  openDetails('Checks');
  fireEvent.click(screen.getByRole('button', { name: 'Approve Resume' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(approve).toHaveBeenCalledWith(id, version, { expected_job_revision: 2, artifact_fingerprint: 'artifact-hash', input_snapshot_id: id, input_fingerprint: 'input-hash', idempotency_key: expect.any(String) });
});
it('keeps the previously loaded resume review visible when a reload times out', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, latest_input_snapshot_id: id, input_snapshot_id: id });
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValueOnce(review).mockRejectedValueOnce(new Error('Request timed out after 15s: /api/jobs/job/artifacts/review'));
  render(<JobResumeReview job={job()} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  finishPreview(await screen.findByAltText('Resume page 1'));
  openDetails('Comparison & evidence');
  await screen.findByText('Base to candidate diff');
  fireEvent.click(screen.getByRole('button', { name: 'Reload review' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Base to candidate diff')).toBeInTheDocument();
  if (!screen.queryByRole('link', { name: 'Open PDF' })) fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', `/api/jobs/${id}/artifacts/${version}/pdf`);
});
it('blocks failed validation but permits explicit historical draft fork', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue({ ...review, artifact: { ...artifact, validation_result: 'failed' } });
  const fork = vi.spyOn(apiClient, 'editJobResume').mockResolvedValue({ draft: review.draft }); const navigate = vi.fn();
  render(<JobResumeReview job={job()} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={navigate} />);
  finishPreview(await screen.findByAltText('Resume page 1')); openDetails('Checks');
  expect(await screen.findByRole('button', { name: 'Approve Resume' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit resume' }));
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

  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'All' } });
  await screen.findByText(/Epsilon Tech — Engineer 5/);
  const headings = screen
    .getAllByRole('heading', { level: 2 })
    .map(h => h.textContent)
    .filter(t => t !== 'Save a job' && t !== 'Prepare selected resumes');
  expect(headings[0]).toContain('Epsilon Tech — Engineer 5');
  expect(headings[1]).toContain('Delta Co — Engineer 4');
  expect(headings[2]).toContain('Gamma LLC — Engineer 3');
  expect(headings[3]).toContain('Beta Inc — Engineer 2');
  expect(headings[4]).toContain('Alpha Corp — Engineer 1');

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sort order' }));
  const toggledHeadings = screen
    .getAllByRole('heading', { level: 2 })
    .map(h => h.textContent)
    .filter(t => t !== 'Save a job' && t !== 'Prepare selected resumes');
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
    expect(navigate).toHaveBeenLastCalledWith(`/jobs/${id}/proposals`);
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
  expect(await screen.findByAltText('Resume page 1')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Resume' })).toBeVisible();
  expect(screen.queryByText('Earlier corrections')).not.toBeInTheDocument();
  expect(screen.queryByText('Comparison, evidence and preparation history')).not.toBeInTheDocument();
});

it('labels working edits separately from the validated PDF and returns to the durable linked draft', async () => {
  const navigate = vi.fn();
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue({ ...review, working_draft: { ...review.draft, id: 'working', revision: 1, candidate: { ...spec, summary: 'Pending working wording' } } });
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={navigate} />);
  finishPreview(await screen.findByAltText('Resume page 1'));
  expect(screen.queryByRole('heading', { name: 'Current working resume — edits pending checks' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Previous finalized resume' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Download previous PDF' })).toHaveAttribute('href', expect.stringContaining('?download=1'));
  openDetails('Checks');
  expect(screen.getByRole('button', { name: 'Approve Resume' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
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
const posting = { schema_version: 1, id: 'posting', workspace_id: 'workspace', job_id: id, original_url: 'https://example.com/unavailable', final_url: null, captured_at: time, text: 'Pasted posting text' } as unknown as NonNullable<JobsDetail['posting']>;
const recoveredCapture = (patch: Partial<Job> = {}) => job({ preparation_state: 'needs_input', original_url: 'https://example.com/unavailable', posting_snapshot_id: 'posting', missing_inputs: [], current_attempt_id: null, state_reason: 'capture_failed: Unable to capture posting. Paste posting text instead.', ...patch });
it('treats a pasted posting after a failed URL capture as a saved job, not one needing attention', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(recoveredCapture()), posting });
  render(<JobDetail id={id} section="posting" navigate={vi.fn()} />);
  expect(await screen.findByText('Saved. Choose an optional activity below.')).toBeInTheDocument();
  expect(screen.queryByText('Preparation needs your attention.')).not.toBeInTheDocument();
  expect(screen.queryByText(/capture_failed/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume job' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel job' })).not.toBeInTheDocument();
  expect(isNeedsInput(recoveredCapture())).toBe(false);
  expect(matchesJobFilter(recoveredCapture(), 'Needs input')).toBe(false);
});
it('starts preparation explicitly for a recovered capture with the resume action', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(recoveredCapture()), posting });
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  vi.spyOn(apiClient, 'captureJobInputs').mockResolvedValue({ input_snapshot: { id: 'input' } } as never);
  render(<JobDetail id={id} section="resume" navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare resume' }));
  await waitFor(() => expect(apiClient.prepareJob).toHaveBeenCalledWith(id, 'resume', expect.objectContaining({ input_snapshot_id: 'input' })));
});
it('never shows raw reason codes while a capture still needs posting text', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue(detail(recoveredCapture({ posting_snapshot_id: null, missing_inputs: [{ key: 'posting_text', question: 'Paste posting text', scope: { kind: 'job', job_id: id }, reason: 'capture_failed: x' }] })));
  const view = render(<JobDetail id={id} section="posting" navigate={vi.fn()} />);
  expect(await screen.findByText("We couldn't capture the posting from its link. Paste the posting text instead.")).toBeInTheDocument();
  expect(screen.queryByText(/capture_failed/)).not.toBeInTheDocument();
  view.unmount();
  vi.mocked(apiClient.getJob).mockResolvedValue(detail(job({ preparation_state: 'needs_input', state_reason: 'mystery_code: internal detail' })));
  render(<JobDetail id={id} section="posting" navigate={vi.fn()} />);
  expect(await screen.findByText('Preparation stopped and needs a look. Check Posting and History for details.')).toBeInTheDocument();
  expect(screen.queryByText(/mystery_code/)).not.toBeInTheDocument();
});
it('offers cancel in the jobs list only for queued or active work', async () => {
  vi.mocked(apiClient.getJobs).mockResolvedValue({ jobs: [
    job({ id: 'a', company: 'Queued Co', preparation_state: 'queued' }),
    job({ id: 'b', company: 'Active Co', preparation_state: 'preparing' }),
    job({ id: 'c', company: 'Blocked Co', preparation_state: 'needs_input', current_attempt_id: id }),
    job({ id: 'd', company: 'Saved Co', preparation_state: 'saved' }),
  ] });
  render(<JobsView navigate={vi.fn()} />);
  await screen.findByRole('heading', { level: 2, name: 'Blocked Co — Engineer' });
  expect(screen.getAllByRole('button', { name: 'Cancel job' })).toHaveLength(2);
});
it('describes history events in plain language and keeps raw detail behind a disclosure', async () => {
  const event = (n: number, actor: 'user' | 'worker', payload: JobsDetail['events'][number]['payload']) => ({ schema_version: 1, id: `event-${n}`, workspace_id: 'workspace', job_id: id, created_at: time, actor: { kind: actor, id: actor }, attempt_id: null, idempotency_key: null, payload }) as JobsDetail['events'][number];
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(job({ preparation_state: 'resume_ready' })), events: [
    event(1, 'worker', { kind: 'preparation_transition', from: 'queued', to: 'preparing', reason: 'Preparation claimed' }),
    event(2, 'worker', { kind: 'preparation_transition', from: 'preparing', to: 'needs_input', reason: 'Introduces terms not backed by cited evidence: backend.' }),
    event(3, 'user', { kind: 'application_transition', from: 'not_started', to: 'submitted', reason: 'Marked as applied' }),
  ] });
  render(<JobDetail id={id} section="history" navigate={vi.fn()} />);
  expect(await screen.findByText('Preparation started')).toBeInTheDocument();
  expect(screen.getByText('Preparation paused for your input')).toBeInTheDocument();
  expect(screen.getByText('Application marked as submitted')).toBeInTheDocument();
  expect(screen.getAllByText('Background worker')).toHaveLength(2);
  expect(screen.getByText('You')).toBeInTheDocument();
  expect(screen.queryByText(/preparation_transition|application_transition/)).not.toBeInTheDocument();
  const details = screen.getAllByText('Details');
  expect(details).toHaveLength(3);
  expect(details[1].closest('details')).not.toHaveAttribute('open');
  expect(details[1].closest('details')).toHaveTextContent('Introduces terms not backed by cited evidence: backend.');
  expect(details[1].closest('details')).toHaveTextContent('preparing → needs_input');
});
it('shows an approved state instead of offering approval again for the approved version', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue(review);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  const approval = { schema_version: 1, id: 'approval', workspace_id: 'workspace', job_id: id, created_at: time, actor: { kind: 'user', id: 'local-human' }, attempt_id: null, idempotency_key: null, payload: { kind: 'resume_review', review_id: id, artifact_version_id: version, artifact_fingerprint: 'artifact-hash', input_snapshot_id: id, input_fingerprint: 'input-hash' } } as unknown as JobsDetail['events'][number];
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[approval]} onSaved={vi.fn()} navigate={vi.fn()} />);
  finishPreview(await screen.findByAltText('Resume page 1')); openDetails('Checks');
  expect(await screen.findByRole('status', { name: 'Approval' })).toHaveTextContent('Approved for this version');
  expect(screen.queryByRole('button', { name: 'Approve Resume' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit resume' })).toBeEnabled();
});
it('uses the rendered page images as the primary preview at every width and links to the PDF', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue(review);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  const page = finishPreview(await screen.findByAltText('Resume page 1'));
  expect(page).toHaveAttribute('src', `/api/jobs/${id}/artifacts/${version}/previews/1`);
  for (let el: HTMLElement | null = page; el; el = el.parentElement) expect(el.className).not.toMatch(/(^|\s)(hidden|md:hidden)(\s|$)/);
  expect(screen.queryByTitle('Resume PDF preview')).not.toBeInTheDocument();
  if (!screen.queryByRole('link', { name: 'Open PDF' })) fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', `/api/jobs/${id}/artifacts/${version}/pdf`);
});
it('falls back to the embedded PDF only when no page images exist', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue({ ...review, preview_count: 0 });
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  expect(await screen.findByTitle('Resume PDF preview')).toHaveAttribute('src', `/api/jobs/${id}/artifacts/${version}/pdf`);
  expect(screen.getByTitle('Resume PDF preview').className).not.toMatch(/(^|\s)hidden(\s|$)/);
});
it('maps only known reason codes and never shows unknown code-shaped reasons raw', async () => {
  const { describeStateReason, hasRecoveredCapture } = await import('../src/views/jobs/job-utils.js');
  expect(describeStateReason('timeout: Unable to retrieve posting.')).toBe('The posting took too long to load. Paste the posting text instead.');
  expect(describeStateReason('mystery_code: internal detail')).toBe('Preparation stopped and needs a look. Check Posting and History for details.');
  expect(describeStateReason('Preparation claimed')).toBe('Preparation claimed');
  expect(describeStateReason('Note: check the posting')).toBe('Note: check the posting');
  expect(describeStateReason('pdftotext exited 99: bad file')).toBe('pdftotext exited 99: bad file');
  expect(hasRecoveredCapture(recoveredCapture({ state_reason: 'mystery_code: internal detail' }))).toBe(false);
});
it('uses one derived state for the jobs list and the review action choice', async () => {
  const { preparationActionFor } = await import('../src/views/jobs/job-utils.js');
  expect(preparationActionFor(recoveredCapture())).toBe('resume');
  expect(preparationActionFor(job({ preparation_state: 'saved' }))).toBe('prepare');
  expect(preparationActionFor(job({ preparation_state: 'needs_input', current_attempt_id: id }))).toBe('resume');
  expect(preparationActionFor(job({ preparation_state: 'resume_ready' }))).toBe('reprepare');
  expect(preparationActionFor(job({ preparation_state: 'failed' }))).toBe('retry');
  expect(preparationActionFor(job({ preparation_state: 'preparing' }))).toBeNull();
  vi.mocked(apiClient.getJobs).mockResolvedValue({ jobs: [recoveredCapture({ company: 'Recovered Co' })] });
  render(<JobsView navigate={vi.fn()} />);
  await screen.findByRole('heading', { level: 2, name: 'Recovered Co — Engineer' });
  expect(screen.getByText('Saved · preparation is optional')).toBeInTheDocument();
  expect(screen.queryByText('Preparation needs your attention')).not.toBeInTheDocument();
});
it('offers cancel on the detail page for a needs-input job without an attempt', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue(detail(job({ preparation_state: 'needs_input', current_attempt_id: null, missing_inputs: [{ key: 'posting_text', question: 'Paste posting text', scope: { kind: 'job', job_id: id }, reason: 'capture_failed: x' }] })));
  render(<JobDetail id={id} section="posting" navigate={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Cancel job' })).toBeInTheDocument();
});
it('announces approval in a persistent status and keeps focus off the body', async () => {
  vi.spyOn(apiClient, 'getJobReview').mockResolvedValue(review);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  vi.spyOn(apiClient, 'approveJobResume').mockResolvedValue({ review: {} } as never);
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  finishPreview(await screen.findByAltText('Resume page 1')); openDetails('Checks');
  const status = await screen.findByRole('status', { name: 'Approval' });
  expect(status).toHaveTextContent('');
  const approve = screen.getByRole('button', { name: 'Approve Resume' });
  approve.focus();
  fireEvent.click(approve);
  await waitFor(() => expect(screen.getByRole('status', { name: 'Approval' })).toHaveTextContent('Approved for this version'));
  expect(screen.getByRole('status', { name: 'Approval' })).toBe(status);
  expect(screen.queryByRole('button', { name: 'Approve Resume' })).not.toBeInTheDocument();
  expect(document.activeElement).toBe(status);
});
it('explains what stopped in the job header during focused proposal review', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(job({ preparation_state: 'needs_input', state_reason: 'Introduces terms not backed by cited evidence: C++.' })), proposal_review: { availability: 'available', review_id: 'review', revision: 0, status: 'blocked', blocking_count: 1, input_stale: false } });
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  const navigate = vi.fn();
  render(<JobDetail id={id} section="resume" navigate={navigate} />);
  const stoppedLine = await screen.findByText('Preparation stopped — proposal review needs your input.');
  expect(stoppedLine).not.toHaveClass('hidden');
  fireEvent.click(screen.getByRole('button', { name: 'Review facts (1)' }));
  expect(navigate).toHaveBeenCalledWith(`/jobs/${id}/proposals`);
  expect(jobsViewForPath(`/jobs/${id}/proposals`)).toEqual({ id, section: 'proposals' });
});

it('opens the proposal review directly without requiring the Details menu', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobDetail id={id} section="proposals" navigate={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Proposal review unavailable' })).toBeInTheDocument();
  expect(apiClient.getJobProposals).toHaveBeenCalledWith(id);
  expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
});

it('loads all jobs needing review from worker status and links directly to proposals', async () => {
  vi.mocked(apiClient.getJobsControl).mockResolvedValue({ ...stopped, needs_review_count: 1 });
  vi.mocked(apiClient.getJobs).mockResolvedValue({ jobs: [job({ preparation_state: 'needs_input', recovery: { kind: 'proposals', subject: {}, action: 'review_proposals' } })] });
  const navigate = vi.fn();
  render(<WorkerControls jobs={[]} navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review jobs' }));
  const link = await screen.findByRole('link', { name: 'Review Acme — Engineer' });
  expect(link).toHaveAttribute('href', `/jobs/${id}/proposals`);
  fireEvent.click(link);
  expect(navigate).toHaveBeenCalledWith(`/jobs/${id}/proposals`);
  expect(apiClient.prepareJob).not.toHaveBeenCalled();
  expect(apiClient.controlJobs).not.toHaveBeenCalled();
});

function openDetails(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

it('keeps history selection legible in both themes and returns from a historical artifact', async () => {
  const historicalId = '33333333-3333-4333-8333-333333333333';
  const historical = { ...artifact, id: historicalId };
  vi.spyOn(apiClient, 'getJobReview').mockImplementation(async (_job, selected) => ({ ...review,
    artifact: selected === historicalId ? historical : artifact }));
  render(<JobResumeReview job={job({ preparation_state: 'resume_ready' })} artifacts={[historical, artifact]} events={[]} onSaved={vi.fn()} navigate={vi.fn()} />);
  finishPreview(await screen.findByAltText('Resume page 1'));
  openDetails('Version history');
  const select = screen.getByRole('combobox', { name: 'Artifact version' });
  expect(select).toHaveClass('bg-white', 'text-slate-900', 'dark:bg-slate-950', 'dark:text-slate-100');
  fireEvent.change(select, { target: { value: historicalId } });
  await waitFor(() => expect(apiClient.getJobReview).toHaveBeenLastCalledWith(id, historicalId));
  expect(screen.getByRole('heading', { name: 'Historical resume' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  expect(await screen.findByRole('link', { name: 'Download historical PDF' })).toHaveAttribute('href', expect.stringContaining(historicalId));
  expect(screen.getByAltText('Resume page 1')).toHaveAttribute('src', expect.stringContaining(historicalId));
  fireEvent.click(screen.getByRole('button', { name: 'Return to current resume' }));
  await waitFor(() => expect(screen.getByAltText('Resume page 1')).toHaveAttribute('src', expect.stringContaining(version)));
  expect(screen.getByRole('heading', { name: 'Resume' })).toBeVisible();
});

it('opens automatic questions from saved-job and worker review links instead of Posting', async () => {
  const waiting = job({ preparation_state: 'needs_input', recovery: { kind: 'proposals', subject: {}, action: 'review_proposals' } });
  vi.mocked(apiClient.getJobs).mockResolvedValue({ jobs: [waiting], preparation_links: { [id]: { batch_id: version, state: 'question' } } });
  vi.mocked(apiClient.getJobsControl).mockResolvedValue({ ...stopped, needs_review_count: 1 });
  const navigate = vi.fn();
  render(<JobsView navigate={navigate} />);
  const questionPath = `/jobs/preparation-batches/${version}/questions`;
  expect(await screen.findByRole('link', { name: 'Acme — Engineer' })).toHaveAttribute('href', questionPath);
  fireEvent.click(screen.getByRole('button', { name: 'Answer preparation questions' }));
  expect(navigate).toHaveBeenLastCalledWith(questionPath);
  fireEvent.click(screen.getByRole('button', { name: 'Review jobs' }));
  expect(await screen.findByRole('link', { name: 'Review Acme — Engineer' })).toHaveAttribute('href', questionPath);
});


it('defaults to unfinished work and lets users mark applied, archive and restore with visible controls', async () => {
  let jobs = [job({ preparation_state: 'resume_ready' }), job({ id: version, company: 'Done', preparation_state: 'resume_ready', application_lifecycle: 'submitted' })];
  vi.mocked(apiClient.getJobs).mockImplementation(async () => ({ jobs }));
  const track = vi.spyOn(apiClient, 'trackJob').mockImplementation(async (jobId, request) => {
    jobs = jobs.map(j => j.id !== jobId ? j : { ...j, revision: j.revision + 1,
      application_lifecycle: request.action === 'applied' ? 'submitted' : request.action === 'unapply' ? 'not_started' : j.application_lifecycle,
      archived_at: request.action === 'archive' ? time : request.action === 'restore' ? null : j.archived_at });
    return {};
  });
  render(<JobsView navigate={vi.fn()} />);
  await screen.findByRole('heading', { name: 'Acme — Engineer' });
  expect(screen.queryByRole('heading', { name: 'Done — Engineer' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
  await screen.findByText(/All caught up/);
  expect(track).toHaveBeenCalledWith(id, expect.objectContaining({ action: 'applied', expected_revision: 2 }));
  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'Applied' } });
  const card = screen.getByRole('heading', { name: 'Acme — Engineer' }).closest('li')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Mark not applied' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Acme — Engineer' })).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'Needs work' } });
  fireEvent.click(screen.getByRole('button', { name: 'Archive job' }));
  await screen.findByText(/All caught up/);
  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'Archived' } });
  fireEvent.click(screen.getByRole('button', { name: 'Restore from archive' }));
  await screen.findByText('No jobs match this filter.');
  fireEvent.change(screen.getByLabelText('Filter jobs'), { target: { value: 'Needs work' } });
  expect(screen.getByRole('heading', { name: 'Acme — Engineer' })).toBeInTheDocument();
});

it('retains a job and surfaces tracking failures', async () => {
  vi.mocked(apiClient.getJobs).mockResolvedValue({ jobs: [job({ preparation_state: 'saved' })] });
  vi.spyOn(apiClient, 'trackJob').mockRejectedValue(new Error('Stale revision. Reload jobs.'));
  render(<JobsView navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Archive job' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Stale revision');
  expect(screen.getByRole('heading', { name: 'Acme — Engineer' })).toBeInTheDocument();
});

it('keeps terminal history out of Needs work while retaining ready resumes and recoverable failures', () => {
  for (const preparation_state of ['saved', 'queued', 'preparing', 'needs_input', 'resume_ready', 'failed', 'interrupted'] as const)
    expect(matchesJobFilter(job({ preparation_state }), 'Needs work')).toBe(true);
  for (const application_lifecycle of ['submitted', 'outcome_recorded', 'unknown'] as const)
    expect(matchesJobFilter(job({ application_lifecycle }), 'Needs work')).toBe(false);
  expect(matchesJobFilter(job({ archived_at: time }), 'Needs work')).toBe(false);
  for (const preparation_state of ['cancelled', 'skipped'] as const)
    expect(matchesJobFilter(job({ preparation_state }), 'Needs work')).toBe(false);
});
