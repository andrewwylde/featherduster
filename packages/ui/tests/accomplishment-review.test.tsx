/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProposalSchema, type Job, type JobFacts, type JobDraft, type ResumeSpec } from '@featherduster/core';
import { JobArtifactChanges } from '../src/views/jobs/JobArtifactChanges.js';
import { passageCheckState, ResumeDraftSurface } from '../src/views/jobs/ResumeDraftSurface.js';
import { apiClient, type JobReview } from '../src/api/client.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const base: ResumeSpec = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present',
  bullets: [{ text: 'Built setup in order to configure tenants.', citations: ['setup'] }, { text: 'Built migration tooling.', citations: ['migration'] }] }], skills: [], education: [] };
it('requires persisted support to show Resolved and distinguishes checking, questions and technical failure', () => {
  expect(passageCheckState(null, 'Wording', false)).toBe('Needs retry');
  const facts = { execution: 'complete', facts: [] } as unknown as JobFacts;
  expect(passageCheckState(facts, 'Wording', false)).toBe('Needs retry');
  facts.facts = [{ passage: { text: 'Wording' }, state: 'supported', resolution: null } as any];
  expect(passageCheckState(facts, 'Wording', false)).toBe('Needs retry');
  facts.facts[0].state = 'needs_clarification'; expect(passageCheckState(facts, 'Wording', false)).toBe('Needs your answer');
  facts.execution = 'checking'; expect(passageCheckState(facts, 'Wording', false)).toBe('Checking');
  facts.execution = 'complete'; facts.facts[0].resolution = { provenance: 'model', explanation: 'Captured source' };
  expect(passageCheckState(facts, 'Wording', false)).toBe('Resolved');
  expect(passageCheckState(facts, 'Wording', true)).toBe('Needs changes');
});
it('shows the complete resume and contextual exception controls without implying empty checks passed', () => {
  render(<ResumeDraftSurface resume={base} proposals={[]} facts={null} issues={[]} evidence={[]} workspaceId="workspace" disabled={false}
    onSelect={() => {}} onToggle={() => {}} renderResolution={(_id, path) => <button>Resolve {path}</button>} />);
  expect(screen.getByRole('article', { name: 'Complete resume draft' })).toHaveTextContent('Built migration tooling.');
  expect(screen.getByLabelText('Passage to review')).toHaveDisplayValue('Acme · bullet 1 — Needs retry');
  expect(screen.getByRole('button', { name: 'Resolve experiences.0.bullets.0.text' })).toBeVisible();
  expect(screen.queryByText(/all displayed passages have persisted support/)).not.toBeInTheDocument();
});
it('saves restoration, tries tighter wording, then offers a concrete replacement before generating a new PDF', async () => {
  const candidate = structuredClone(base); candidate.experiences[0].bullets.pop();
  const draft = { id: 'draft', revision: 0, candidate, proposals: { proposals: [] } } as unknown as JobDraft;
  const review = { artifact: { id: 'artifact', version_fingerprint: 'version' }, draft, base_resume: base } as JobReview;
  vi.spyOn(apiClient, 'getJob').mockResolvedValue({ job: { revision: 0 } } as never);
  vi.spyOn(apiClient, 'editJobResume').mockResolvedValue({ draft });
  const save = vi.spyOn(apiClient, 'saveJobDraft').mockImplementation(async (_job, _id, revision, value) => ({ draft: { ...draft, revision: revision + 1, candidate: value } }));
  vi.spyOn(apiClient, 'viewJobFacts').mockResolvedValue({ facts: [{ resolution: { provenance: 'model' } }] } as never);
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockResolvedValue({ status: 'blocked', issues: [{ code: 'page_budget', message: 'Two pages exceed budget.' }] } as never);
  const finalize = vi.spyOn(apiClient, 'finalizeJobDraft').mockResolvedValue({ artifact: { id: 'new' } } as never);
  render(<JobArtifactChanges job={{ id: 'job' } as Job} review={review} disabled={false} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore accomplishment' }));
  await screen.findByRole('region', { name: 'Choose a replacement' });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0][3].experiences[0].bullets).toEqual(base.experiences[0].bullets);
  expect(save.mock.calls[1][3].experiences[0].bullets[0].text).toBe('Built setup to configure tenants.');
  expect(finalize).not.toHaveBeenCalled();
  check.mockResolvedValue({ status: 'ready', issues: [], binding: {}, job_revision: 0 } as never);
  fireEvent.click(screen.getByRole('button', { name: 'Remove “Built setup to configure tenants.” and check fit' }));
  await waitFor(() => expect(finalize).toHaveBeenCalledOnce());
  expect(screen.getByText(/New PDF generated. Review and approve this version/)).toBeVisible();
});
it('keeps the final change summary bound to the displayed PDF while a restored draft is pending', () => {
  const published = structuredClone(base); published.experiences[0].bullets.pop();
  const draft = { id: 'published', candidate: published, proposals: { proposals: [] } } as unknown as JobDraft;
  const review = { artifact: { id: 'artifact', version_fingerprint: 'version' }, draft, base_resume: base,
    working_draft: { ...draft, id: 'working', candidate: base } } as JobReview;
  render(<JobArtifactChanges job={{ id: 'job' } as Job} review={review} disabled={false} onSaved={() => {}} />);
  expect(screen.getByText('Omitted accomplishments (1)')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Restore accomplishment' })).toBeDisabled();
  expect(screen.getByText(/This summary still describes the displayed PDF/)).toBeVisible();
});

it.each(['bullet.add', 'bullet.consolidate'] as const)('restores an omitted %s as one accomplishment in final PDF review', async type => {
  const proposal = ProposalSchema.parse({ id: 'generated', type, target: { experience_index: 0, bullet_index: 0 },
    after: 'Built tenant setup across APIs and UI.', citations: ['setup'], decision: 'rejected',
    source_bullets: type === 'bullet.consolidate' ? base.experiences[0].bullets.map((b, bullet_index) => ({ bullet_index, before: b.text })) : [] });
  const candidate = structuredClone(base);
  if (type === 'bullet.consolidate') candidate.experiences[0].bullets = [];
  const draft = { id: 'draft', revision: 0, candidate, proposals: { proposals: [proposal] } } as unknown as JobDraft;
  const review = { artifact: { id: 'artifact', version_fingerprint: 'version' }, draft, base_resume: base } as JobReview;
  vi.spyOn(apiClient, 'getJob').mockResolvedValue({ job: { revision: 0 } } as never);
  vi.spyOn(apiClient, 'editJobResume').mockResolvedValue({ draft });
  const save = vi.spyOn(apiClient, 'saveJobDraft').mockImplementation(async (_job, _id, revision, value) => ({ draft: { ...draft, revision: revision + 1, candidate: value } }));
  vi.spyOn(apiClient, 'viewJobFacts').mockResolvedValue({ facts: [{ resolution: { provenance: 'model' } }] } as never);
  vi.spyOn(apiClient, 'checkJobDraft').mockResolvedValue({ status: 'ready', issues: [], binding: {}, job_revision: 0 } as never);
  const finalize = vi.spyOn(apiClient, 'finalizeJobDraft').mockResolvedValue({ artifact: { id: 'new' } } as never);
  const rendered = render(<JobArtifactChanges job={{ id: 'job' } as Job} review={review} disabled={false} onSaved={() => {}} />);
  expect(screen.getByText('Omitted accomplishments (1)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Restore accomplishment' }));
  await waitFor(() => expect(finalize).toHaveBeenCalledOnce());
  const restored = save.mock.calls[0][3];
  expect(restored.experiences[0].bullets).toEqual(type === 'bullet.add'
    ? [{ text: proposal.after, citations: ['setup'] }, ...base.experiences[0].bullets]
    : [{ text: proposal.after, citations: ['setup'] }]);
  rendered.rerender(<JobArtifactChanges job={{ id: 'job' } as Job} review={{ ...review, draft: { ...draft, candidate: restored } }} disabled={false} onSaved={() => {}} />);
  expect(screen.getByText(type === 'bullet.add' ? 'Addition' : 'Consolidation')).toBeVisible();
  expect(screen.getByText('Omitted accomplishments (0)')).toBeVisible();
});

