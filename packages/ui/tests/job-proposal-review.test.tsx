/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
import { EvidenceStore, type Job, type ProposalReadResponse, type Proposal, type ProposalIssue } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobProposalReview } from '../src/views/jobs/JobProposalReview.js';

const job = { id: 'job', workspace_id: 'workspace', revision: 2, preparation_state: 'needs_input' } as Job;
const candidate = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, summary: 'Original', experiences: [], education: [], skills: [] };
const data = { availability: 'available', input_stale: false, corpus_revision: 0, generation: { id: 'generation', proposals: { proposals: [{ id: 'p1', type: 'summary.rewrite', target: {}, before: 'Original', after: 'Built backend APIs.', citations: [], requirement_ids: [], checks: [], decision: 'pending' }] } }, review: { id: 'review', revision: 0, input_fingerprint: 'hash', patches: [], groundings: [], candidate_preview: candidate, validation: { status: 'blocked', fingerprint: 'validation', issues: [{ id: 'default', subject: { kind: 'proposal', proposal_id: 'p1' }, group: 'grounding', action: 'edit_proposal', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Check backend wording' }] }] } }, history: [], generations: [], captured: { evidence: [], skillSupport: [], analysis: { requirements: [] }, base_resume: candidate } } as unknown as Extract<ProposalReadResponse, { availability: 'available' }>;
beforeEach(() => { vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue({ facts: [], clarifications: [], usage: { dispatched: 0, elapsed_ms: 0 }, execution: 'unchecked', configuration_evaluated: false } as any); });
async function openWording() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const summary = screen.queryByText('Edit wording, citations, and preparation details');
  if (summary && !summary.closest('details')?.open) fireEvent.click(summary);
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('opens and dismisses the passage drawer without saving or starting preparation', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const save = vi.spyOn(apiClient, 'saveJobProposals');
  const prepare = vi.spyOn(apiClient, 'prepareJob');
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: /All passages/ }));
  expect(screen.getByRole('dialog', { name: 'Passage overview drawer' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  expect(screen.queryByRole('dialog', { name: 'Passage overview drawer' })).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
it('explains the next correction and keeps optional input refresh secondary', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('Revise the proposed wording or keep the original');
  expect(screen.getByRole('button', { name: 'Go to next required correction' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Recheck saved revision' })).toBeVisible();
  expect(document.getElementById('refresh-inputs')).not.toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'Continue preparation' })).toBeDisabled();
});
it('keeps the last successful proposal review mounted through a poll timeout and recovery', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Request timed out after 15s: /api/jobs/job/proposals')).mockResolvedValue(data);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const wording = screen.getByLabelText('Proposed wording');
  fireEvent.change(wording, { target: { value: 'Unsaved review text' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Showing the last successfully loaded review');
  expect(screen.getByLabelText('Proposed wording')).toHaveValue('Unsaved review text');
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Proposed wording')).toHaveValue('Unsaved review text');
});
it('groups blockers by whether they belong to generated edits or the starting resume', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, review: { ...data.review, validation: { ...data.review.validation, status: 'blocked', issues: [
    { id: 'proposal-issue', subject: { kind: 'proposal', proposal_id: 'p1' }, group: 'grounding', action: 'edit_proposal', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Direct experience is not supported by cited evidence: backend.' }] },
    { id: 'base-issue', subject: { kind: 'candidate', path: 'summary' }, group: 'grounding', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Direct experience is not supported by cited evidence: TypeScript.' }] },
  ] } } } as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByRole('heading', { name: 'Proposal review' })).toBeInTheDocument();
  expect(screen.getByText('1 proposed edit')).toBeInTheDocument();
  expect(screen.getByText('1 location in the starting resume')).toBeInTheDocument();
  expect(screen.getByText('Resume summary · 1 finding')).toBeInTheDocument();
  expect(screen.getByText('Direct experience is not supported by cited evidence: TypeScript.').closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Starting wording: “Original”').closest('details')).toHaveAttribute('open');
  expect(screen.getByText(/Confirm what you did and add supporting details/)).toBeInTheDocument();
  expect(screen.getByText('Resolve all 2 blockers and save to enable Continue preparation.')).toBeInTheDocument();
  const edits = document.getElementById('proposal-edits')!;
  const remembered = screen.getByRole('region', { name: 'Remembered support' });
  expect(edits.compareDocumentPosition(remembered) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('saves actual wording for this job without memory or implicit continuation', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job: { ...job, revision: 3 }, review: { ...data.review, revision: 1, candidate_preview: { ...candidate, summary: 'Built APIs.' } }, corpus_revision: 0, requires_refresh: false }, replayed: false });
  const start = vi.spyOn(apiClient, 'continueJobProposals');
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.change(await screen.findByLabelText('Proposed wording'), { target: { value: 'Built APIs.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][2].patches).toEqual([{ proposal_id: 'p1', edited_after: 'Built APIs.' }]);
  expect(save.mock.calls[0][2].remember).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
  expect(await screen.findByText(/Saved revision 1\./)).toBeInTheDocument();
});
it('confirms a saved edit that remains blocked instead of implying acceptance', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const saved = { ...data.review, revision: 1, patches: [{ proposal_id: 'p1', edited_after: 'Revised backend wording' }] };
  vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job: { ...job, revision: 3 }, review: saved, corpus_revision: 0, requires_refresh: false } } as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.change(await screen.findByLabelText('Proposed wording'), { target: { value: 'Revised backend wording' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  expect(await screen.findByText(/This passage still needs changes: Check backend wording/)).toBeVisible();
  await waitFor(() => expect(screen.getByRole('status', { name: 'Passage save status' })).toHaveTextContent('Saved — still needs changes'));
  expect(screen.getByLabelText('Proposed wording')).toHaveValue('Revised backend wording');
  expect(screen.getByRole('button', { name: 'Continue preparation' })).toBeDisabled();
});
it('acknowledges a passing correction and opens the next required starting-resume field', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const saved = { ...data.review, revision: 1, patches: [{ proposal_id: 'p1', edited_after: 'Built APIs.' }], validation: { ...data.review.validation, issues: [{ id: 'base', subject: { kind: 'candidate', path: 'summary' }, group: 'grounding', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Fix starting summary' }] }] } };
  vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job: { ...job, revision: 3 }, review: saved, corpus_revision: 0, requires_refresh: false } } as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.change(await screen.findByLabelText('Proposed wording'), { target: { value: 'Built APIs.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  expect(await screen.findByText(/This passage passed checks. The next required correction is open below/)).toBeVisible();
  expect(screen.queryByLabelText('Proposed wording')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Starting wording').closest('details')).toHaveAttribute('open');
  await waitFor(() => expect(screen.getByLabelText('Starting wording')).toHaveFocus());
});
it('retains dirty wording across reload and failed saves', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  vi.spyOn(apiClient, 'saveJobProposals').mockRejectedValue(new Error('Stale review'));
  const first = render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.change(await screen.findByLabelText('Proposed wording'), { target: { value: 'Keep local text' } });
  first.unmount();
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByLabelText('Proposed wording')).toHaveValue('Keep local text');
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  expect(await screen.findByText(/Stale review/)).toBeInTheDocument();
  expect(screen.getByLabelText('Proposed wording')).toHaveValue('Keep local text');
});
it('offers explicit one-generation recovery when output is missing', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: true, latest_input_snapshot_id: 'input', input_snapshot_id: 'input' });
  const recover = vi.spyOn(apiClient, 'recoverJobProposals').mockRejectedValue(new Error('Stop prevents start'));
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Recover proposal review' }));
  expect(await screen.findByText(/Stop prevents start/)).toBeInTheDocument();
  expect(recover).toHaveBeenCalledWith('job', expect.objectContaining({ expected_job_revision: 2, input_snapshot_id: 'input' }));
});

it('rejects and restores inclusion without teaching a capability', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job, review: data.review, corpus_revision: 0, requires_refresh: false }, replayed: false });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByLabelText('Include this change'));
  expect(screen.getByText('Original wording will be kept.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][2].patches).toEqual([{ proposal_id: 'p1', decision: 'rejected' }]);
  expect(save.mock.calls[0][2].remember).toBeUndefined();
});

it('retains an older revision draft on reload and requires explicit reconciliation', async () => {
  localStorage.setItem('proposal-draft:workspace:job:generation:review:0', JSON.stringify({ savedAt: 1, draft: { patches: [{ proposal_id: 'p1', edited_after: 'Old local edit' }], groundings: [], explanation: '' } }));
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, review: { ...data.review, revision: 1 } });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByLabelText('Proposed wording')).toHaveValue('Old local edit');
  expect(screen.getByRole('button', { name: 'Save for this job' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile revision (keep edits)' }));
  expect(screen.getByRole('button', { name: 'Save for this job' })).toBeEnabled();
  expect(screen.getByLabelText('Proposed wording')).toHaveValue('Old local edit');
});

it('refreshes without starting and exposes a separate reprepare action', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValueOnce(data).mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'new-input' });
  const capture = vi.spyOn(apiClient, 'captureJobInputs').mockResolvedValue({ input_snapshot: { id: 'new-input' } as never });
  const prepare = vi.spyOn(apiClient, 'prepareJob').mockResolvedValue({});
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh inputs' }));
  await waitFor(() => expect(capture).toHaveBeenCalledWith('job', 2));
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare refreshed inputs' }));
  await waitFor(() => expect(prepare).toHaveBeenCalledWith('job', 'resume', expect.objectContaining({ input_snapshot_id: 'new-input', expected_revision: 2 })));
});

it('explicitly removes a saved grounding without changing remembered corpus knowledge', async () => {
  const grounding = { id: 'grounding', proposal_id: 'p1', term: 'backend', explanation: 'API support', sources: [], recorded_by: 'local-human' };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, review: { ...data.review, groundings: [grounding as never] } });
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job, review: data.review, corpus_revision: 0, requires_refresh: false }, replayed: false });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove saved grounding backend' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][2]).toMatchObject({ removed_grounding_ids: ['grounding'], groundings: [] });
  expect(save.mock.calls[0][2].remember).toBeUndefined();
});

