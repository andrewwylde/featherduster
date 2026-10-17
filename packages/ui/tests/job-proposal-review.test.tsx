/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
import { EvidenceStore, type Job, type ProposalReadResponse } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobProposalReview } from '../src/views/jobs/JobProposalReview.js';

const job = { id: 'job', workspace_id: 'workspace', revision: 2, preparation_state: 'needs_input' } as Job;
const candidate = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, summary: 'Original', experiences: [], education: [], skills: [] };
const data = { availability: 'available', input_stale: false, corpus_revision: 0, generation: { id: 'generation', proposals: { proposals: [{ id: 'p1', type: 'summary.rewrite', target: {}, before: 'Original', after: 'Built backend APIs.', citations: [], requirement_ids: [], checks: [], decision: 'pending' }] } }, review: { id: 'review', revision: 0, input_fingerprint: 'hash', patches: [], groundings: [], candidate_preview: candidate, validation: { status: 'blocked', fingerprint: 'validation', issues: [{ id: 'default', subject: { kind: 'proposal', proposal_id: 'p1' }, group: 'grounding', action: 'edit_proposal', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Check backend wording' }] }] } }, history: [], generations: [], captured: { evidence: [], skillSupport: [], analysis: { requirements: [] }, base_resume: candidate } } as unknown as Extract<ProposalReadResponse, { availability: 'available' }>;
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('keeps the last successful proposal review mounted through a poll timeout and recovery', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Request timed out after 15s: /api/jobs/job/proposals')).mockResolvedValue(data);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const wording = screen.getByLabelText('Wording p1');
  fireEvent.change(wording, { target: { value: 'Unsaved review text' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Showing the last successfully loaded review');
  expect(screen.getByLabelText('Wording p1')).toHaveValue('Unsaved review text');
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Wording p1')).toHaveValue('Unsaved review text');
});
it('groups blockers by whether they belong to generated edits or the starting resume', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, review: { ...data.review, validation: { ...data.review.validation, status: 'blocked', issues: [
    { id: 'proposal-issue', subject: { kind: 'proposal', proposal_id: 'p1' }, group: 'grounding', action: 'edit_proposal', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Direct experience is not supported by cited evidence: backend.' }] },
    { id: 'base-issue', subject: { kind: 'candidate', path: 'summary' }, group: 'grounding', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Direct experience is not supported by cited evidence: TypeScript.' }] },
  ] } } } as any);
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'Proposal review' })).toBeInTheDocument();
  expect(screen.getByText('1 proposed edit')).toBeInTheDocument();
  expect(screen.getByText('1 location in the starting resume')).toBeInTheDocument();
  expect(screen.getByText('Resume summary · 1 finding')).toBeInTheDocument();
  expect(screen.getByText(/Save a job-local copy/)).toBeInTheDocument();
});
it('saves actual wording for this job without memory or implicit continuation', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job: { ...job, revision: 3 }, review: { ...data.review, revision: 1, candidate_preview: { ...candidate, summary: 'Built APIs.' } }, corpus_revision: 0, requires_refresh: false }, replayed: false });
  const start = vi.spyOn(apiClient, 'continueJobProposals');
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Wording p1'), { target: { value: 'Built APIs.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][2].patches).toEqual([{ proposal_id: 'p1', edited_after: 'Built APIs.' }]);
  expect(save.mock.calls[0][2].remember).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
  expect(await screen.findByText(/Saved revision 1\./)).toBeInTheDocument();
});
it('retains dirty wording across reload and failed saves', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  vi.spyOn(apiClient, 'saveJobProposals').mockRejectedValue(new Error('Stale review'));
  const first = render(<JobProposalReview job={job} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Wording p1'), { target: { value: 'Keep local text' } });
  first.unmount();
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  expect(await screen.findByLabelText('Wording p1')).toHaveValue('Keep local text');
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  expect(await screen.findByText(/Stale review/)).toBeInTheDocument();
  expect(screen.getByLabelText('Wording p1')).toHaveValue('Keep local text');
});
it('offers explicit one-generation recovery when output is missing', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ availability: 'missing_output', recoverable: true, latest_input_snapshot_id: 'input', input_snapshot_id: 'input' });
  const recover = vi.spyOn(apiClient, 'recoverJobProposals').mockRejectedValue(new Error('Stop prevents start'));
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Recover proposal review' }));
  expect(await screen.findByText(/Stop prevents start/)).toBeInTheDocument();
  expect(recover).toHaveBeenCalledWith('job', expect.objectContaining({ expected_job_revision: 2, input_snapshot_id: 'input' }));
});

