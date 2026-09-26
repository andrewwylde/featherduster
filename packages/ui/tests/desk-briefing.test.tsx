/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RunManifest } from '@featherduster/core';
import { PrivateBriefing } from '../src/views/desk/PrivateBriefing';
import { buildBriefing, buildDeskModel } from '../src/data/deskModel';
import { testRecords } from './fixtures/deskRecords';

const run = (slug: string, needs_review: boolean) =>
  ({ slug, title: `Run ${slug}`, state: needs_review ? 'proposal_review' : 'complete', updated: '2026-09-16T10:00:00Z', needs_review } as RunManifest & { needs_review: boolean });

function setup(overrides: Partial<React.ComponentProps<typeof PrivateBriefing>> = {}) {
  const model = buildDeskModel(testRecords);
  const props = {
    loading: false,
    error: null,
    briefing: buildBriefing(model),
    runs: [run('acme', true), run('done', false)],
    onStrengthen: vi.fn(),
    onViewThreads: vi.fn(),
    onOpenTailor: vi.fn(),
    onOpenRun: vi.fn(),
    onOpenEvidence: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<PrivateBriefing {...props} />);
  return props;
}

describe('Private Briefing (ledger-backed)', () => {
  afterEach(cleanup);

  it('leads with the largest real thread and its recent entries', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Your strongest thread: Platform' })).toBeInTheDocument();
    expect(screen.getByText(/Computed from your ledger/i)).toBeInTheDocument();
    const recent = screen.getByRole('list', { name: 'Recent entries' });
    for (const title of ['Queue migration', 'Latency work', 'Gateway rewrite']) {
      expect(within(recent).getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByRole('note', { name: /Sample data/i })).not.toBeInTheDocument();
    expect(screen.getByText('4 entries · 2 verified · 2 need proof · 3 threads')).toBeInTheDocument();
  });

  it('lists entries needing proof with strengthen actions', () => {
    const props = setup();
    const list = screen.getByRole('list', { name: 'Needs proof' });
    fireEvent.click(within(list).getByRole('button', { name: 'Strengthen Latency work' }));
    expect(props.onStrengthen).toHaveBeenCalledWith('ev-003');
  });

  it('surfaces tailoring: CTA and runs needing review', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Tailor for a job' }));
    expect(props.onOpenTailor).toHaveBeenCalled();
    const review = screen.getByRole('list', { name: 'Runs needing review' });
    expect(within(review).queryByText('Run done')).not.toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: /Run acme/ }));
    expect(props.onOpenRun).toHaveBeenCalledWith('acme');
  });

  it('shows an empty ledger state instead of sample content', () => {
    const props = setup({ briefing: null, runs: [] });
    expect(screen.getByText('Your ledger is empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Capture evidence' }));
    expect(props.onOpenEvidence).toHaveBeenCalled();
  });

  it('shows load errors with retry', () => {
    const props = setup({ error: 'server down', briefing: null });
    expect(screen.getByRole('alert')).toHaveTextContent('server down');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('renders interview defense simulator and evaluates candidate answer', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Interview Defense Simulator' })).toBeInTheDocument();
    expect(screen.getByText(/Mock Cross-Examination/i)).toBeInTheDocument();

    // Check tabs
    expect(screen.getByRole('button', { name: 'Attribution' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tradeoffs' })).toBeInTheDocument();

    // Switch question tab
    fireEvent.click(screen.getByRole('button', { name: 'Tradeoffs' }));
    expect(screen.getByText(/Principal Architect asks:/i)).toBeInTheDocument();

    // Type answer
    const textarea = screen.getByLabelText('Your defense answer');
    fireEvent.change(textarea, {
      target: {
        value: 'I designed the partition controller in Go, evaluating consistent hashing vs static sharding. The trade-off was memory overhead vs lookup latency, dropping p99 from 850ms to 42ms.',
      },
    });

    // Evaluate
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Defense/i }));

    const evalRegion = screen.getByRole('region', { name: 'Defense Evaluation' });
    expect(evalRegion).toBeInTheDocument();
    expect(within(evalRegion).getByText(/Score:/i)).toBeInTheDocument();
    expect(within(evalRegion).getByText(/defensible/i)).toBeInTheDocument();
  });
});

