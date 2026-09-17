/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StoryThreadsNodeMap } from '../src/views/desk/StoryThreadsNodeMap';
import { buildDeskModel } from '../src/data/deskModel';
import { testRecords } from './fixtures/deskRecords';

const model = buildDeskModel(testRecords);
const initialSources = model.sources;
const initialNodeMapEvidence = model.evidence;
const initialStoryThreads = model.threads;

describe('Story Threads Node Map Tests', () => {
  const mockOnSelectLead = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderMap = () =>
    render(
      <StoryThreadsNodeMap
        sources={initialSources}
        evidence={initialNodeMapEvidence}
        threads={initialStoryThreads}
        onSelectLead={mockOnSelectLead}
      />
    );

  it('renders 3 topology columns built from the ledger', () => {
    renderMap();
    expect(screen.getByText('Career Story Threads')).toBeInTheDocument();
    expect(screen.getByText(/Built from your evidence ledger/i)).toBeInTheDocument();
    expect(screen.getByText('1. Sources')).toBeInTheDocument();
    expect(screen.getByText('2. Evidence')).toBeInTheDocument();
    expect(screen.getByText('3. Story Threads')).toBeInTheDocument();
    expect(screen.getAllByText('pr #12').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Gateway rewrite').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Platform').length).toBeGreaterThanOrEqual(1);
  });

  it('allows keyboard navigation and node selection with Enter', () => {
    renderMap();
    const threadNode = screen.getAllByRole('button', { name: /Performance/i })[0];
    expect(threadNode).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(threadNode, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('Traceable Inspector')).toBeInTheDocument();
    expect(screen.getByText(/Selected Thread: Performance/i)).toBeInTheDocument();
  });

  it('inspects source relationships when clicking a source node', () => {
    renderMap();
    fireEvent.click(screen.getAllByRole('button', { name: /pr #12/i })[0]);
    expect(screen.getByText(/Selected Source: pr #12/i)).toBeInTheDocument();
  });

  it('filters by status and supports fit view toggle', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: /Fit view/i }));
    fireEvent.click(screen.getByRole('button', { name: /Verified/i }));
  });

  it('shows an empty state when the ledger has no evidence', () => {
    render(<StoryThreadsNodeMap sources={[]} evidence={[]} threads={[]} onSelectLead={mockOnSelectLead} />);
    expect(screen.getByText(/No evidence yet/i)).toBeInTheDocument();
  });

  it('does not show the sample data banner', () => {
    renderMap();
    expect(screen.queryByRole('note', { name: /Sample data/i })).not.toBeInTheDocument();
  });
});
