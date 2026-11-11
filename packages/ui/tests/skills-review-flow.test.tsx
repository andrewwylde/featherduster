/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { SYNTHESIS_POLICY, type Job, type ResumeSpec } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobProposalReview } from '../src/views/jobs/JobProposalReview.js';
import { JobArtifactChanges } from '../src/views/jobs/JobArtifactChanges.js';
import { skillsReviewChange } from '../src/views/jobs/skills-review.js';

const names = ['GitHub Actions', 'Docker', 'Kubernetes/Helm', 'OpenTelemetry', 'Datadog', 'Cypress'];
const keep = names.filter(name => name !== 'Docker');
const base: ResumeSpec = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, summary: 'Original summary.',
  experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Original inherited bullet.' }] }], education: [], skills: [{ category: 'Delivery', skills: names }] };
const job = { id: 'job', workspace_id: 'workspace', revision: 2, preparation_state: 'needs_input' } as Job;
function fixture(type: 'skills.prune' | 'skills.reorder' = 'skills.prune') {
  const proposal = { id: 'skills', type, target: { skill_group_index: 0 }, before: 'Misleading generated original', after: 'Keep every non-Docker skill.',
    before_skills: names, result_skills: keep, allow_empty_group: false, skills: type === 'skills.prune' ? keep : [...names].reverse(),
    citations: [], requirement_ids: [], rationale: 'Remove Docker.', checks: [], decision: 'pending' };
  return { availability: 'available', input_stale: false, corpus_revision: 0,
    generation: { id: 'generation', generation_policy: SYNTHESIS_POLICY, proposals: { proposals: [proposal, { id: 'summary', type: 'summary.rewrite', target: {}, before: base.summary,
      after: 'Generated summary.', citations: [], requirement_ids: [], checks: [], decision: 'pending' }] } },
    review: { id: 'review', revision: 0, input_snapshot_id: 'input', input_fingerprint: 'hash', patches: [{ proposal_id: 'summary', edited_after: 'Unrelated saved wording.' }], groundings: [], base_corrections: [], candidate_preview: base,
      validation: { status: 'blocked', fingerprint: 'validation', issues: [{ id: 'skills-issue', subject: { kind: 'proposal', proposal_id: 'skills' }, group: 'wording', action: 'edit_proposal', details: [{ severity: 'block', kind: 'skills_contract', message: 'Declared result does not match removals.' }] },
        { id: 'base-issue', subject: { kind: 'candidate', path: 'experiences.0.bullets.0.text' }, group: 'wording', action: 'refresh_base', details: [{ severity: 'block', kind: 'unsupported_experience', message: 'Correct inherited wording.' }] }] } },
    history: [], generations: [], captured: { evidence: [], skillSupport: [], analysis: { requirements: [] }, base_resume: base } } as any;
}
beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value }); vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(apiClient, 'getJobFacts').mockResolvedValue({ facts: [], clarifications: [], usage: { dispatched: 0, elapsed_ms: 0 }, execution: 'unchecked', configuration_evaluated: false } as any);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const skillChange = () => screen.getByRole('heading', { name: /^Remove skills \u00b7/ }).closest('section')!;