it('focuses the first blocking field after recheck releases disabled controls', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const blocked = { ...data.review, validation: { ...data.review.validation, issues: [{ id: 'issue', subject: { kind: 'proposal' as const, proposal_id: 'p1' }, group: 'grounding', action: 'edit_proposal' as const, details: [{ severity: 'block' as const, kind: 'unsupported_experience', message: 'Ground backend', field: '' }] }] } };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, review: blocked as never });
  vi.spyOn(apiClient, 'recheckJobProposals').mockResolvedValue({ review: blocked as never } as never);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Recheck saved revision' }));
  await waitFor(() => expect(screen.getByLabelText('Proposed wording')).toHaveFocus());
  vi.unstubAllGlobals();
});

it('sends only the displayed source-bound relationship on Save and remember without continuing', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const evidence = new EvidenceStore([{ entry: { id: 'ev-one', date: '2026-01-01', company: 'acme', title: 'API systems', summary: 'Built APIs', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Built APIs and fixed BFF authentication.' }]).get('ev-one')!;
  const fingerprint = 'a'.repeat(64);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, captured: { ...data.captured, evidence: [evidence], source_fingerprints: { 'ev-one': fingerprint } } });
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job: { ...job, revision: 3 }, review: { ...data.review, revision: 1 }, corpus_revision: 1, requires_refresh: false }, replayed: false });
  const start = vi.spyOn(apiClient, 'continueJobProposals');
  const prepare = vi.spyOn(apiClient, 'prepareJob');
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Choose supporting evidence' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'API systems' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done choosing evidence' }));
  fireEvent.click(screen.getByText('Ground a specific term'));
  fireEvent.change(screen.getByLabelText('Term to ground'), { target: { value: 'backend' } });
  fireEvent.focus(screen.getByRole('combobox', { name: 'Supporting source' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Supporting source' }), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Supporting source' }), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('Exact passage'), { target: { value: evidence.narrative } });
  fireEvent.change(screen.getByLabelText('Why this passage supports the term'), { target: { value: 'API/BFF work supports backend applications' } });
  fireEvent.change(screen.getByLabelText('Correction explanation'), { target: { value: 'Reviewed terminology and citation' } });
  fireEvent.click(screen.getByText('Remember a reusable relationship'));
  fireEvent.change(screen.getByLabelText('Grounding to remember'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText('Canonical skill'), { target: { value: 'backend development' } });
  fireEvent.change(screen.getByLabelText('Precise facet'), { target: { value: 'applications' } });
  fireEvent.change(screen.getByLabelText('Memory scope'), { target: { value: 'role' } });
  fireEvent.change(screen.getByLabelText('Exact scope key'), { target: { value: 'Engineer' } });
  const preview = screen.getByLabelText('Memory preview');
  expect(preview).toHaveTextContent("'backend' is supported by: API systems");
  expect(preview).toHaveTextContent('Applies to: Engineer roles');
  expect(preview).toHaveTextContent(evidence.narrative);
  expect(preview).not.toHaveTextContent('"kind"');
  expect(preview).not.toHaveTextContent('ev-one');
  expect(screen.getByRole('option', { name: "'backend' in Resume summary" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save and remember' }));
  await screen.findByText(/Saved revision 1\./);
  const sources = [{ evidence_id: 'ev-one', evidence_fingerprint: fingerprint, quote: evidence.narrative }];
  const claim = createHash('sha256').update(JSON.stringify({ citations: ['ev-one'], proposal_id: 'p1', text: 'Built backend APIs.' })).digest('hex');
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][2]).toMatchObject({
    expected_job_revision: 2, expected_review_revision: 0, input_fingerprint: 'hash',
    patches: [{ proposal_id: 'p1', citations: ['ev-one'] }],
    groundings: [{ proposal_id: 'p1', claim_fingerprint: claim, term: 'backend', sources, explanation: 'API/BFF work supports backend applications' }],
    remember: { expected_corpus_revision: 0, change: { kind: 'skill_support', value: {
      skill: 'backend development', facet: 'applications', permitted_terms: ['backend'], support: 'direct',
      scope: { kind: 'role', key: 'Engineer' }, sources, explanation: 'API/BFF work supports backend applications',
    } } },
  });
  expect(start).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

it('acknowledges only the submitted draft when a save response arrives after a later edit', async () => {
  let current = data;
  vi.spyOn(apiClient, 'getJobProposals').mockImplementation(async () => current);
  let resolveSave!: (value: Awaited<ReturnType<typeof apiClient.saveJobProposals>>) => void;
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  const first = render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.change(await screen.findByLabelText('Proposed wording'), { target: { value: 'Submitted text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Proposed wording')).toBeDisabled();
  // Normal keystrokes are disabled during save; exercise a queued state change too.
  fireEvent.change(screen.getByLabelText('Proposed wording'), { target: { value: 'Later local text' } });
  current = { ...data, review: { ...data.review, revision: 1, patches: [{ proposal_id: 'p1', edited_after: 'Submitted text' }], candidate_preview: { ...candidate, summary: 'Submitted text' } } };
  await act(async () => resolveSave({ result: { job: { ...job, revision: 3 }, review: current.review, corpus_revision: 0, requires_refresh: false }, replayed: false }));
  expect(screen.getByLabelText('Proposed wording')).toHaveValue('Later local text');
  expect(screen.getByRole('button', { name: 'Continue preparation' })).toBeDisabled();
  expect(localStorage.getItem('proposal-draft:workspace:job:generation:review:0')).toBeNull();
  expect(JSON.parse(localStorage.getItem('proposal-draft:workspace:job:generation:review:1')!).draft.patches).toEqual([{ proposal_id: 'p1', edited_after: 'Later local text' }]);
  first.unmount();
  render(<JobProposalReview job={{ ...job, revision: 3 }} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByLabelText('Proposed wording')).toHaveValue('Later local text');
  expect(screen.getByRole('button', { name: 'Save for this job' })).toBeEnabled();
  expect(save.mock.calls[0][2].patches).toEqual([{ proposal_id: 'p1', edited_after: 'Submitted text' }]);
});

it('restores the authoritative refreshed target on remount without capture or automatic preparation', async () => {
  const load = vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'latest' });
  const capture = vi.spyOn(apiClient, 'captureJobInputs');
  const prepare = vi.spyOn(apiClient, 'prepareJob').mockResolvedValue({});
  const first = render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByRole('button', { name: 'Prepare refreshed inputs' })).toBeEnabled();
  first.unmount();
  load.mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'newer' });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  const button = await screen.findByRole('button', { name: 'Prepare refreshed inputs' });
  expect(prepare).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Recheck saved revision' })).toBeDisabled();
  fireEvent.click(button);
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(prepare).toHaveBeenCalledWith('job', 'resume', expect.objectContaining({ input_snapshot_id: 'newer' }));
  expect(capture).not.toHaveBeenCalled();
});

