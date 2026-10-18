/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Job } from '@featherduster/core';
import { apiClient, type JobsControl, type JobsDetail } from '../src/api/client.js';
import { JobDetail } from '../src/views/jobs/JobDetail.js';
import { JobProposalReview } from '../src/views/jobs/JobProposalReview.js';
import { WorkerControls } from '../src/views/jobs/WorkerControls.js';
import { formatDateTime, pluralize } from '../src/views/jobs/job-utils.js';

vi.mock('../src/api/events.js', () => ({ sseClient: { onJobs: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) } }));
const id = '11111111-1111-4111-8111-111111111111';
const time = '2026-10-17T20:25:48.643Z';
function job(patch: Partial<Job> = {}): Job {
  return { schema_version: 1, id, workspace_id: 'workspace', revision: 2, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: time, updated_at: time, ...patch };
}
const control = (patch: Partial<JobsControl['control']> = {}, extra: Partial<JobsControl> = {}): JobsControl => ({ control: { schema_version: 1, workspace_id: 'workspace', revision: 1, automatic_preparation_enabled: false, pause_after_current: false, stop_generation: 1, stopped_at: time, updated_at: time, ...patch }, active: [], ...extra });
const detail = (j = job()): JobsDetail => ({ job: j, posting: null, attempt: null, artifacts: [], events: [], answers: [], analysis: null, alignment: null, brief_markdown: null });
beforeEach(() => {
  vi.spyOn(apiClient, 'getJobsControl').mockResolvedValue(control());
  vi.spyOn(apiClient, 'controlJobs').mockResolvedValue({});
  vi.spyOn(apiClient, 'getJobs').mockResolvedValue({ jobs: [job()] });
  vi.spyOn(apiClient, 'getJob').mockResolvedValue(detail());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('wraps the job section tabs instead of clipping them', async () => {
  render(<JobDetail id={id} section="posting" navigate={vi.fn()} />);
  const nav = await screen.findByRole('navigation', { name: 'Job sections' });
  expect(nav).toHaveClass('flex-wrap');
  expect(nav).not.toHaveClass('overflow-x-auto');
});

it('pluralises counts', () => {
  expect(pluralize(1, 'job')).toBe('1 job');
  expect(pluralize(2, 'job')).toBe('2 jobs');
  expect(pluralize(1, 'job needs', 'jobs need')).toBe('1 job needs');
  expect(pluralize(0, 'blocker')).toBe('0 blockers');
});

it('says "1 job needs review" in the worker status', async () => {
  vi.mocked(apiClient.getJobsControl).mockResolvedValue(control({ stopped_at: null, automatic_preparation_enabled: true }, { needs_review_count: 1 }));
  render(<WorkerControls />);
  expect(await screen.findByText('Idle — 1 job needs review')).toBeInTheDocument();
});

it('pluralises single blockers, passages and locations in proposal review', async () => {
  const candidate = { profile: { name: 'T', title: 'E', email: 't@example.com' }, summary: 'Original', experiences: [], education: [], skills: [] };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'available', input_stale: false, corpus_revision: 0, latest_input_snapshot_id: null, generation: { id: 'g', proposals: { proposals: [] } }, generations: [], history: [],
    review: { id: 'r', revision: 0, input_fingerprint: 'h', patches: [], groundings: [], candidate_preview: candidate, validation: { status: 'blocked', fingerprint: 'v', issues: [{ id: 'b', subject: { kind: 'candidate', path: 'summary' }, group: 'grounding', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Unsupported: backend.' }] }] } },
    captured: { evidence: [], skillSupport: [], analysis: { requirements: [] }, base_resume: candidate } } as never);
  render(<JobProposalReview job={job({ preparation_state: 'needs_input' })} onSaved={() => {}} />);
  expect(await screen.findByText('1 blocker')).toBeInTheDocument();
  expect(screen.getByText('Review overview · 1 required passage')).toBeInTheDocument();
  expect(screen.getByText('Starting resume · 1 location needs correction')).toBeInTheDocument();
});

it('tells the user that a stop discarded late output instead of blaming missing history', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobProposalReview job={job({ preparation_state: 'cancelled', state_reason: 'Processing stopped' })} onSaved={() => {}} />);
  expect(await screen.findByText(/Stopped\. Output that arrived after Stop was discarded\./)).toBeInTheDocument();
  expect(screen.queryByText(/cannot be reconstructed from error messages/)).not.toBeInTheDocument();
});

it('explains how to restart when a start is refused because processing is stopped', async () => {
  vi.spyOn(apiClient, 'prepareJob').mockRejectedValue(new Error('Start prevented: processing is stopped or paused'));
  vi.spyOn(apiClient, 'captureJobInputs').mockResolvedValue({ input_snapshot: { id: 'snapshot' } } as never);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: false, input_snapshot_id: null, latest_input_snapshot_id: null });
  render(<JobDetail id={id} section="resume" navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare resume' }));
  const alert = await screen.findByText(/Start prevented/);
  expect(alert.closest('[role="alert"]')).toHaveTextContent('Open Automatic work controls and choose Start automatic preparation, then try again.');
});

it('formats job history times for the locale and keeps the ISO value machine-readable', async () => {
  vi.mocked(apiClient.getJob).mockResolvedValue({ ...detail(), events: [{ schema_version: 1, id: 'e1', workspace_id: 'workspace', job_id: id, created_at: time, actor: { kind: 'worker', id: 'w' }, attempt_id: null, idempotency_key: null, payload: { kind: 'preparation_transition', from: 'queued', to: 'preparing', reason: 'Preparation claimed' } }] as JobsDetail['events'] });
  render(<JobDetail id={id} section="history" navigate={vi.fn()} />);
  await screen.findByText('Preparation started');
  const stamp = document.querySelector(`time[datetime="${time}"]`)!;
  expect(stamp).toBeInTheDocument();
  expect(stamp).toHaveTextContent(formatDateTime(time));
  expect(stamp.textContent).not.toContain('T20:25');
});

it('offers Start only when automatic work is off, and Stop only while there is something to stop', async () => {
  vi.mocked(apiClient.getJobsControl).mockResolvedValue(control({ stopped_at: null, automatic_preparation_enabled: true }));
  const on = render(<WorkerControls />);
  await screen.findByText('Idle');
  expect(screen.getByRole('button', { name: 'Start automatic preparation' })).toBeDisabled();
  expect(screen.getByText('Automatic preparation is on.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop processing' })).toBeEnabled();
  on.unmount();
  vi.mocked(apiClient.getJobsControl).mockResolvedValue(control());
  render(<WorkerControls />);
  await screen.findByText('Stopped');
  expect(screen.getByRole('button', { name: 'Start automatic preparation' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Stop processing' })).toBeDisabled();
});

it('re-enables Start when pause after current was requested', async () => {
  vi.mocked(apiClient.getJobsControl).mockResolvedValue(control({ stopped_at: null, automatic_preparation_enabled: true, pause_after_current: true }));
  render(<WorkerControls />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start automatic preparation' })).toBeEnabled());
  expect(within(screen.getByRole('region', { name: 'Worker controls' })).queryByText('Automatic preparation is on.')).not.toBeInTheDocument();
});

it('offers Pause only while automatic work is on and not already pausing', async () => {
  const cases: [Partial<JobsControl['control']>, boolean][] = [
    [{ stopped_at: null, automatic_preparation_enabled: true }, true],
    [{ stopped_at: null, automatic_preparation_enabled: true, pause_after_current: true }, false],
    [{ stopped_at: time, automatic_preparation_enabled: true }, false],
    [{ stopped_at: null, automatic_preparation_enabled: false }, false],
  ];
  for (const [state, enabled] of cases) {
    vi.mocked(apiClient.getJobsControl).mockResolvedValue(control(state));
    const view = render(<WorkerControls />);
    await waitFor(() => expect(screen.queryByText('Loading worker…')).not.toBeInTheDocument());
    const pause = screen.getByRole('button', { name: 'Pause after current' });
    if (enabled) expect(pause).toBeEnabled(); else expect(pause).toBeDisabled();
    view.unmount();
  }
});