it('opens the actual skills editor through unified Changes and saves/reloads a mixed revision with undo', async () => {
  let current = fixture();
  vi.spyOn(apiClient, 'getJobProposals').mockImplementation(async () => current);
  const confirm = vi.spyOn(apiClient, 'saveJobFactClarification');
  const mixed = vi.spyOn(apiClient, 'saveMixedDraftEdits').mockImplementation(async (_id, body) => {
    const edit = body.generated_patches.find(patch => patch.proposal_id === 'skills')!;
    current = { ...current, review: { ...current.review, revision: 1, patches: [...current.review.patches, { proposal_id: 'skills', skills: edit.skills }],
      base_corrections: body.base_corrections, validation: { ...current.review.validation, issues: [] } } };
    return { success: true, new_revision: 1, review: current.review, job: { ...job, revision: 3 } };
  });
  const first = render(<JobProposalReview job={job} onSaved={() => {}} />);
  await screen.findByRole('heading', { name: 'Resume draft' });
  expect(within(skillChange()).getByText('After:').parentElement).toHaveTextContent('Docker');
  expect(within(skillChange()).getByText('After:').parentElement).not.toHaveTextContent('Keep every');
  fireEvent.click(within(skillChange()).getByRole('button', { name: 'Edit wording or evidence' }));
  const group = await screen.findByRole('group', { name: 'Skills in this group' });
  for (const name of keep) fireEvent.click(within(group).getByRole('checkbox', { name: `Retain ${name}` }));
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Retain Docker' }));
  expect(within(skillChange()).getByText('After:').parentElement).toHaveTextContent(keep.join(', '));
  fireEvent.change(screen.getByLabelText('Passage to review'), { target: { value: 'base:experiences.0.bullets.0.text' } });
  fireEvent.change(await screen.findByLabelText('Starting wording'), { target: { value: 'Corrected inherited bullet.' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save draft$/ }));
  await waitFor(() => expect(mixed).toHaveBeenCalledTimes(1));
  expect(mixed.mock.calls[0][1]).toMatchObject({ expected_revision: 0, generated_patches: [expect.objectContaining({ proposal_id: 'skills', skills: ['Docker'] })],
    base_corrections: [expect.objectContaining({ path: 'experiences.0.bullets.0.text', before: 'Original inherited bullet.', after: 'Corrected inherited bullet.' })] });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Save draft$/ })).toBeDisabled());
  first.unmount();
  const saved = vi.spyOn(apiClient, 'saveJobProposals').mockImplementation(async () => {
    current = { ...current, review: { ...current.review, revision: 2, patches: [current.review.patches[0], { proposal_id: 'skills', skills: ['Docker'], decision: 'rejected' }] } };
    return { result: { job: { ...job, revision: 4 }, review: current.review, corpus_revision: 0, requires_refresh: false }, replayed: false } as any;
  });
  render(<JobProposalReview job={{ ...job, revision: 3 }} onSaved={() => {}} />);
  await screen.findByRole('heading', { name: 'Resume draft' });
  expect(screen.getByRole('article', { name: 'Complete resume draft' })).toHaveTextContent('Corrected inherited bullet.');
  expect(screen.getByRole('article', { name: 'Complete resume draft' })).toHaveTextContent('Unrelated saved wording.');
  expect(within(skillChange()).getByText('After:').parentElement).toHaveTextContent(keep.join(', '));
  fireEvent.click(within(skillChange()).getByRole('button', { name: 'Undo change' }));
  expect(within(skillChange()).getByText('After:').parentElement).toHaveTextContent(names.join(', '));
  fireEvent.click(screen.getByRole('button', { name: /^Save draft$/ }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(saved.mock.calls[0][2].patches).toEqual([{ proposal_id: 'skills', decision: 'rejected' }]);
  expect(confirm).not.toHaveBeenCalled();
});

