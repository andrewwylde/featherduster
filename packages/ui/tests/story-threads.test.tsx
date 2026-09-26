/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StoryThreadsNodeMap } from '../src/views/desk/StoryThreadsNodeMap';
import { buildDeskModel } from '../src/data/deskModel';
import { makeRecord } from './fixtures/deskRecords';
import type { EvidenceRecord } from '@featherduster/core';

const richRecords: EvidenceRecord[] = [
  makeRecord({
    id: 'ev-101',
    date: '2026-02-01',
    title: 'Distributed Rate Limiter',
    summary: 'High traffic spikes were causing cascade outages across upstream auth gateways.',
    themes: ['distributed-systems', 'reliability'],
    confidence: 'verified',
    internal_references: [{ type: 'pr', ref: '#204' }, { type: 'slack', ref: '#incidents' }],
    metrics: [{ name: 'Spike drop rate', value: 'Reduced by 99.4%', status: 'verified' }],
    impact: 'Engineered token-bucket Redis cluster reducing service outages by 99.4% during peak sales.',
  }),
  makeRecord({
    id: 'ev-102',
    date: '2026-03-15',
    title: 'Zero-Downtime DB Sharding',
    summary: 'Monolithic PostgreSQL reached 95% disk IOPS saturation during month-end closes.',
    themes: ['database', 'architecture'],
    confidence: 'verified',
    internal_references: [{ type: 'jira', ref: 'DB-890' }],
    metrics: [{ name: 'Query latency p99', value: '< 15ms', status: 'verified' }],
    impact: 'Architected dynamic logical sharding cut p99 latencies below 15ms at 4x write volume.',
  }),
];

describe('Story Threads & Impact DAG Visualization (Task #13)', () => {
  const mockOnSelectLead = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithRecords = (records: EvidenceRecord[] = richRecords) => {
    const model = buildDeskModel(records);
    return render(
      <StoryThreadsNodeMap
        sources={model.sources}
        evidence={model.evidence}
        threads={model.threads}
        onSelectLead={mockOnSelectLead}
      />
    );
  };

  it('renders View Mode toggle buttons for Columns View and Impact DAG', () => {
    renderWithRecords();
    const columnsTab = screen.getByRole('tab', { name: /Columns View/i });
    const dagTab = screen.getByRole('tab', { name: /Impact DAG/i });
    expect(columnsTab).toBeInTheDocument();
    expect(dagTab).toBeInTheDocument();
    expect(columnsTab).toHaveAttribute('aria-selected', 'true');
    expect(dagTab).toHaveAttribute('aria-selected', 'false');
  });

  it('switches to Impact DAG view and displays 3 causal lanes with skill clusters', () => {
    renderWithRecords();
    const dagTab = screen.getByRole('tab', { name: /Impact DAG/i });
    fireEvent.click(dagTab);

    expect(dagTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('impact-dag-container')).toBeInTheDocument();

    // Verify Skill Clusters & Leveling Badges
    expect(screen.getByText('Skill Clusters:')).toBeInTheDocument();
    expect(screen.getByText('Leveling Breadth:')).toBeInTheDocument();
    expect(screen.getByText('L5/L6 Architecture & Scope')).toBeInTheDocument();
    expect(screen.getByText('distributed-systems')).toBeInTheDocument();
    expect(screen.getByText('reliability')).toBeInTheDocument();

    // Verify 3 Causal Lanes
    expect(screen.getByText('1. Technical Challenges')).toBeInTheDocument();
    expect(screen.getByText('2. Architectural Interventions')).toBeInTheDocument();
    expect(screen.getByText('3. Measurable Outcomes')).toBeInTheDocument();
  });

  it('displays challenge, intervention, and metric node cards in the DAG lanes', () => {
    renderWithRecords();
    fireEvent.click(screen.getByRole('tab', { name: /Impact DAG/i }));

    // Challenge nodes
    expect(screen.getByText('High traffic spikes were causing cascade outages across upstream auth gateways.')).toBeInTheDocument();
    // Intervention nodes
    expect(screen.getByText('Engineered token-bucket Redis cluster reducing service outages by 99.4% during peak sales.')).toBeInTheDocument();
    // Outcome nodes
    expect(screen.getByText('Spike drop rate: Reduced by 99.4%')).toBeInTheDocument();
  });

  it('selects an evidence node when clicked in DAG mode and updates the Causal Proof Chain in Inspector', () => {
    renderWithRecords();
    fireEvent.click(screen.getByRole('tab', { name: /Impact DAG/i }));

    const challengeButton = screen.getByRole('button', { name: /Challenge node for Distributed Rate Limiter/i });
    fireEvent.click(challengeButton);

    expect(screen.getByText('Traceable Inspector')).toBeInTheDocument();
    expect(screen.getByText('Selected Evidence')).toBeInTheDocument();
    expect(screen.getByText('Causal Proof Chain:')).toBeInTheDocument();
    expect(screen.getByText('Challenge:')).toBeInTheDocument();
    expect(screen.getByText('Architecture:')).toBeInTheDocument();
    expect(screen.getByText('Quantified Outcome:')).toBeInTheDocument();
    expect(screen.getAllByText(/Spike drop rate: Reduced by 99.4%/i).length).toBeGreaterThanOrEqual(1);

    const strengthenBtn = screen.getByRole('button', { name: /Strengthen in Interview/i });
    expect(strengthenBtn).toBeInTheDocument();
    fireEvent.click(strengthenBtn);
    expect(mockOnSelectLead).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard navigation on DAG nodes', () => {
    renderWithRecords();
    fireEvent.click(screen.getByRole('tab', { name: /Impact DAG/i }));

    const interventionButton = screen.getByRole('button', { name: /Intervention node for Zero-Downtime DB Sharding/i });
    fireEvent.keyDown(interventionButton, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Traceable Inspector')).toBeInTheDocument();
    expect(screen.getAllByText('Zero-Downtime DB Sharding').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Connected Source IDs:')).toBeInTheDocument();
    expect(screen.getByText('• src-jira-db-890')).toBeInTheDocument();
  });

  it('gracefully switches back to Columns View', () => {
    renderWithRecords();
    const dagTab = screen.getByRole('tab', { name: /Impact DAG/i });
    const columnsTab = screen.getByRole('tab', { name: /Columns View/i });

    fireEvent.click(dagTab);
    expect(screen.getByTestId('impact-dag-container')).toBeInTheDocument();

    fireEvent.click(columnsTab);
    expect(screen.queryByTestId('impact-dag-container')).not.toBeInTheDocument();
    expect(screen.getByText('1. Sources')).toBeInTheDocument();
    expect(screen.getByText('2. Evidence')).toBeInTheDocument();
    expect(screen.getByText('3. Story Threads')).toBeInTheDocument();
  });
});
