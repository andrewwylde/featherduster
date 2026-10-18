/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Job, ResumeSpec } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobStartingResumeCorrection } from '../src/views/jobs/JobStartingResumeCorrection.js';

const job = { id: 'job', workspace_id: 'workspace', revision: 2 } as Job;
const review = { id: 'review', revision: 4, input_snapshot_id: 'input', input_fingerprint: 'hash' };
const resume = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, summary: 'Original', experiences: [], education: [], skills: [] } as ResumeSpec;
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it('does not silently adopt a polled job revision for a starting-resume correction', () => {
  const save = vi.spyOn(apiClient, 'correctJobStartingResume');
  const props = { job, review, resume, path: 'summary', disabled: false, onSaved: vi.fn() };
  const view = render(<JobStartingResumeCorrection {...props} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'My correction' } });
  view.rerender(<JobStartingResumeCorrection {...props} job={{ ...job, revision: 3 }} />);
  expect(screen.getByLabelText('Starting wording')).toHaveValue('My correction');
  expect(screen.getByRole('alert')).toHaveTextContent('cannot overwrite a newer version');
  expect(screen.getByRole('button', { name: 'Save starting resume for this job' })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  view.unmount();
  render(<JobStartingResumeCorrection {...props} job={{ ...job, revision: 3 }} />);
  expect(screen.getByLabelText('Starting wording')).toHaveValue('My correction');
  expect(screen.getByRole('button', { name: 'Save starting resume for this job' })).toBeDisabled();
});

it('retains the job-local draft on failed save and remount without invoking generation', async () => {
  const save = vi.spyOn(apiClient, 'correctJobStartingResume').mockRejectedValue(new Error('Revision conflict'));
  const prepare = vi.spyOn(apiClient, 'prepareJob');
  const props = { job, review, resume, path: 'summary', disabled: false, onSaved: vi.fn() };
  const view = render(<JobStartingResumeCorrection {...props} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'My correction' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save starting resume for this job' }));
  expect(await screen.findByText('Revision conflict.')).toBeInTheDocument();
  expect(save).toHaveBeenCalledWith('job', expect.objectContaining({ expected_job_revision: 2, review_id: 'review', expected_review_revision: 4, input_fingerprint: 'hash', path: 'summary', text: 'My correction' }));
  view.unmount();
  render(<JobStartingResumeCorrection {...props} />);
  expect(screen.getByLabelText('Starting wording')).toHaveValue('My correction');
  expect(prepare).not.toHaveBeenCalled();
  expect(resume.summary).toBe('Original');
});

it('allows a pristine starting passage to be corrected after a proposal save advances the job', () => {
  const props = { job, review, resume, path: 'summary', disabled: false, onSaved: vi.fn() };
  const view = render(<JobStartingResumeCorrection {...props} />);
  view.rerender(<JobStartingResumeCorrection {...props} job={{ ...job, revision: 3 }} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'New correction' } });
  expect(screen.getByRole('button', { name: 'Save starting resume for this job' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('treats its own save as the new baseline instead of a conflicting job change', async () => {
  const saved = { job: { ...job, revision: 3 }, review: { ...review, revision: 5 } } as never;
  const save = vi.spyOn(apiClient, 'correctJobStartingResume').mockResolvedValue({ result: saved, replayed: false });
  const prepare = vi.spyOn(apiClient, 'prepareJob');
  const onSaved = vi.fn();
  const props = { job, review, resume, path: 'summary', disabled: false, onSaved };
  const view = render(<JobStartingResumeCorrection {...props} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'My correction' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save starting resume for this job' }));
  expect(await screen.findByText(/saved and rechecked/)).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledWith(saved);
  // The poll then delivers the revision this save produced, before the reloaded review arrives.
  view.rerender(<JobStartingResumeCorrection {...props} job={{ ...job, revision: 3 }} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Starting wording')).toHaveValue('My correction');
  expect(screen.getByRole('button', { name: 'Save starting resume for this job' })).toBeDisabled();
  expect(screen.queryByText(/Prepare refreshed inputs/)).not.toBeInTheDocument();
  expect(localStorage.length).toBe(0);
  view.rerender(<JobStartingResumeCorrection {...props} job={{ ...job, revision: 3 }} review={{ ...review, revision: 5 }} resume={{ ...resume, summary: 'My correction' }} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'Second correction' } });
  expect(screen.getByRole('button', { name: 'Save starting resume for this job' })).toBeEnabled();
  expect(save).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
});
