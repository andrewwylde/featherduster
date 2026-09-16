/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';

describe('Career Intelligence Desk — Vertical Slice Integration Loop', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    // Default mocks for API client
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      workspaceDir: '/home/dev/career-corpus',
    });
    vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({
      isClean: true,
      issues: [],
    });
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('executes full core loop: Briefing -> Start Interview -> Clarify with The Editor -> Capture Entry -> Strengthen Story Thread', async () => {
    const saveSpy = vi.spyOn(apiClient, 'saveEvidence').mockResolvedValue({
      success: true,
      entry: {
        id: 'ev-042',
        date: '2026-04-12',
        company: 'parable',
        title: 'Automated Failover',
        summary: 'Added automated failover',
        impact: 'Reduced alerts by 80%',
        confidence: 'verified',
        in_flight: false,
        themes: ['reliability'],
        metrics: [{ name: 'alert reduction', value: '80%', status: 'verified' }],
        internal_references: [],
      },
    });

    render(<App />);

    // Step 1: User arrives at Private Briefing
    expect(screen.getByText('The Editor')).toBeInTheDocument();
    expect(screen.getByText('A reliability story may be taking shape.')).toBeInTheDocument();
    expect(screen.getByText('How the pieces connect')).toBeInTheDocument();
    expect(screen.getByText('Live dossier')).toBeInTheDocument();

    // Step 2: Open focused interview with The Editor
    const startInterviewBtn = screen.getByRole('button', { name: /Start focused interview/i });
    fireEvent.click(startInterviewBtn);

    expect(screen.getByText('Focused interview')).toBeInTheDocument();
    expect(screen.getByText('What changed because of your work?')).toBeInTheDocument();
    expect(screen.getByText(/\[METRIC NEEDED\]/i)).toBeInTheDocument();

    // Step 3: Clarify specific metrics and sources
    const textarea = screen.getByPlaceholderText(/Share more details, add numbers, or point to a source/i);
    fireEvent.change(textarea, {
      target: {
        value: 'Reduced alert pages by 80% across 140k daily worker tasks, verified in Datadog wa-au-018.',
      },
    });

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendBtn);

    // Verify transcript & dossier updated
    await waitFor(() => {
      expect(screen.getByText(/This gives us a solid, verifiable claim/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/\[METRIC NEEDED\]/i)).not.toBeInTheDocument();

    // Step 4: Capture evidence entry
    const captureBtn = screen.getByRole('button', { name: /Capture evidence entry/i });
    fireEvent.click(captureBtn);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/Evidence entry captured/i)).toBeInTheDocument();
    expect(screen.getByText(/Story thread 'Reliability leadership' strengthened/i)).toBeInTheDocument();

    // Step 5: Transition to story thread node map and verify strengthened thread
    const viewThreadBtn = screen.getByRole('button', { name: /View strengthened thread/i });
    fireEvent.click(viewThreadBtn);

    expect(screen.getByText('Story Threads & Node Map')).toBeInTheDocument();
    expect(screen.getByText('strengthened')).toBeInTheDocument();
    expect(screen.getByText('Automated failover & alert reduction')).toBeInTheDocument();
  });

  it('supports light and dark theme switching in the full desk shell', () => {
    render(<App />);

    const themeToggleBtn = screen.getByRole('button', { name: /Toggle theme/i });
    expect(themeToggleBtn).toBeInTheDocument();

    // Toggle theme
    const initialIsDark = document.documentElement.classList.contains('dark');
    fireEvent.click(themeToggleBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(!initialIsDark);

    fireEvent.click(themeToggleBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(initialIsDark);
  });
});
