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
  expect(await screen.findByText('All listed facts have saved support.')).toBeVisible();
  expect(save.mock.calls[1][1]).toMatchObject({ confirmed: true, claim_ids: [candidate.summary] });
  expect(changed).toHaveBeenCalledOnce();
});
it('lets the next answer be typed while checks refresh, then saves with the fresh binding', async () => {
  const initial = { ...view(), target: { kind: 'review' as const, review_id: 'review', review_revision: 0 } };
  const second = structuredClone(initial.facts[0]);
  second.claim.id = 'second';
  second.claim.fact = { ...second.claim.fact, work_id: 'another-project' };
  second.passage.subject = { ...second.passage.subject, id: 'second' };
  second.claim.subject = second.passage.subject;
  initial.facts.push(second);
  const next = { ...initial, facts: initial.facts.map((f, i) => i ? f : { ...f, resolution: { provenance: 'human' as const, explanation: 'Confirmed.' } }) };
  const read = vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(next);
  let finish!: () => void;
  const changed = vi.fn(() => new Promise<void>(resolve => { finish = () => {
    read.mockResolvedValue({ ...next, target: { ...initial.target, review_revision: 1 } }); resolve();
  }; }));
  render(<JobFacts jobId="job" onResolved={changed} />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'First confirmed.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const answer = screen.getByLabelText('Your factual answer');
  expect(answer).toBeEnabled();
  fireEvent.change(answer, { target: { value: 'Second project answer.' } });
  expect(screen.getByRole('button', { name: 'Updating checks…' })).toBeDisabled();
  await act(async () => { finish(); });
  expect(screen.getByLabelText('Your factual answer')).toHaveValue('Second project answer.');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1]).toMatchObject({ target: { review_revision: 1 }, assertion: 'Second project answer.', claim_ids: ['second'] });
  await act(async () => { finish(); });
});
it('refreshes the saved review binding before allowing the next confirmation', async () => {
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

it('does not offer an unrelated shared answer from another claim in the same summary', async () => {
  const initial = view(), fact = initial.facts[0];
  initial.shared_clarifications = [{ update_id: 'other-answer', clarification: { fact: { ...fact.claim.fact, predicate: 'professional_focus' }, assertion: 'I focus on frontend architecture.' } as any }];
  localStorage.setItem('fact-answer:job:input:subject', JSON.stringify({ assertion: 'My unsaved deployment detail.', claimText: fact.claim.text, reuse: 'project', replaceShared: 'other-answer' }));
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(initial);
  render(<JobFacts jobId="job" />);
  expect(await screen.findByLabelText('Your factual answer')).toHaveValue('My unsaved deployment detail.');
  expect(screen.queryByLabelText(/Correct an earlier answer/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save existing answer for this project' })).toBeDisabled();
  expect(screen.getByText(/To reuse this answer across the project/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job instead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][1]).toMatchObject({ kind: 'confirmation' });
  expect(save.mock.calls[0][1]).not.toHaveProperty('supersedes_shared');
});

it('retains separate unsaved answers when switching between claims in the same passage', async () => {
  const initial = view(), second = structuredClone(initial.facts[0]);
  second.claim.id = 'library'; second.claim.text = 'Built accessible components.';
  second.claim.fact = { ...second.claim.fact, predicate: 'component_library' };
  second.question = 'Which accessible components did you build?'; initial.facts.push(second);
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const mounted = render(<JobFacts jobId="job" />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'I deployed the API.' } });
  fireEvent.click(screen.getByText('Other facts (2)'));
  fireEvent.click(screen.getByRole('button', { name: second.claim.text }));
  expect(screen.getByLabelText('Your factual answer')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Your factual answer'), { target: { value: 'I added keyboard navigation.' } });
  mounted.unmount();
  render(<JobFacts jobId="job" />);
  expect(await screen.findByLabelText('Your factual answer')).toHaveValue('I deployed the API.');
  fireEvent.click(screen.getByText('Other facts (2)'));
  fireEvent.click(screen.getByRole('button', { name: second.claim.text }));
  expect(screen.getByLabelText('Your factual answer')).toHaveValue('I added keyboard navigation.');
});


it('shows persisted progress, saving and saved outcomes separately from follow-up check failures', async () => {
  const initial = view();
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  let finish!: (value: Facts) => void;
  vi.spyOn(apiClient, 'saveJobFactClarification').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn().mockRejectedValue(Error('Runner unavailable'));
  render(<JobFacts jobId="job" onResolved={changed} />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'Yes, deployed.' } });
  const progress = screen.getByRole('progressbar', { name: 'Resume fact review progress' });
  expect(progress).toHaveAttribute('value', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(progress).toHaveAttribute('value', '0');
  await act(async () => { finish({ ...initial, facts: initial.facts.map(f => ({ ...f, resolution: { provenance: 'human', explanation: 'Confirmed.' } })) }); });
  expect(progress).toHaveAttribute('value', '1');
  expect(await screen.findByRole('alert')).toHaveTextContent('Your answer was saved. Resume checks need retry: Runner unavailable');
  expect(screen.queryByText(/Answer not saved/)).not.toBeInTheDocument();
});

it('does not imply completion when a confirmation response still has an unresolved fact', async () => {
  const initial = view();
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(initial);
  render(<JobFacts jobId="job" />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'Yes, deployed.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  expect(await screen.findByText(/Answer saved, but this fact is still unresolved/)).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  expect(screen.getByLabelText('Your factual answer')).toHaveValue('Yes, deployed.');
});


it('keeps completed questions in read-only history while navigation focuses the unanswered claim', async () => {
  const initial = view(), second = structuredClone(initial.facts[0]);
  initial.facts[0].resolution = { provenance: 'human', explanation: 'Confirmed.' };
  second.claim.id = 'library'; second.claim.text = 'Built accessible components.';
  second.claim.fact = { ...second.claim.fact, predicate: 'component_library' };
  second.question = 'Which accessible components did you build?'; initial.facts.push(second);
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const mounted = render(<JobFacts jobId="job" passagePath="summary" focusRequest={0} />);
  await screen.findByRole('heading', { name: second.question });
  fireEvent.click(screen.getByText('Resolved facts and supporting sources'));
  expect(screen.queryByRole('button', { name: 'Review this fact' })).not.toBeInTheDocument();
  expect(screen.getByText('Completed question: Was this API deployed for real users?')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Was this API deployed for real users?' })).not.toBeInTheDocument();
  mounted.rerender(<JobFacts jobId="job" passagePath="summary" focusRequest={1} />);
  expect(await screen.findByRole('heading', { name: second.question })).toHaveFocus();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
});

it('does not ask for a new factual answer when the remaining claim needs a technical retry', async () => {
  const initial = view(); initial.facts[0].state = 'unavailable'; initial.execution = 'unavailable';
  delete initial.facts[0].question;
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  render(<JobFacts jobId="job" />);
  expect(await screen.findByRole('button', { name: 'Retry evidence check' })).toBeEnabled();
  expect(screen.queryByLabelText('Your factual answer')).not.toBeInTheDocument();
  expect(screen.getByText(/has not produced an answerable question/)).toBeVisible();
});


it('never reopens a confirmed question grouped with an unanswered claim', async () => {
  const initial = view(), pending = structuredClone(initial.facts[0]);
  initial.facts[0].resolution = { provenance: 'human', explanation: 'Previously confirmed.' };
  pending.claim.id = 'pending'; pending.claim.text = 'Built another production API.';
  pending.question = 'Was the second API deployed?'; initial.facts.push(pending);
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  render(<JobFacts jobId="job" />);
  expect(await screen.findByRole('heading', { name: pending.question })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Was this API deployed for real users?' })).not.toBeInTheDocument();
  expect(screen.getByText('Resolved facts and supporting sources').closest('details')).not.toHaveAttribute('open');
});

it('recovers a retained answer with a save action instead of asking the question again', async () => {
  const initial = view(), fact = initial.facts[0];
  localStorage.setItem(`fact-answer:job:input:subject:${fact.claim.id}`, JSON.stringify({ claimText: fact.claim.text, assertion: 'Yes, this served customers.', reuse: 'job' }));
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(initial);
  const resolved = { ...initial, facts: initial.facts.map(f => ({ ...f, resolution: { provenance: 'human' as const, explanation: 'Yes, this served customers.' } })) };
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue(resolved);
  render(<JobFacts jobId="job" />);
  expect(await screen.findByRole('heading', { name: 'Finish saving your earlier answer' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: fact.question })).not.toBeInTheDocument();
  expect(screen.getByText('Review or edit your earlier answer').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: 'Save existing answer for this job' }));
  expect(await screen.findByText('All listed facts have saved support.')).toBeVisible();
  expect(save.mock.calls[0][1]).toMatchObject({ assertion: 'Yes, this served customers.', confirmed: true, reuse: 'job' });
  expect(screen.queryByLabelText('Your factual answer')).not.toBeInTheDocument();
});


it('recovers a committed confirmation after a lost response without repeating the question', async () => {
  const initial = view(), fact = initial.facts[0];
  const saved = { ...initial, clarifications: [{ confirmed: true, assertion: 'Yes, deployed.', fact: fact.claim.fact, claim_ids: [fact.claim.id] }],
    facts: [{ ...fact, resolution: { provenance: 'human', explanation: 'Yes, deployed.' } }] } as Facts;
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValueOnce(initial).mockResolvedValue(saved);
  const save = vi.spyOn(apiClient, 'saveJobFactClarification').mockRejectedValue(Error('Connection lost'));
  render(<JobFacts jobId="job" />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'Yes, deployed.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  expect(await screen.findByText(/Your confirmation was saved. The response was interrupted/)).toBeVisible();
  expect(screen.queryByLabelText('Your factual answer')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: fact.question })).not.toBeInTheDocument();
  expect(screen.getByText('Resolved facts and supporting sources').closest('details')).not.toHaveAttribute('open');
  expect(save).toHaveBeenCalledOnce();
});

it('renders Needs retry banner naming the specific failed batch and safe message with distinct retry button', async () => {
  const failedView: Facts = {
    ...view(),
    execution: 'unavailable',
    failures: [{
      batch_index: 3,
      stage: 'schema_validation',
      code: 'wire_shape_invalid',
      safe_diagnostic: 'Malformed wire JSON at line 1 col 12',
      passage_ids: ['p1'],
    }],
  };
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(failedView);
  const startCheck = vi.spyOn(apiClient, 'startJobFactCheck').mockResolvedValue({ operation_id: 'op-1', state: 'checking' });
  render(<JobFacts jobId="job" />);
  const banner = await screen.findByRole('alert', { name: 'Needs retry' });
  expect(banner).toBeInTheDocument();
  expect(banner).toHaveTextContent('Batch 3');
  expect(banner).toHaveTextContent('Malformed wire JSON at line 1 col 12');
  const retryBtn = screen.getByRole('button', { name: 'Retry failed checks' });
  fireEvent.click(retryBtn);
  await waitFor(() => expect(startCheck).toHaveBeenCalledWith('job', expect.objectContaining({ reason: 'retry' })));
});
