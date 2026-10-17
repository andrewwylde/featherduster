/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JobFitReview } from '../src/views/jobs/JobFitReview.js';
import { apiClient } from '../src/api/client.js';
vi.mock('../src/api/events.js', () => ({ sseClient: { onJobs: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const job = { id: 'job', revision: 2, preparation_state: 'saved' } as any;
it('opening fit is silent and explicitly admits only selected fit sources', async () => {
  vi.spyOn(apiClient, 'getJobFit').mockResolvedValue({ current: null, history: [] });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  const start = vi.spyOn(apiClient, 'assessJobFit').mockResolvedValue({});
  const resume = vi.spyOn(apiClient, 'prepareJob');
  render(<JobFitReview job={job} onSaved={() => {}} navigate={() => {}} />);
  await screen.findByText(/No evidence sources/);
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Assess fit' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith('job', expect.objectContaining({ expected_revision: 2, evidence_ids: [] })));
  expect(resume).not.toHaveBeenCalled();
});
it('retains stale findings, evidence and an optional tailoring action', async () => {
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getJobFit').mockResolvedValue({ current: { stale: true, input_snapshot_id: 'input', analysis: { requirements: [{ id: 'r', text: 'Operate Kubernetes', quote: 'Operate Kubernetes' }] }, assessment: { assessed_at: '2026-01-01T00:00:00Z', rows: [{ requirement_id: 'r', classification: 'gap', rationale: 'No selected proof', citations: [], issues: [] }] }, evidence: [] }, history: [] } as any);
  const navigate = vi.fn();
  render(<JobFitReview job={job} onSaved={() => {}} navigate={navigate} />);
  await screen.findByText(/Inputs changed/);
  expect(screen.getByText(/No supporting evidence found/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tailor resume' }));
  expect(navigate).toHaveBeenCalledWith('/jobs/job/resume');
});
it('offers cancellation next to the active assessment without starting any model work', async () => {
  vi.spyOn(apiClient, 'getJobFit').mockResolvedValue({ current: null, history: [] });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  const start = vi.spyOn(apiClient, 'assessJobFit');
  const cancel = vi.spyOn(apiClient, 'cancelJob').mockResolvedValue({});
  render(<JobFitReview job={{ ...job, preparation_state: 'preparing' }} onSaved={() => {}} navigate={() => {}} />);
  expect(screen.getByRole('button', { name: 'Assessment in progress' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel assessment' }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('job', expect.objectContaining({ expected_revision: 2 })));
  expect(start).not.toHaveBeenCalled();
});
it('failed admission retains the source selection and provides a local explanation', async () => {
  vi.spyOn(apiClient, 'getJobFit').mockResolvedValue({ current: null, history: [] });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([{ id: 'a', title: 'API project' }, { id: 'b', title: 'Migration' }] as any);
  const start = vi.spyOn(apiClient, 'assessJobFit').mockRejectedValue(new Error('Processing is stopped; explicitly Start first'));
  render(<JobFitReview job={job} onSaved={() => {}} navigate={() => {}} />);
  fireEvent.click(await screen.findByText('Selected sources (2)'));
  fireEvent.click(screen.getByLabelText('Migration'));
  fireEvent.click(screen.getByRole('button', { name: 'Assess fit' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Processing is stopped');
  expect(screen.getByLabelText('Migration')).not.toBeChecked();
  expect(start).toHaveBeenCalledWith('job', expect.objectContaining({ evidence_ids: ['a'] }));
});
