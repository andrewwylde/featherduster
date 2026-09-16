/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StoryThreadsNodeMap } from '../src/views/desk/StoryThreadsNodeMap';
import {
  initialSources,
  initialNodeMapEvidence,
  initialStoryThreads,
} from '../src/data/deskFixtures';

describe('Story Threads Node Map Tests', () => {
  const mockOnSelectLead = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders 3 topology columns: Sources, Evidence, and Story Threads', () => {
    render(
      <StoryThreadsNodeMap
        sources={initialSources}
        evidence={initialNodeMapEvidence}
        threads={initialStoryThreads}
        onSelectLead={mockOnSelectLead}
      />
    );

    // Section header
    expect(screen.getByText('Career Story Threads')).toBeInTheDocument();
    expect(screen.getByText(/Sources roll up into evidence, which build your career story/i)).toBeInTheDocument();

    // 3 Column headings
    expect(screen.getByText('1. Sources')).toBeInTheDocument();
    expect(screen.getByText('2. Evidence')).toBeInTheDocument();
    expect(screen.getByText('3. Story Threads')).toBeInTheDocument();

    // Key nodes
    expect(screen.getByText('Add automated failover for job workers')).toBeInTheDocument();
    expect(screen.getByText('Improved system resilience')).toBeInTheDocument();
    expect(screen.getAllByText('Reliability leadership').length).toBeGreaterThanOrEqual(1);
  });

  it('allows keyboard navigation and node selection with Enter and Space', () => {
    render(
      <StoryThreadsNodeMap
        sources={initialSources}
        evidence={initialNodeMapEvidence}
        threads={initialStoryThreads}
        onSelectLead={mockOnSelectLead}
      />
    );

    const threadNode = screen.getByRole('button', { name: /Reliability leadership/i });
    expect(threadNode).toHaveAttribute('tabindex', '0');

    // Select with Enter
    fireEvent.keyDown(threadNode, { key: 'Enter', code: 'Enter' });

    // Inspector opens with traceable relationship details
    expect(screen.getByText('Traceable Inspector')).toBeInTheDocument();
    expect(screen.getByText(/Selected Thread: Reliability leadership/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Infrastructure resilience, operational ownership/i).length).toBeGreaterThanOrEqual(1);
  });

  it('inspects source relationships when clicking a source node', () => {
    render(
      <StoryThreadsNodeMap
        sources={initialSources}
        evidence={initialNodeMapEvidence}
        threads={initialStoryThreads}
        onSelectLead={mockOnSelectLead}
      />
    );

    const prSource = screen.getByRole('button', { name: /Add automated failover for job workers/i });
    fireEvent.click(prSource);

    expect(screen.getByText('Traceable Inspector')).toBeInTheDocument();
    expect(screen.getByText(/Selected Source: Add automated failover for job workers/i)).toBeInTheDocument();
    expect(screen.getByText(/This will save us a lot of 3 a.m. pages/i)).toBeInTheDocument();
  });

  it('filters by status and supports fit view toggle', () => {
    render(
      <StoryThreadsNodeMap
        sources={initialSources}
        evidence={initialNodeMapEvidence}
        threads={initialStoryThreads}
        onSelectLead={mockOnSelectLead}
      />
    );

    const fitViewBtn = screen.getByRole('button', { name: /Fit view/i });
    expect(fitViewBtn).toBeInTheDocument();
    fireEvent.click(fitViewBtn);

    // Verified filter button
    const verifiedFilterBtn = screen.getByRole('button', { name: /Verified/i });
    fireEvent.click(verifiedFilterBtn);
  });
});