it('rejects and restores inclusion without teaching a capability', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(data);
  const save = vi.spyOn(apiClient, 'saveJobProposals').mockResolvedValue({ result: { job, review: data.review, corpus_revision: 0, requires_refresh: false }, replayed: false });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  fireEvent.click(await screen.findByLabelText('Include proposal p1'));
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
  expect(await screen.findByLabelText('Wording p1')).toHaveValue('Old local edit');
  expect(screen.getByRole('button', { name: 'Save for this job' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile revision (keep edits)' }));
  expect(screen.getByRole('button', { name: 'Save for this job' })).toBeEnabled();
  expect(screen.getByLabelText('Wording p1')).toHaveValue('Old local edit');
});

it('refreshes without starting and exposes a separate reprepare action', async () => {
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValueOnce(data).mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'new-input' });
  const capture = vi.spyOn(apiClient, 'captureJobInputs').mockResolvedValue({ input_snapshot: { id: 'new-input' } as never });
  const prepare = vi.spyOn(apiClient, 'prepareJob').mockResolvedValue({});
  render(<JobProposalReview job={job} onSaved={() => {}} />);
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
  fireEvent.click(await screen.findByRole('button', { name: 'Recheck saved revision' }));
  await waitFor(() => expect(screen.getByLabelText('Wording p1')).toHaveFocus());
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
  fireEvent.click(await screen.findByRole('button', { name: 'Choose evidence for p1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'ev-one: API systems' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done choosing evidence' }));
  fireEvent.click(screen.getByText('Ground a specific term'));
  fireEvent.change(screen.getByLabelText('Term p1'), { target: { value: 'backend' } });
  fireEvent.change(screen.getByLabelText('Grounding source p1'), { target: { value: 'ev-one' } });
  fireEvent.change(screen.getByLabelText('Exact passage p1'), { target: { value: evidence.narrative } });
  fireEvent.change(screen.getByLabelText('Grounding explanation p1'), { target: { value: 'API/BFF work supports backend applications' } });
  fireEvent.change(screen.getByLabelText('Correction explanation'), { target: { value: 'Reviewed terminology and citation' } });
  fireEvent.click(screen.getByText('Remember a reusable relationship'));
  fireEvent.change(screen.getByLabelText('Grounding to remember'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText('Canonical skill'), { target: { value: 'backend development' } });
  fireEvent.change(screen.getByLabelText('Precise facet'), { target: { value: 'applications' } });
  fireEvent.change(screen.getByLabelText('Memory scope'), { target: { value: 'role' } });
  fireEvent.change(screen.getByLabelText('Exact scope key'), { target: { value: 'Engineer' } });
  expect(screen.getByLabelText('Memory preview')).toHaveTextContent('backend development / applications: permit only “backend” (direct)');
  expect(screen.getByLabelText('Memory preview')).toHaveTextContent(evidence.narrative);
  expect(screen.getByLabelText('Memory preview')).toHaveTextContent('"kind":"role","key":"Engineer"');
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
  fireEvent.change(await screen.findByLabelText('Wording p1'), { target: { value: 'Submitted text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Wording p1')).toBeDisabled();
  // Normal keystrokes are disabled during save; exercise a queued state change too.
  fireEvent.change(screen.getByLabelText('Wording p1'), { target: { value: 'Later local text' } });
  current = { ...data, review: { ...data.review, revision: 1, patches: [{ proposal_id: 'p1', edited_after: 'Submitted text' }], candidate_preview: { ...candidate, summary: 'Submitted text' } } };
  await act(async () => resolveSave({ result: { job: { ...job, revision: 3 }, review: current.review, corpus_revision: 0, requires_refresh: false }, replayed: false }));
  expect(screen.getByLabelText('Wording p1')).toHaveValue('Later local text');
  expect(screen.getByRole('button', { name: 'Continue preparation' })).toBeDisabled();
  expect(localStorage.getItem('proposal-draft:workspace:job:generation:review:0')).toBeNull();
  expect(JSON.parse(localStorage.getItem('proposal-draft:workspace:job:generation:review:1')!).draft.patches).toEqual([{ proposal_id: 'p1', edited_after: 'Later local text' }]);
  first.unmount();
  render(<JobProposalReview job={{ ...job, revision: 3 }} onSaved={() => {}} />);
  expect(await screen.findByLabelText('Wording p1')).toHaveValue('Later local text');
  expect(screen.getByRole('button', { name: 'Save for this job' })).toBeEnabled();
  expect(save.mock.calls[0][2].patches).toEqual([{ proposal_id: 'p1', edited_after: 'Submitted text' }]);
});

it('restores the authoritative refreshed target on remount without capture or automatic preparation', async () => {
  const load = vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'latest' });
  const capture = vi.spyOn(apiClient, 'captureJobInputs');
  const prepare = vi.spyOn(apiClient, 'prepareJob').mockResolvedValue({});
  const first = render(<JobProposalReview job={job} onSaved={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Prepare refreshed inputs' })).toBeEnabled();
  first.unmount();
  load.mockResolvedValue({ ...data, input_stale: true, latest_input_snapshot_id: 'newer' });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
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
  fireEvent.change(await screen.findByLabelText('Wording p1'), { target: { value: 'Keep this wording' } });
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
  expect(await screen.findByLabelText('Wording p1')).toBeVisible();
  expect(screen.queryByLabelText('Wording p2')).not.toBeInTheDocument();
  expect(screen.getByText('Decision 1 of 4')).toBeVisible();
  expect(screen.getByText('Optional proposals (7)').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Required passages (4)'));
  fireEvent.click(screen.getByRole('button', { name: 'Experience 1, bullet 2' }));
  expect(screen.getByLabelText('Wording p2')).toBeVisible();
  expect(screen.queryByLabelText('Wording p1')).not.toBeInTheDocument();
  view.unmount();
  vi.mocked(apiClient.getJobProposals).mockResolvedValue({ ...loaded, review: { ...loaded.review, validation: { ...loaded.review.validation, status: 'ready', issues: [] } } });
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await screen.findByText('Optional proposals (11)');
  expect(screen.queryByLabelText('Wording p1')).not.toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole('button', { name: 'Save for this job' }));
  await waitFor(() => expect(screen.getByLabelText('Starting wording')).toHaveFocus());
});
