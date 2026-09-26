/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ProposalsStep } from '../src/views/tailoring/steps/ProposalsStep';
import { apiClient } from '../src/api/client';
import type { Proposal, ResumeSpec, JobAnalysis } from '@featherduster/core';

const sampleResume: ResumeSpec = {
  profile: { name: 'Alex River', title: 'Principal Engineer', email: 'alex@example.com' },
  summary: 'Infrastructure and distributed systems lead.',
  experiences: [
    {
      company: 'CloudCorp',
      role: 'Staff Engineer',
      startDate: '2022',
      endDate: 'Present',
      bullets: [
        { text: 'Led migration of legacy monolithic authentication to microservices.' },
        { text: 'Managed weekly sprint triage for backend engineers.' },
      ],
    },
  ],
  education: [],
  skills: [{ category: 'Languages', skills: ['Go', 'Rust'] }],
};

const sampleAnalysis: JobAnalysis = {
  company: 'TargetCo',
  role: 'Principal Distributed Systems Engineer',
  seniority: 'Principal',
  mission: 'Scale edge traffic mesh.',
  requirements: [
    { id: 'req-1', text: 'Auth scale', tier: 'must', quote: 'Experience scaling high-throughput auth', terms: ['auth', 'scale'] },
    { id: 'req-2', text: 'Latency reduction', tier: 'must', quote: 'Demonstrated p99 latency reduction', terms: ['latency', 'p99'] },
  ],
  boilerplate: [],
};

const sampleProposals: Proposal[] = [
  {
    id: 'prop-01',
    type: 'bullet.rewrite',
    target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 },
    before: 'Led migration of legacy monolithic authentication to microservices.',
    after: 'Architected zero-downtime microservices auth migration cutting p99 latency by 45%.',
    order: [],
    skills: [],
    citations: ['ev-001'],
    requirement_ids: ['req-1', 'req-2'],
    rationale: 'Align with high-throughput auth requirement and quantify latency reduction.',
    decision: 'pending',
    checks: [],
  },
  {
    id: 'prop-02',
    type: 'bullet.rewrite',
    target: { experience_index: 0, bullet_index: 1, skill_group_index: -1 },
    before: 'Managed weekly sprint triage for backend engineers.',
    after: 'Spearheaded game-changing synergies to strategically optimize team throughput.',
    order: [],
    skills: [],
    citations: ['ev-002'],
    requirement_ids: [],
    rationale: 'Highlight leadership impact.',
    decision: 'pending',
    checks: [
      {
        severity: 'warn',
        kind: 'deslop',
        message: 'Contains corporate buzzwords: "game-changing", "synergies", "strategically optimize".',
      },
      {
        severity: 'warn',
        kind: 'metric_needed',
        message: 'Lacks measurable production metric or quantified outcome.',
      },
    ],
  },
  {
    id: 'prop-03',
    type: 'bullet.add',
    target: { experience_index: 0, bullet_index: 2, skill_group_index: -1 },
    before: '',
    after: 'Deployed Envoy service mesh processing 1.2M req/sec across 14 global points of presence.',
    order: [],
    skills: [],
    citations: ['ev-003'],
    requirement_ids: ['req-1'],
    rationale: 'Adds concrete high-throughput mesh evidence.',
    decision: 'pending',
    checks: [],
  },
];

