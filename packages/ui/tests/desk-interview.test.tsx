/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FocusedInterview } from '../src/views/desk/FocusedInterview';
import { initialLead } from '../src/data/deskFixtures';
import { apiClient } from '../src/api/client';

describe('Focused Interview & Live Dossier Tests', () => {
  const mockOnBackToBriefing = vi.fn();
  const mockOnViewThread = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders transcript with speaker names, timestamps, and vermilion margin annotation', () => {
    render(
      <FocusedInterview
        lead={initialLead}
        onBackToBriefing={mockOnBackToBriefing}
        onViewThread={mockOnViewThread}
      />
    );

    expect(screen.getByText('Focused interview')).toBeInTheDocument();
    expect(screen.getByText('What changed because of your work?')).toBeInTheDocument();
    expect(
      screen.getByText('We stopped waking someone for routine worker failures.')
    ).toBeInTheDocument();

    // Margin annotation
    expect(
      screen.getByText(/Strong start\. Consider adding how often this happened and a source\./i)
    ).toBeInTheDocument();

    // Follow-up question
    expect(
      screen.getByText('How often was that happening, and where could we verify it?')
    ).toBeInTheDocument();
  });

  it('renders live structured dossier on the right with Situation, Action, Outcome, Skills, and Sources', () => {
    render(
      <FocusedInterview
        lead={initialLead}
        onBackToBriefing={mockOnBackToBriefing}
        onViewThread={mockOnViewThread}
      />
    );

    expect(screen.getByText('Evidence draft')).toBeInTheDocument();
    expect(screen.getByText('Situation')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();

    // Missing proof highlight on [METRIC NEEDED]
    expect(screen.getByText(/\[METRIC NEEDED\]/i)).toBeInTheDocument();
  });

  it('allows user to reply with verified metric and updates live dossier', async () => {
    render(
      <FocusedInterview
        lead={initialLead}
        onBackToBriefing={mockOnBackToBriefing}
        onViewThread={mockOnViewThread}
      />
    );

    const input = screen.getByPlaceholderText(/Share more details, add numbers, or point to a source/i);
    fireEvent.change(input, {
      target: {
        value: 'Reduced alert pages by 80% across 140k daily worker tasks, verified in Datadog wa-au-018.',
      },
    });

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendBtn);

    // Transcript contains user's new reply
    await waitFor(() => {
      expect(
        screen.getByText(/Reduced alert pages by 80% across 140k daily worker tasks/i)
      ).toBeInTheDocument();
    });

    // The Editor acknowledges the verification
    expect(
      screen.getByText(/This gives us a solid, verifiable claim/i)
    ).toBeInTheDocument();

    // Live dossier outcome updates and metric needed is resolved
    expect(screen.queryByText(/\[METRIC NEEDED\]/i)).not.toBeInTheDocument();
  });

  it('captures evidence entry, invokes apiClient.saveEvidence, and displays thread strengthening feedback', async () => {
    const saveSpy = vi.spyOn(apiClient, 'saveEvidence').mockResolvedValue({
      success: true,
      entry: {
        id: 'ev-042',
        date: '2026-04-12',
        company: 'parable',
        title: 'Zero-Downtime Session Migration',
        summary: 'Architected failover protocols.',
        impact: 'Reduced alerts by 80%.',
        confidence: 'verified',
        in_flight: false,
        themes: ['reliability'],
        metrics: [{ name: 'alert reduction', value: '80%', status: 'verified' }],
        internal_references: [],
      },
    });

    render(
      <FocusedInterview
        lead={initialLead}
        onBackToBriefing={mockOnBackToBriefing}
        onViewThread={mockOnViewThread}
      />
    );

    const captureBtn = screen.getByRole('button', { name: /Capture evidence entry/i });
    fireEvent.click(captureBtn);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    // Completion feedback banner appears
    expect(
      screen.getByText(/Evidence entry captured/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Story thread 'Reliability leadership' strengthened/i)
    ).toBeInTheDocument();
  });
});
