/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Job, ResumeSpec } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobStartingResumeCorrection } from '../src/views/jobs/JobStartingResumeCorrection.js';

const job = { id: 'job', workspace_id: 'workspace', revision: 2 } as Job;
const resume = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, summary: 'Original', experiences: [], education: [], skills: [] } as ResumeSpec;
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it('does not silently adopt a polled job revision for a starting-resume correction', () => {
  const save = vi.spyOn(apiClient, 'correctJobStartingResume');
  const props = { job, inputId: 'input', resume, path: 'summary', disabled: false, onSaved: vi.fn() };
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
  const props = { job, inputId: 'input', resume, path: 'summary', disabled: false, onSaved: vi.fn() };
  const view = render(<JobStartingResumeCorrection {...props} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'My correction' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save starting resume for this job' }));
  expect(await screen.findByText('Revision conflict')).toBeInTheDocument();
  expect(save).toHaveBeenCalledWith('job', expect.objectContaining({ expected_job_revision: 2, input_snapshot_id: 'input', base_resume: { ...resume, summary: 'My correction' } }));
  view.unmount();
  render(<JobStartingResumeCorrection {...props} />);
  expect(screen.getByLabelText('Starting wording')).toHaveValue('My correction');
  expect(prepare).not.toHaveBeenCalled();
  expect(resume.summary).toBe('Original');
});

it('allows a pristine starting passage to be corrected after a proposal save advances the job', () => {
  const props = { job, inputId: 'input', resume, path: 'summary', disabled: false, onSaved: vi.fn() };
  const view = render(<JobStartingResumeCorrection {...props} />);
  view.rerender(<JobStartingResumeCorrection {...props} job={{ ...job, revision: 3 }} />);
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'New correction' } });
  expect(screen.getByRole('button', { name: 'Save starting resume for this job' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