describe('Two-Pane Side-by-Side Tailoring Diff Inspector (Task #14)', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenEvidence = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = (props: Partial<Parameters<typeof ProposalsStep>[0]> = {}) =>
    render(
      <ProposalsStep
        proposals={sampleProposals}
        baseResume={sampleResume}
        analysis={sampleAnalysis}
        pageBudget={null}
        readOnly={false}
        saving={false}
        onSave={mockOnSave}
        onOpenEvidence={mockOnOpenEvidence}
        {...props}
      />
    );

  it('renders Diff Mode tablist with Side-by-Side Diff active by default', () => {
    renderComponent();

    const sideBySideTab = screen.getByRole('tab', { name: /Side-by-Side Diff/i });
    const unifiedTab = screen.getByRole('tab', { name: /Unified Diff/i });

    expect(sideBySideTab).toBeInTheDocument();
    expect(unifiedTab).toBeInTheDocument();
    expect(sideBySideTab).toHaveAttribute('aria-selected', 'true');
    expect(unifiedTab).toHaveAttribute('aria-selected', 'false');
  });

  it('renders two distinct panes (Original Before vs Tailored Proposal After) in Side-by-Side mode', () => {
    renderComponent();

    const diffContainer = screen.getByTestId('side-by-side-diff-prop-01');
    expect(diffContainer).toBeInTheDocument();

    // Left Pane (Original Before)
    expect(screen.getAllByText('Original (Before)').length).toBeGreaterThanOrEqual(1);
    expect(diffContainer.querySelector('del')).toHaveTextContent('Led');

    // Right Pane (Tailored Proposal After)
    expect(screen.getAllByText('Tailored Proposal (After)').length).toBeGreaterThanOrEqual(1);
    expect(diffContainer.querySelector('ins')).toHaveTextContent('Architected');
    expect(diffContainer).toHaveTextContent('Architected zero-downtime microservices auth migration cutting p99 latency by 45%.');
    expect(within(diffContainer).getByText(/Staff Engineer @ CloudCorp/i)).toBeInTheDocument();
  });

  it('switches between Side-by-Side Diff and Unified Diff modes', () => {
    renderComponent();

    expect(screen.getByTestId('side-by-side-diff-prop-01')).toBeInTheDocument();

    const unifiedTab = screen.getByRole('tab', { name: /Unified Diff/i });
    fireEvent.click(unifiedTab);

    expect(unifiedTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('side-by-side-diff-prop-01')).not.toBeInTheDocument();

    const sideBySideTab = screen.getByRole('tab', { name: /Side-by-Side Diff/i });
    fireEvent.click(sideBySideTab);
    expect(screen.getByTestId('side-by-side-diff-prop-01')).toBeInTheDocument();
  });

  it('renders direct inline linter with De-Slop compliance and Metric Grounding badges', () => {
    renderComponent();

    // Clean proposal (prop-01)
    const linter01 = screen.getByTestId('inline-linter-prop-01');
    expect(linter01).toBeInTheDocument();
    expect(linter01).toHaveTextContent('De-Slop Clean');
    expect(linter01).toHaveTextContent('Metric Grounded');

    // Slop & missing metric proposal (prop-02)
    const linter02 = screen.getByTestId('inline-linter-prop-02');
    expect(linter02).toBeInTheDocument();
    expect(linter02).toHaveTextContent('Slop Flagged');
    expect(linter02).toHaveTextContent('Clean filler');
    expect(linter02).toHaveTextContent('Metric Needed');
  });

  it('triggers one-click De-Slop ("Clean filler") and saves cleaned proposal text', async () => {
    const deslopSpy = vi.spyOn(apiClient, 'deslopText').mockResolvedValue({
      success: true,
      cleanedText: 'Directed weekly sprint triage aligning engineering priorities.',
      fixesApplied: ['Removed filler', 'Stripped buzzwords'],
    });

    renderComponent();

    const cleanBtn = screen.getByRole('button', { name: /Clean filler/i });
    fireEvent.click(cleanBtn);

    await waitFor(() => {
      expect(deslopSpy).toHaveBeenCalledWith(
        'Spearheaded game-changing synergies to strategically optimize team throughput.'
      );
      expect(mockOnSave).toHaveBeenCalled();
    });
  });

  it('supports one-click Accept and Reject per bullet edit with immediate save callback', () => {
    renderComponent();

    const proposalItem = screen.getByRole('listitem', { name: /Proposal prop-01: Bullet rewrite/i });
    const acceptBtn = within(proposalItem).getByRole('button', { name: /Accept/i });
    const rejectBtn = within(proposalItem).getByRole('button', { name: /Reject/i });

    // Click Accept
    fireEvent.click(acceptBtn);
    expect(mockOnSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prop-01', decision: 'accepted' }),
      ])
    );

    // Click Reject
    fireEvent.click(rejectBtn);
    expect(mockOnSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prop-01', decision: 'rejected' }),
      ])
    );
  });

  it('supports opening and saving manual edits on a proposal', () => {
    renderComponent();

    const proposalItem = screen.getByRole('listitem', { name: /Proposal prop-01: Bullet rewrite/i });
    const editBtn = within(proposalItem).getByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);

    const textarea = screen.getByLabelText(/Edit proposal prop-01/i);
    expect(textarea).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'Custom engineered high-throughput mesh.' } });
    const saveEditBtn = screen.getByRole('button', { name: /Save edit/i });
    fireEvent.click(saveEditBtn);

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prop-01', edited_after: 'Custom engineered high-throughput mesh.' }),
      ])
    );
  });

  it('renders side-by-side representation for bullet.add proposals', () => {
    renderComponent();

    const addDiff = screen.getByTestId('side-by-side-diff-prop-03');
    expect(addDiff).toBeInTheDocument();
    expect(addDiff).toHaveTextContent('(No prior bullet - new addition)');
    expect(addDiff).toHaveTextContent('Deployed Envoy service mesh');
  });
});
