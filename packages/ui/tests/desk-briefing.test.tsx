/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PrivateBriefing } from '../src/views/desk/PrivateBriefing';
import { initialLead } from '../src/data/deskFixtures';

describe('Private Briefing View', () => {
  const mockOnOpenInterview = vi.fn();
  const mockOnViewThread = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders The Editor recommendation, headline, and signal source cards', () => {
    render(
      <PrivateBriefing
        lead={initialLead}
        onOpenInterview={mockOnOpenInterview}
        onViewThread={mockOnViewThread}
      />
    );

    expect(screen.getByRole('note', { name: /Sample data/i })).toBeInTheDocument();

    // The Editor role and lead headline
    expect(screen.getByText('The Editor')).toBeInTheDocument();
    expect(screen.getByText('A reliability story may be taking shape.')).toBeInTheDocument();
    expect(
      screen.getByText(/You've shipped infrastructure improvements, documented operational learnings/i)
    ).toBeInTheDocument();

    // 3 source cards
    expect(screen.getByText('Add automated failover for job workers')).toBeInTheDocument();
    expect(screen.getByText('Post-incident improvements')).toBeInTheDocument();
    expect(screen.getByText('Leadership during the outage')).toBeInTheDocument();

    // Editorial quotes with attribution
    expect(
      screen.getByText(/This will save us a lot of 3 a.m. pages/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Strong analysis and practical next steps/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You brought clarity when things were chaotic/i)
    ).toBeInTheDocument();
  });

  it('renders "How the pieces connect" node map preview and "Live dossier" summary', () => {
    render(
      <PrivateBriefing
        lead={initialLead}
        onOpenInterview={mockOnOpenInterview}
        onViewThread={mockOnViewThread}
      />
    );

    expect(screen.getByText('How the pieces connect')).toBeInTheDocument();
    expect(screen.getByText(/Sources roll up into evidence, which build your career story/i)).toBeInTheDocument();
    expect(screen.getByText('Fit view')).toBeInTheDocument();

    // Node items in graph
    expect(screen.getByText('Improved system resilience')).toBeInTheDocument();
    expect(screen.getByText('Operational ownership')).toBeInTheDocument();
    expect(screen.getByText('Trusted by teammates')).toBeInTheDocument();
    expect(screen.getAllByText('Reliability leadership').length).toBeGreaterThanOrEqual(1);

    // Live dossier section
    expect(screen.getByText('Live dossier')).toBeInTheDocument();
    expect(screen.getByText('Claim')).toBeInTheDocument();
    expect(screen.getByText(/You demonstrate reliability leadership/i)).toBeInTheDocument();
    expect(screen.getByText('Still needed')).toBeInTheDocument();
    expect(screen.getByText(/Quantitative outcomes/i)).toBeInTheDocument();
  });

});