it('exposes keyboard reorder controls and explicit whole-group removal from the main review', async () => {
  const current = fixture('skills.reorder');
  vi.spyOn(apiClient, 'getJobProposals').mockResolvedValue(current);
  const view = render(<JobProposalReview job={job} onSaved={() => {}} />);
  const change = (await screen.findByRole('heading', { name: /^Reorder skills \u00b7/ })).closest('section')!;
  expect(within(change).getByText('After:').parentElement).toHaveTextContent([...names].reverse().join(', '));
  fireEvent.click(within(change).getByRole('button', { name: 'Edit wording or evidence' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Move Cypress down' }));
  expect(within(change).getByText('After:').parentElement).toHaveTextContent(['Datadog', 'Cypress', ...[...names].reverse().slice(2)].join(', '));
  view.unmount(); localStorage.clear();
  vi.mocked(apiClient.getJobProposals).mockResolvedValue(fixture());
  render(<JobProposalReview job={job} onSaved={() => {}} />);
  await screen.findByRole('heading', { name: /^Remove skills \u00b7/ });
  fireEvent.click(within(skillChange()).getByRole('button', { name: 'Edit wording or evidence' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Remove this entire skills group' }));
  expect(within(skillChange()).getByText('After:').parentElement).toHaveTextContent('(empty group)');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Retain Docker' }));
  expect(screen.getByRole('checkbox', { name: 'Remove this entire skills group' })).not.toBeChecked();
});

it('binds final skills diffs to the displayed PDF even when generated intent or prose disagrees', () => {
  const p = fixture().generation.proposals.proposals[0];
  const published = { ...base, skills: [{ category: 'Delivery', skills: ['Docker'] }] };
  render(<JobArtifactChanges job={job} review={{ artifact: { id: 'artifact', version_fingerprint: 'version' }, raw_base_resume: base, base_resume: base,
    draft: { candidate: published, proposals: { proposals: [p] } }, working_draft: { candidate: { ...base, skills: [{ category: 'Delivery', skills: keep }] } } } as any} disabled={false} onSaved={() => {}} />);
  expect(screen.getByText('After:').parentElement).toHaveTextContent('Retained: Docker');
  expect(screen.getByText('After:').parentElement).toHaveTextContent(`Removed: ${keep.join(', ')}`);
  expect(screen.getByText('Before:').parentElement).toHaveTextContent(names.join(', '));
  expect(screen.getByRole('button', { name: 'Undo change' })).toBeDisabled();
});

it('keeps skills diffs on their captured group when a whole-group removal shifts later groups', () => {
  const captured = { ...base, skills: [...base.skills, { category: 'Web', skills: ['TypeScript', 'React'] }] };
  const published = { ...base, skills: [{ category: 'Web', skills: ['React', 'TypeScript'] }] };
  const prune = { ...fixture().generation.proposals.proposals[0], skills: names, result_skills: [], allow_empty_group: true };
  const diff = skillsReviewChange(prune, captured, published);
  expect(diff.after).toEqual([]); expect(diff.removed).toEqual(names); expect(diff.ambiguous).toBe(false);
  const reorder = { ...prune, type: 'skills.reorder', target: { skill_group_index: 1 }, skills: ['React', 'TypeScript'] };
  expect(skillsReviewChange(reorder, captured, published).after).toEqual(['React', 'TypeScript']);
  render(<JobArtifactChanges job={job} review={{ artifact: { id: 'artifact', version_fingerprint: 'version' }, raw_base_resume: captured, base_resume: captured,
    draft: { candidate: published, proposals: { proposals: [prune, reorder] } } } as any} disabled={false} onSaved={() => {}} />);
  expect(screen.getByText(/Retained: None/)).toHaveTextContent(`Removed: ${names.join(', ')}`);
  expect(screen.getByText(/Order change: React, TypeScript/)).toBeInTheDocument();
});

it('flags ambiguous duplicate skill categories instead of borrowing a shifted group', () => {
  const captured = { ...base, skills: [...base.skills, { category: 'Delivery', skills: ['TypeScript'] }] };
  const published = { ...base, skills: [{ category: 'Delivery', skills: ['TypeScript'] }] };
  const p = fixture().generation.proposals.proposals[0];
  expect(skillsReviewChange(p, captured, published).ambiguous).toBe(true);
});

it('shows the actual artifact list when later edits no longer match the generated mutation', () => {
  const p = fixture().generation.proposals.proposals[0];
  render(<JobArtifactChanges job={job} review={{ artifact: { id: 'artifact', version_fingerprint: 'version' }, raw_base_resume: base, base_resume: base,
    draft: { candidate: { ...base, skills: [{ category: 'Delivery', skills: ['Docker', 'Cypress'] }] }, proposals: { proposals: [p] } } } as any} disabled={false} onSaved={() => {}} />);
  expect(screen.getByText('After:').parentElement).toHaveTextContent('Retained: Docker, Cypress');
  expect(screen.getByRole('button', { name: 'Undo change' })).toBeDisabled();
});