it('protects stale unsaved edits from preparation and explains preservation', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'latest' });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.change(await screen.findByLabelText('Proposed wording'), { target: { value: 'Keep this wording' } });
  expect(screen.getByRole('button', { name: 'Prepare refreshed inputs' })).toBeDisabled();
  expect(screen.getByText(/Preserve your unsaved text/)).toBeInTheDocument();
  expect(Object.values(localStorage).join()).toContain('Keep this wording');
});

it('shows one affected passage at representative proposal volume and never expands optional edits when ready', async () => {
  const proposals = Array.from({ length: 11 }, (_, i) => ({ ...data.generation.proposals.proposals[0], id: `p${i + 1}`, type: 'bullet.rewrite' as const, target: { experience_index: Math.floor(i / 6), bullet_index: i % 6, skill_group_index: -1 } }));
  const issues = proposals.slice(0, 4).map(p => ({ ...data.review.validation.issues[0], id: p.id, subject: { kind: 'proposal' as const, proposal_id: p.id } }));
  const loaded = { ...data, generation: { ...data.generation, proposals: { proposals } }, review: { ...data.review, validation: { ...data.review.validation, issues } } };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(loaded);
  const view = render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByLabelText('Proposed wording')).toBeVisible();
  expect(screen.getAllByLabelText('Proposed wording')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Experience 1, bullet 1' })).toBeVisible();
  expect(screen.getByText('Decision 1 of 4')).toBeVisible();
  expect(screen.getByText('Optional proposals (7)').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Required passages (4)'));
  fireEvent.click(screen.getByRole('button', { name: 'Experience 1, bullet 2' }));
  expect(screen.getByLabelText('Proposed wording')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Experience 1, bullet 2' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Experience 1, bullet 1' })).not.toBeInTheDocument();
  view.unmount();
  vi.mocked(apiClient.getJobProposals).mockResolvedValue({ ...loaded, review: { ...loaded.review, validation: { ...loaded.review.validation, status: 'ready', issues: [] } } });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  await screen.findByText('Optional proposals (11)');
  expect(screen.queryByLabelText('Proposed wording')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue preparation' })).toBeEnabled();
});