it('puts the selected question and answer above a long queue and provides explicit passage controls', () => {
  const resume = structuredClone(base);
  resume.experiences[0].bullets = Array.from({ length: 13 }, (_, i) => ({ text: `Delivered feature ${i + 1}.` }));
  const facts = { execution: 'complete', facts: resume.experiences[0].bullets.map((b, i) => ({ claim: { id: `claim-${i}`, text: b.text }, passage: { text: b.text, subject: { id: `subject-${i}`, path: `experiences.0.bullets.${i}.text` } },
    state: 'needs_clarification', resolution: null, question: `Did you deliver feature ${i + 1}?` })) } as unknown as JobFacts;
  const selected = vi.fn();
  render(<ResumeDraftSurface resume={resume} proposals={[]} facts={facts} issues={[]} evidence={[]} workspaceId="workspace" disabled={false}
    onSelect={selected} onToggle={() => {}} renderResolution={(_id, path) => <form><h3>{facts.facts.find(f => f.passage.subject.path === path)?.question}</h3><label>Your answer<textarea /></label><button>Confirm answer</button></form>} />);
  const panel = screen.getByRole('complementary', { name: 'Resume exceptions' });
  const current = within(panel).getByRole('region', { name: 'Selected exception' });
  expect(within(current).getByRole('heading', { name: 'Did you deliver feature 1?' })).toBeVisible();
  expect(within(current).getByLabelText('Your answer')).toBeVisible();
  const queue = within(panel).getByText('All passages (13)').closest('details')!;
  expect(queue).not.toHaveAttribute('open');
  expect(current.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Passage to review'), { target: { value: 'base:experiences.0.bullets.12.text' } });
  expect(within(current).getByRole('heading', { name: 'Did you deliver feature 13?' })).toBeVisible();
  expect(selected).toHaveBeenLastCalledWith('base:experiences.0.bullets.12.text');
  fireEvent.click(screen.getByRole('button', { name: 'Next passage' }));
  expect(within(current).getByRole('heading', { name: 'Did you deliver feature 1?' })).toBeVisible();
});

it('renders original capture in Before and shows correction history stages for multi-stage changes', () => {
  const originalCapture: ResumeSpec = {
    profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' },
    experiences: [
      {
        company: 'Acme',
        role: 'Engineer',
        startDate: '2020',
        endDate: 'Present',
        bullets: [{ text: 'Engineered accessible UI components across apps.', citations: ['ui'] }],
      },
    ],
    skills: [],
    education: [],
  };
  const effectiveBase: ResumeSpec = {
    ...originalCapture,
    experiences: [
      {
        ...originalCapture.experiences[0],
        bullets: [{ text: 'Engineered accessible web forms for internal admin tools.', citations: ['ui'] }],
      },
    ],
  };
  const baseCorrections = [
    {
      path: 'experiences.0.bullets.0.text',
      before: 'Engineered accessible UI components across apps.',
      after: 'Engineered accessible web forms for internal admin tools.',
      recorded_by: 'human',
      recorded_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  const proposal = ProposalSchema.parse({
    id: 'prop-1',
    type: 'bullet.rewrite',
    target: { experience_index: 0, bullet_index: 0 },
    before: 'Engineered accessible web forms for internal admin tools.',
    after: 'Delivered WCAG 2.1 accessible form controls in React.',
    citations: ['ui'],
    decision: 'accepted',
  });
  const publishedCandidate: ResumeSpec = {
    ...effectiveBase,
    experiences: [
      {
        ...effectiveBase.experiences[0],
        bullets: [{ text: 'Delivered WCAG 2.1 accessible form controls in React.', citations: ['ui'] }],
      },
    ],
  };
  const draft = {
    id: 'draft-1',
    revision: 1,
    candidate: publishedCandidate,
    proposals: { proposals: [proposal] },
  } as unknown as JobDraft;
  const review = {
    artifact: { id: 'artifact-1', version_fingerprint: 'vfp-1' },
    draft,
    base_resume: effectiveBase,
    raw_base_resume: originalCapture,
    base_corrections: baseCorrections,
  } as unknown as JobReview;

  render(<JobArtifactChanges job={{ id: 'job-1' } as Job} review={review} disabled={false} onSaved={() => {}} />);

  expect(screen.getAllByText(/Engineered accessible UI components across apps\./).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/Delivered WCAG 2.1 accessible form controls in React\./).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/Correction history \(2 stages\)/)).toBeVisible();
  expect(screen.getByText(/Job-local correction:/)).toBeInTheDocument();
  expect(screen.getByText(/Tailored proposal:/)).toBeInTheDocument();
  expect(screen.getByText(/Engineered accessible web forms for internal admin tools\./)).toBeInTheDocument();
});
