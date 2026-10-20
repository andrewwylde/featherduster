/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
import { EvidenceStore, type Job, type ProposalReadResponse } from '@featherduster/core';
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
it('explains the next correction and keeps optional input refresh secondary', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await openWording();
  expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('uncheck Include this change');
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
  expect(screen.getByText(/Save a job-local copy/)).toBeInTheDocument();
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
  expect(screen.getByText('Rejected — original content retained.')).toBeInTheDocument();
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