it('moves keyboard focus to a starting passage when the final generated blocker is saved', async () => {
  const baseIssue = { id: 'base', subject: { kind: 'candidate', path: 'summary' }, group: 'grounding', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Correct starting summary' }] };
  const saved = { ...data, review: { ...data.review, revision: 1, validation: { ...data.review.validation, issues: [baseIssue] } } } as typeof data;
  let current = data;
  vi.spyOn(apiClient, 'getJobProposals').mockImplementation(async () => current);
  vi.spyOn(apiClient, 'saveJobProposals').mockImplementation(async () => {
    current = saved;
    return { result: { job: { ...job, revision: 3 }, review: saved.review, corpus_revision: 0, requires_refresh: false }, replayed: false } as never;
  });
  const onSaved = () => view.rerender(<JobProposalReview job={{ ...job, revision: 3 }} onSaved={onSaved} />);
  const view = render(<JobProposalReview job={job} onSaved={onSaved} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(screen.getByLabelText('Starting wording')).toHaveFocus());
});

it('rechecks a starting-resume save in place and advances to the next blocker without preparation', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const resume = { ...candidate, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020-01', endDate: '2024-01', bullets: [{ text: 'Reduced latency by 91%.' }, { text: 'Served 900 customers.' }] }] };
  const issue = (bullet: number, message: string) => ({ id: `base-${bullet}`, subject: { kind: 'candidate', path: `experiences.0.bullets.${bullet}.text` }, group: 'metric_unverified', action: 'refresh_base', details: [{ severity: 'block', kind: 'metric_unverified', message }] });
  const loaded = { ...data, generation: { ...data.generation, proposals: { proposals: [] } }, review: { ...data.review, candidate_preview: resume, validation: { ...data.review.validation, issues: [issue(0, 'Numbers not supported by cited verified evidence: 91%.'), issue(1, 'Numbers not supported by cited verified evidence: 900.')] } }, captured: { ...data.captured, base_resume: resume } } as unknown as typeof data;
  const corrected = { ...loaded.review, revision: 1, base_corrections: [{ path: 'experiences.0.bullets.0.text', before: 'Reduced latency by 91%.', after: 'Improved service reliability.', recorded_by: 'local-human', recorded_at: new Date().toISOString() }], validation: { ...loaded.review.validation, issues: [issue(1, 'Numbers not supported by cited verified evidence: 900.')] } } as unknown as typeof data.review;
  const readyReview = { ...corrected, revision: 2, validation: { ...corrected.validation, status: 'ready', issues: [] } } as unknown as typeof data.review;
  let current = loaded;
  vi.spyOn(apiClient, 'getJobProposals').mockImplementation(async () => current);
  const correct = vi.spyOn(apiClient, 'correctJobStartingResume')
    .mockImplementationOnce(async () => { current = { ...loaded, review: corrected }; return { result: { job: { ...job, revision: 3 }, review: corrected }, replayed: false }; })
    .mockImplementationOnce(async () => { current = { ...loaded, review: readyReview }; return { result: { job: { ...job, revision: 4 }, review: readyReview }, replayed: false }; });
  const prepare = vi.spyOn(apiClient, 'prepareJob');
  const capture = vi.spyOn(apiClient, 'captureJobInputs');
  // Intentionally do not synchronously bump the parent job.revision prop on onSaved, matching real async parent polling.
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByText('2 blockers')).toBeInTheDocument();
  fireEvent.change(screen.getAllByLabelText('Starting wording')[0], { target: { value: 'Improved service reliability.' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save starting resume for this job' })[0]);
  expect(await screen.findByText('1 blocker')).toBeInTheDocument();
  expect(correct).toHaveBeenCalledWith('job', expect.objectContaining({ review_id: 'review', expected_review_revision: 0, path: 'experiences.0.bullets.0.text', text: 'Improved service reliability.' }));
  expect(screen.queryByText(/Numbers not supported by cited verified evidence: 91%/)).not.toBeInTheDocument();
  expect(screen.getByText(/Job-local starting resume saved in revision 1\./)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Starting wording')).toHaveFocus());
  expect(screen.getByLabelText('Starting wording')).toHaveValue('Served 900 customers.');
  expect(screen.queryByText(/job changed while this correction was open/)).not.toBeInTheDocument();
  expect(screen.queryByText(/The job or review changed/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Prepare refreshed inputs' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Starting wording'), { target: { value: 'Served enterprise customers.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save starting resume for this job' }));
  expect(await screen.findByText('Ready to continue')).toBeInTheDocument();
  expect(screen.queryByText(/The job or review changed/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue preparation' })).toBeEnabled();
  expect(prepare).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});

it('excludes retracted evidence from the evidence chooser', async () => {
  const store = new EvidenceStore([
    { entry: { id: 'ev-ok', date: '2026-01-01', company: 'acme', title: 'Verified API work', summary: 'Built APIs', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Built APIs.' },
    { entry: { id: 'ev-ret', date: '2026-01-02', company: 'acme', title: 'Retracted legacy claim', summary: 'Retracted claim', impact: 'None', themes: [], confidence: 'retracted', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Do not cite.' },
  ]);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, captured: { ...data.captured, evidence: store.getAll() } });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  fireEvent.click(await screen.findByRole('button', { name: 'Choose supporting evidence' }));
  expect(screen.getByRole('checkbox', { name: 'Verified API work' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Retracted legacy claim/ })).not.toBeInTheDocument();
});

it('keeps rendering the review when a stored starting-resume correction no longer matches its captured wording', async () => {
  const mismatched = { ...data.review, base_corrections: [{ path: 'summary', before: 'Different captured wording', after: 'Corrected', recorded_by: 'local-human', recorded_at: new Date().toISOString() }] };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, review: mismatched } as never);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByRole('heading', { name: 'Proposal review' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('no longer matches');
});
it('labels the correction fields in plain language without internal proposal or source IDs', async () => {
  const evidence = new EvidenceStore([{ entry: { id: 'synthetic-0', date: '2026-01-01', company: 'acme', title: 'API delivery', summary: 'Built APIs', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Built APIs.' }]).get('synthetic-0')!;
  const withCitation = { ...data, generation: { ...data.generation, proposals: { proposals: [{ ...data.generation.proposals.proposals[0], citations: ['synthetic-0'] }] } }, captured: { ...data.captured, evidence: [evidence] } } as typeof data;
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(withCitation);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByRole('textbox', { name: 'Proposed wording' })).toHaveValue('Built backend APIs.');
  expect(screen.getByRole('checkbox', { name: 'Include this change' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Choose supporting evidence' })).toBeInTheDocument();
  expect(screen.getByText('Evidence grounding')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove citation API delivery' })).toBeInTheDocument();
  expect(screen.getByText('API delivery · captured passage')).toBeInTheDocument();
  const section = screen.getByRole('region', { name: 'Current passage' });
  expect(section).not.toHaveTextContent(/\bp1\b/);
  expect(section).not.toHaveTextContent('synthetic-0');
  expect(screen.queryByText('grounding', { exact: true })).not.toBeInTheDocument();
});
it('describes request timeouts in plain sentences without API paths', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Request timed out after 15s: /api/jobs/job/proposals')).mockResolvedValue(data);
  vi.spyOn(apiClient, 'saveJobProposals').mockRejectedValue(new Error('Request timed out after 15s: /api/jobs/job/proposals/review'));
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('The jobs host is taking longer than expected to respond. Showing the last successfully loaded review; it will refresh when the host responds.');
  expect(alert).not.toHaveTextContent('/api/');
  vi.useRealTimers();
  fireEvent.change(screen.getByLabelText('Proposed wording'), { target: { value: 'Timed out text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  expect(await screen.findByText('The save is taking longer than expected. Your edits are kept in this browser; try again.')).toBeInTheDocument();
  expect(screen.queryByText(/\/api\//)).not.toBeInTheDocument();
});


it('Review the next question opens a remaining question instead of the selected confirmed passage', async () => {
  const resume = { ...candidate, summary: 'Built backend APIs.', experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', bullets: [{ text: 'Built accessible components.' }] }] };
  const reviewData = { ...data, generation: { ...data.generation, generation_policy: 'accomplishments-1' }, captured: { ...data.captured, base_resume: { ...resume, summary: 'Original' } },
    review: { ...data.review, candidate_preview: resume, validation: { ...data.review.validation, issues: [{ id: 'library', subject: { kind: 'candidate', path: 'experiences.0.bullets.0.text' }, group: 'grounding', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Confirm component work.' }] }] } } };
  const facts = ['summary', 'experiences.0.bullets.0.text'].map((path, i) => {
    const text = i ? 'Built accessible components.' : 'Built backend APIs.';
    const subject = { id: path, path, passage_fingerprint: text };
    return { claim: { id: path, text, subject, start: 0, end: text.length, fact: { work_id: path, predicate: 'built', qualifiers: [] }, qualifier_text: [] }, passage: { text, subject, work_id: path, inherited: false },
      state: i ? 'needs_clarification' : 'supported', resolution: i ? null : { provenance: 'human', explanation: 'Confirmed.' }, evidence: [], explanation: 'Describe the contribution.', question: i ? 'Which accessible components did you build?' : undefined };
  });
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(reviewData as any);
  vi.mocked(apiClient.getJobFacts).mockResolvedValue({ facts, clarifications: [{ confirmed: true, fact: facts[0].claim.fact }], usage: { dispatched: 0, elapsed_ms: 0 }, execution: 'complete' } as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await screen.findByRole('heading', { name: 'Which accessible components did you build?' });
  fireEvent.change(screen.getByLabelText('Passage to review'), { target: { value: 'p1' } });
  expect(await screen.findByText(/Saved and confirmed for this job/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Review the next question' }));
  expect(await screen.findByRole('heading', { name: 'Which accessible components did you build?' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Which accessible components did you build?' })).toHaveFocus());
  expect(screen.getByLabelText('Passage to review')).toHaveDisplayValue('Acme · bullet 1 — Needs your answer');
});


it('offers remaining changes instead of a nonexistent next question and opens the edit controls', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, generation: { ...data.generation, generation_policy: 'accomplishments-1' } } as any);
  vi.mocked(apiClient.getJobFacts).mockResolvedValue({ facts: [], clarifications: [], usage: { dispatched: 0, elapsed_ms: 0 }, execution: 'complete' } as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  const action = await screen.findByRole('button', { name: 'Review remaining changes' });
  expect(screen.queryByRole('button', { name: 'Review the next question' })).not.toBeInTheDocument();
  fireEvent.click(action);
  const edit = screen.getByText('Edit wording or evidence instead').closest('details');
  expect(edit).toHaveAttribute('open');
  expect(screen.getByRole('heading', { name: /Wording or evidence still needs changes/ })).toHaveFocus();
  expect(screen.getByLabelText('Proposed wording')).toBeVisible();
});


it('removes a confirmed question from the page action while a single follow-up check is pending', async () => {
  const reviewData = { ...data, generation: { ...data.generation, generation_policy: 'accomplishments-1' } };
  const subject = { id: 'summary', path: 'summary', passage_fingerprint: 'summary' };
  const initial = { job_id: 'job', input_fingerprint: 'input', semantic_revision: 0, execution: 'complete', support_fingerprint: 'before',
    facts: [{ claim: { id: 'claim', subject, text: 'Built backend APIs.', start: 0, end: 19, fact: { work_id: 'summary', predicate: 'built', qualifiers: [] } },
      passage: { subject, text: 'Built backend APIs.' }, resolution: null, state: 'needs_clarification', evidence: [], question: 'Did you build the APIs?' }], clarifications: [], usage: { dispatched: 0, elapsed_ms: 0 } };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(reviewData as any);
  vi.mocked(apiClient.getJobFacts).mockResolvedValue(initial as any);
  vi.spyOn(apiClient, 'saveJobFactClarification').mockResolvedValue({ ...initial, semantic_revision: 1, support_fingerprint: 'after',
    facts: initial.facts.map(f => ({ ...f, resolution: { provenance: 'human', explanation: 'I built them.' } })) } as any);
  const checking = vi.spyOn(apiClient, 'getJob').mockImplementation(() => new Promise(() => {}));
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Your factual answer'), { target: { value: 'I built them.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm for this job and continue' }));
  await waitFor(() => expect(checking).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: 'Review the next question' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Did you build the APIs?' })).not.toBeInTheDocument();
  expect(screen.getByText('Resolved facts and supporting sources').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('status', { name: 'Next required action' })).toHaveTextContent('wait for resume checks');
});


it('offers Leave out of this draft in the wording editor, removes the bullet, and restores it through Changes', async () => {
  const resume = { ...candidate, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', bullets: [{ text: 'Migrated LinkedUp tests.' }, { text: 'Kept another accomplishment.' }] }] };
  const reviewData = { ...data, generation: { ...data.generation, generation_policy: 'accomplishments-1' }, captured: { ...data.captured, base_resume: resume }, review: { ...data.review, candidate_preview: resume } };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(reviewData as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await screen.findByLabelText('Passage to review');
  fireEvent.change(screen.getByLabelText('Passage to review'), { target: { value: 'base:experiences.0.bullets.0.text' } });
  fireEvent.click(screen.getByText('Edit wording or evidence instead'));
  fireEvent.click(screen.getByRole('button', { name: 'Leave out of this draft' }));
  expect(screen.getByRole('article', { name: 'Complete resume draft' })).not.toHaveTextContent('Migrated LinkedUp tests.');
  expect(screen.getByRole('article', { name: 'Complete resume draft' })).toHaveTextContent('Kept another accomplishment.');
  expect(screen.getByRole('button', { name: 'Save draft' })).toHaveFocus();
  expect(screen.getByRole('heading', { name: 'Omitted by you' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Restore accomplishment' }));
  expect(screen.getByRole('article', { name: 'Complete resume draft' })).toHaveTextContent('Migrated LinkedUp tests.');
  expect(screen.getByRole('heading', { name: 'Restored accomplishment' })).toBeVisible();
});


it('separates completed factual answers from remaining wording checks and exposes the edit action', async () => {
  const text = 'Built backend APIs.', subject = { id: 'summary', path: 'summary', passage_fingerprint: text };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, generation: { ...data.generation, generation_policy: 'accomplishments-1' } } as any);
  vi.mocked(apiClient.getJobFacts).mockResolvedValue({ execution: 'complete', support_fingerprint: 'resolved', clarifications: [], usage: { dispatched: 0, elapsed_ms: 0 }, facts: [{
    claim: { id: 'claim', subject, text, start: 0, end: text.length, fact: { work_id: 'api', predicate: 'built', qualifiers: [] } },
    passage: { subject, text }, state: 'supported', resolution: { provenance: 'human', explanation: 'Confirmed.' }, evidence: [],
  }] } as any);
  render(<JobProposalReview job={{ ...job, preparation_state: 'interrupted' }} onSaved={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'Factual answers complete; wording or evidence needs attention' })).toBeVisible();
  expect(screen.getByText('1 passage still needs changes. Choose Review remaining changes to open the affected wording and its evidence. You do not need to answer the completed questions again.')).toBeVisible();
  expect(screen.getByRole('status', { name: 'Next required action' })).toHaveTextContent('Next: review the wording or evidence changes below. Your factual answers are already saved.');
  expect(screen.getByLabelText('Proposed wording')).toBeVisible();
  expect(screen.queryByText('All facts resolved. Resume checks still apply.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Your factual answer')).not.toBeInTheDocument();
});

it('labels findings from retained baseline as resolved by pending edit when replacement proposal is active', async () => {
  const baseResume = { ...candidate, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020-01', endDate: '2024-01', bullets: [{ text: 'Built 11 features with zero bugs.' }] }] };
  const previewResume = { ...baseResume, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020-01', endDate: '2024-01', bullets: [{ text: 'Built features with zero bugs.' }] }] };
  const rewriteProposal: Proposal = {
    id: 'p-rewrite',
    type: 'bullet.rewrite',
    target: { experience_index: 0, bullet_index: 0 } as any,
    before: 'Built 11 features with zero bugs.',
    after: 'Built features with zero bugs.',
    citations: ['ev-1'],
    requirement_ids: [],
    decision: 'pending',
    checks: [],
  } as unknown as Proposal;
  const baseFinding: ProposalIssue = {
    id: 'base-0',
    subject: { kind: 'candidate', path: 'experiences.0.bullets.0.text' },
    group: 'metric_unverified',
    action: 'refresh_base',
    target: {
      scope: 'retained_baseline',
      text: 'Built 11 features with zero bugs.',
      text_fingerprint: 'fp_base_11',
      revision: 0,
    },
    details: [{
      severity: 'block',
      kind: 'metric_unverified',
      message: 'Numbers not supported by cited verified evidence: 11.',
      target: {
        scope: 'retained_baseline',
        text: 'Built 11 features with zero bugs.',
        text_fingerprint: 'fp_base_11',
        revision: 0,
      },
    }],
  };
  const testData = {
    ...data,
    generation: { ...data.generation, proposals: { proposals: [rewriteProposal] } },
    review: {
      ...data.review,
      candidate_preview: previewResume,
      validation: { ...data.review.validation, issues: [baseFinding] },
    },
    captured: { ...data.captured, base_resume: baseResume },
  };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(testData as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByText(/Retained baseline finding \(resolved by your pending edit\)/)).toBeInTheDocument();
});

it('prevents stale finding from showing as defect when user edits newly typed text', async () => {
  const proposal: Proposal = {
    id: 'p-metric',
    type: 'summary.rewrite',
    target: {} as any,
    before: '',
    after: 'Reduced latency by 99%.',
    citations: ['ev-1'],
    requirement_ids: [],
    decision: 'pending',
    checks: [],
  } as unknown as Proposal;
  const issue: ProposalIssue = {
    id: 'issue-metric',
    subject: { kind: 'proposal', proposal_id: 'p-metric' },
    group: 'metric_unverified',
    action: 'edit_proposal',
    target: {
      scope: 'generated_patch',
      text: 'Reduced latency by 99%.',
      text_fingerprint: 'fp_99',
      revision: 0,
    },
    details: [{
      severity: 'block',
      kind: 'metric_unverified',
      message: 'Numbers not supported by cited verified evidence: 99%.',
      target: {
        scope: 'generated_patch',
        text: 'Reduced latency by 99%.',
        text_fingerprint: 'fp_99',
        revision: 0,
      },
    }],
  };
  const testData = {
    ...data,
    generation: { ...data.generation, proposals: { proposals: [proposal] } },
    review: {
      ...data.review,
      validation: { ...data.review.validation, issues: [issue] },
    },
  };
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(testData as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect((await screen.findAllByText(/Numbers not supported by cited verified evidence: 99%/)).length).toBeGreaterThan(0);

  // User edits the proposal wording to remove the unverified metric
  fireEvent.change(screen.getByLabelText('Proposed wording'), { target: { value: 'Improved latency substantially.' } });
  // The stale finding for "99%" should no longer be displayed as an active defect
  expect(screen.queryByText(/Numbers not supported by cited verified evidence: 99%/)).not.toBeInTheDocument();
});

function renderJobReview(options: {
  supportedClaims: number;
  unresolvedFacts: number;
  wordingBlockers: number;
  technicalRetries: number;
  isChecking: boolean;
}) {
  const supported = Array.from({ length: options.supportedClaims }, (_, i) => ({
    claim: { id: `claim-sup-${i}`, text: `Supported claim ${i}`, fact: { subject: 's', predicate: 'p', object: `sup-${i}` } },
    state: 'supported' as const,
    evidence: [{ evidence_id: 'ev-1', field: 'title', text: 'quote' }],
    explanation: 'Supported',
    resolution: { provenance: 'model' as const, explanation: 'Verified' },
    passage: { subject: { id: `p-sup-${i}`, path: 'summary' }, text: 'Original summary' },
  }));

  const unresolved = Array.from({ length: options.unresolvedFacts }, (_, i) => ({
    claim: { id: `claim-unres-${i}`, text: `Unresolved claim ${i}`, fact: { subject: 's', predicate: 'p', object: `unres-${i}` } },
    state: 'needs_clarification' as const,
    evidence: [],
    explanation: 'Needs clarification',
    question: `Clarify fact ${i}?`,
    resolution: null,
    passage: { subject: { id: `p-unres-${i}`, path: 'summary' }, text: 'Original summary' },
  }));

  const technical = Array.from({ length: options.technicalRetries }, (_, i) => ({
    claim: { id: `claim-tech-${i}`, text: `Technical retry claim ${i}`, fact: { subject: 's', predicate: 'p', object: `tech-${i}` } },
    state: 'unavailable' as const,
    evidence: [],
    explanation: 'Unavailable',
    resolution: null,
    passage: { subject: { id: `p-tech-${i}`, path: 'summary' }, text: 'Original summary' },
  }));

  const mockFacts = {
    job_id: job.id,
    job_revision: 2,
    semantic_revision: 1,
    input_fingerprint: 'hash',
    candidate_fingerprint: 'cand',
    support_fingerprint: 'supp',
    target: { kind: 'review' as const, review_id: 'review', review_revision: 0 },
    facts: [...supported, ...unresolved, ...technical],
    clarifications: [],
    execution: options.isChecking ? ('checking' as const) : ('complete' as const),
    configuration_evaluated: true,
    failures: options.technicalRetries > 0 ? [{
      batch_index: 1,
      stage: 'schema_validation' as const,
      code: 'wire_shape_invalid' as const,
      safe_diagnostic: 'Schema validation error',
    }] : [],
    usage: { dispatched: 0, elapsed_ms: 0, tokens: null, cost: null },
  };

  const wordingIssues: ProposalIssue[] = Array.from({ length: options.wordingBlockers }, (_, i) => ({
    id: `issue-wording-${i}`,
    subject: { kind: 'proposal' as const, proposal_id: `p${i + 1}` },
    group: 'grounding',
    action: 'edit_proposal' as const,
    details: [{
      severity: 'block' as const,
      kind: 'unsupported_experience',
      message: `Wording blocker ${i + 1}`,
    }],
  }));

  const mockProposals = Array.from({ length: Math.max(1, options.wordingBlockers) }, (_, i) => ({
    id: `p${i + 1}`,
    type: 'summary.rewrite' as const,
    target: {},
    before: 'Original',
    after: `Built backend APIs ${i + 1}.`,
    citations: [],
    requirement_ids: [],
    checks: [],
    decision: 'pending' as const,
  }));

  const mockData = {
    ...data,
    generation: {
      ...data.generation,
      generation_policy: 'synthesis_v1',
      proposals: { proposals: mockProposals },
    },
    review: {
      ...data.review,
      validation: {
        ...data.review.validation,
        status: (options.wordingBlockers > 0 ? 'blocked' : 'ready') as 'blocked' | 'ready',
        issues: wordingIssues,
      },
    },
  };

  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue(mockFacts as any);
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(mockData as any);

  return render(
    <JobProposalReview
      job={job}
      onSaved={() => {}}
      initialData={mockData as any}
      initialFacts={mockFacts as any}
    />
  );
}

it('displays distinct counts for factual questions, technical checks, and wording issues without resetting to 0 during check', () => {
  renderJobReview({
    supportedClaims: 9,
    unresolvedFacts: 2,
    wordingBlockers: 3,
    technicalRetries: 1,
    isChecking: true,
  });

  expect(screen.getByTestId('fact-count-badge')).toHaveTextContent('2 facts need answer');
  expect(screen.getByTestId('wording-issue-badge')).toHaveTextContent('3 wording issues');
  expect(screen.getByTestId('technical-retry-badge')).toHaveTextContent('1 technical check needs retry');
  // Crucial: Checking active does not wipe supported claims count
  expect(screen.getByTestId('supported-claims-summary')).toHaveTextContent('9 claims supported');
  expect(screen.getByTestId('primary-next-action')).toHaveTextContent('Checking in progress...');
});


