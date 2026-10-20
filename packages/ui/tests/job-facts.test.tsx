/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JobFacts as Facts, SemanticTarget } from '@featherduster/core';
import { JobFacts } from '../src/views/jobs/JobFacts.js';
import { apiClient } from '../src/api/client.js';
const candidate = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, summary: 'Built production APIs.', experiences: [], skills: [], education: [] };
const target: SemanticTarget = { kind: 'draft', draft_id: 'draft', candidate };
function view(text = candidate.summary): Facts {
  const subject = { id: 'subject', path: 'summary', passage_fingerprint: text };
  return { job_id: 'job', job_revision: 1, input_fingerprint: 'input', semantic_revision: 0, target,
    candidate_fingerprint: text, support_fingerprint: text, execution: 'unchecked', configuration_evaluated: false,
    clarifications: [], usage: { dispatched: 0, elapsed_ms: 0, tokens: null, cost: null }, facts: [{
      claim: { id: text, subject, text, start: 0, end: text.length, fact: { work_id: 'api', predicate: 'production', qualifiers: [] }, qualifier_text: [] },
      state: 'needs_clarification', evidence: [], explanation: 'Deployment is not recorded.', question: 'Was this API deployed for real users?',
      passage: { subject, text, work_id: 'api', inherited: true }, resolution: null,
    }] };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
it('does not queue overlapping reads or keep polling idle facts', async () => {
  vi.useFakeTimers();
  let finish!: (value: Facts) => void;
  const read = vi.spyOn(apiClient, 'getJobFacts').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<JobFacts jobId="job" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { finish(view()); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(read).toHaveBeenCalledTimes(1);
});
it('keeps an answer after failed saving and advances only when the server resolves the fact', async () => {
  const initial = view();
  const read = vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const resolved: Facts = { ...initial, facts: initial.facts.map(f => ({ ...f, resolution: { provenance: 'human', explanation: 'Deployed for customers.' } })) };
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockRejectedValueOnce(Error('Offline'))
    .mockResolvedValue(resolved);
  const changed = vi.fn(() => { read.mockResolvedValue(resolved); });
  render(<JobFacts jobId="job" onResolved={changed} />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'Deployed for customers.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByLabelText('Your factual answer')).toHaveValue('Deployed for customers.');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  expect(await screen.findByText('All facts resolved. Resume checks still apply.')).toBeVisible();
  expect(save.mock.calls[1][1]).toMatchObject({ confirmed: true, claim_ids: [candidate.summary] });
  expect(changed).toHaveBeenCalledOnce();
});
it('refreshes the saved review binding before allowing the next answer', async () => {
  const initial = { ...view(), target: { kind: 'review' as const, review_id: 'review', review_revision: 0 } };
  const read = vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(initial);
  const changed = vi.fn(() => { read.mockResolvedValue({ ...initial, target: { ...initial.target, review_revision: 1 } }); });
  render(<JobFacts jobId="job" onResolved={changed} />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'Still checking.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save answer, keep unresolved' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm for this job and continue' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1].target).toMatchObject({ review_revision: 1 });
});
it('saves uncertainty explicitly without treating it as confirmation', async () => {
  const initial = view();
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(initial);
  render(<JobFacts jobId="job" />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'I need to check deployment.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save answer, keep unresolved' }));
  expect(await screen.findByText(/Answer saved. This fact still needs/)).toBeVisible();
  expect(save.mock.calls[0][1].confirmed).toBe(false);
  expect(screen.getByText('Was this API deployed for real users?')).toBeVisible();
});
it('debounces changed text while focus, polling and initial mounting never dispatch inference', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'viewJobFacts').mockResolvedValue(view());
  const start = vi.spyOn(apiClient, 'startJobFactCheck').mockResolvedValue({ operation_id: 'op', state: 'checking' });
  const mounted = render(<JobFacts jobId="job" target={target} reactive />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
  window.dispatchEvent(new Event('focus'));
  expect(start).not.toHaveBeenCalled();
  mounted.rerender(<JobFacts jobId="job" target={{ ...target, candidate: { ...candidate, summary: 'Changed text.' } }} reactive />);
  await act(async () => { await vi.advanceTimersByTimeAsync(599); }); expect(start).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(start).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(start).toHaveBeenCalledTimes(1);
});
it('groups matching work and qualifiers into one explicit decision', async () => {
  const initial = view(), second = structuredClone(initial.facts[0]);
  second.claim.id = 'second'; second.passage.subject.id = 'second'; second.claim.subject = second.passage.subject;
  initial.facts.push(second);
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(initial);
  render(<JobFacts jobId="job" />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'Both refer to the same deployed API.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].claim_ids).toEqual([candidate.summary, 'second']);
});
