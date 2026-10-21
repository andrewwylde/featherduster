/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PreparationQuestions } from '../src/views/jobs/PreparationQuestions.js';
import { apiClient, type PreparationQuestionGroup } from '../src/api/client.js';
vi.mock('../src/api/events.js', () => ({ sseClient: { onJobs: () => () => {}, onStatus: () => () => {} } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
const group: PreparationQuestionGroup = { id: 'claim', members: [{ job_id: 'job', input_fingerprint: 'input', job_revision: 1, semantic_revision: 1,
  target: { kind: 'review', review_id: 'review', review_revision: 1 }, claim_ids: ['claim'], fact: { work_id: 'project', predicate: 'identity', qualifiers: [] },
  assertion: 'Implemented feature.', question: 'Is this the same feature?', state: 'needs_clarification', source_ids: [], content_fingerprint: 'content' }],
  details: [{ job_id: 'job', company: 'Acme', role: 'Engineer', facts: [], sources: [] }] };
it('keeps answer text editable during a save and restores it after navigation', async () => {
  vi.spyOn(apiClient, 'getPreparationQuestions').mockResolvedValue({ groups: [group], materials: [] });
  let finish!: (value: { result: { job_id: string; status: string }[] }) => void;
  const save = vi.spyOn(apiClient, 'answerPreparationQuestion').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<PreparationQuestions batchId="batch" navigate={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'First answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Your factual answer')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Your factual answer'), { target: { value: 'Next answer during refresh' } });
  finish({ result: [{ job_id: 'job', status: 'conflict' }] });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Acme: conflict'));
  view.unmount(); render(<PreparationQuestions batchId="batch" navigate={vi.fn()} />);
  expect(await screen.findByLabelText('Your factual answer')).toHaveValue('Next answer during refresh');
});
it('shows the exact narrower sentence and sends only visibly selected bindings, without attestation', async () => {
  const narrower = { ...group, members: group.members.map(member => ({ ...member, narrower: { text: 'Implemented the prototype.', source: { evidence_id: 'source', evidence_fingerprint: 'hash', field: 'summary' as const, start: 0, end: 26, quote: 'Implemented the prototype.' } } })) };
  vi.spyOn(apiClient, 'getPreparationQuestions').mockResolvedValue({ groups: [narrower], materials: [] });
  const save = vi.spyOn(apiClient, 'answerPreparationQuestion').mockResolvedValue({ result: [{ job_id: 'job', status: 'saved' }] });
  render(<PreparationQuestions batchId="batch" navigate={vi.fn()} />);
  expect(await screen.findByText('Implemented the prototype.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Use narrower wording' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][2]).toMatchObject({ members: narrower.members, action: 'narrower', confirmed: false });
});
