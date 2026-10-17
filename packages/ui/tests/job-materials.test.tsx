/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JobMaterialReview } from '../src/views/jobs/JobMaterialReview.js';
import { apiClient } from '../src/api/client.js';
vi.mock('../src/api/events.js', () => ({ sseClient: { onJobs: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const job = { id: 'job', workspace_id: 'workspace', revision: 2, preparation_state: 'saved' } as any;
const content = { kind: 'cover_letter', paragraphs: [{ id: 'opening', text: 'Maintained APIs.', claims: [{ text: 'Maintained APIs.', sources: [{ evidence_id: 'api', evidence_fingerprint: 'hash', quote: 'Maintained APIs.' }] }] }] };
const revision = (id = 'first') => ({ id, revision: 0, content, validation: { status: 'checked', issues: [] }, review: null, created_at: '2026-01-01T00:00:00Z' });
function mock(current: any = revision()) {
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([{ id: 'api', title: 'API maintenance' }] as any);
  return vi.spyOn(apiClient, 'getJobMaterial').mockResolvedValue({ current, history: current ? [current] : [], stale_reasons: [] } as any);
}
it('opens silently and only explicitly generates the selected material', async () => {
  mock(null); const generate = vi.spyOn(apiClient, 'generateJobMaterial').mockResolvedValue({});
  render(<JobMaterialReview job={job} kind="interview_brief" onSaved={() => {}} />);
  await screen.findByText(/First/); expect(generate).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate interview brief' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate interview brief' }));
  await waitFor(() => expect(generate).toHaveBeenCalledWith('job', 'interview_brief', expect.objectContaining({ evidence_ids: ['api'], expected_revision: 2 })));
});
it('retains a local draft and original CAS across remount and a changed saved revision', async () => {
  const read = mock(); const save = vi.spyOn(apiClient, 'saveJobMaterial').mockResolvedValue({ result: revision('saved') } as any);
  const first = render(<JobMaterialReview job={job} kind="cover_letter" onSaved={() => {}} />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'My retained draft.' } });
  first.unmount(); read.mockResolvedValue({ current: revision('newer'), history: [], stale_reasons: [] } as any);
  render(<JobMaterialReview job={job} kind="cover_letter" onSaved={() => {}} />);
  expect(await screen.findByRole('textbox')).toHaveValue('My retained draft.');
  await screen.findByText(/saved revision changed/);
  expect(screen.getByRole('button', { name: 'Save and check' })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep my draft against this saved revision' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('job', 'cover_letter', expect.objectContaining({ expected_revision_id: 'newer', content: expect.objectContaining({ paragraphs: expect.arrayContaining([expect.objectContaining({ text: 'My retained draft.' })]) }) })));
});
it('failed saves retain text, disable review and generation, and never invoke a model', async () => {
  mock(); const generate = vi.spyOn(apiClient, 'generateJobMaterial');
  vi.spyOn(apiClient, 'saveJobMaterial').mockRejectedValue(new Error('Save timed out'));
  render(<JobMaterialReview job={job} kind="cover_letter" onSaved={() => {}} />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Keep this.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }));
  await screen.findByText('Save timed out');
  expect(screen.getByRole('textbox')).toHaveValue('Keep this.');
  expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generate new version' })).toBeDisabled();
  expect(generate).not.toHaveBeenCalled();
});
it('history is read-only, stale content cannot be reviewed, and active work has cancellation', async () => {
  mock().mockResolvedValue({ current: revision(), history: [revision('old')], stale_reasons: ['resume'] } as any);
  const cancel = vi.spyOn(apiClient, 'cancelJob').mockResolvedValue({});
  render(<JobMaterialReview job={{ ...job, preparation_state: 'preparing' }} kind="cover_letter" onSaved={() => {}} />);
  await screen.findByText(/Inputs changed: resume/);
  expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeDisabled();
  fireEvent.click(screen.getByText(/Revision history/)); fireEvent.click(screen.getByRole('button', { name: /Revision 0/ }));
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel active work' }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('job', expect.objectContaining({ expected_revision: 2 })));
});

it('previews the letter as exported and lists gap notes outside it', async () => {
  const letter = { ...content, paragraphs: [{ ...content.paragraphs[0], references: [] }], gap_notes: [{ requirement_quote: 'Kubernetes production operations', transferable_evidence: [] }] };
  mock({ ...revision(), content: letter });
  render(<JobMaterialReview job={job} kind="cover_letter" onSaved={() => {}} />);
  const preview = await screen.findByRole('region', { name: /Letter (preview|as exported)/ });
  expect(preview).toHaveTextContent('Maintained APIs.');
  expect(preview).not.toHaveTextContent('Kubernetes');
  expect(screen.getByRole('region', { name: 'Not established by your selected evidence' })).toHaveTextContent('Kubernetes production operations');
});

it('labels the letter preview by draft and review state', async () => {
  mock({ ...revision(), review: { reviewer_id: 'local-human' } });
  render(<JobMaterialReview job={job} kind="cover_letter" onSaved={() => {}} />);
  const preview = await screen.findByRole('region', { name: /Letter (preview|as exported)/ });
  expect(preview).toHaveTextContent('Letter as exported');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited draft.' } });
  const edited = screen.getByRole('region', { name: /Letter (preview|as exported)/ });
  expect(edited).toHaveTextContent('Letter preview (unsaved edits, not exported)');
  expect(edited).toHaveTextContent('Edited draft.');
});
