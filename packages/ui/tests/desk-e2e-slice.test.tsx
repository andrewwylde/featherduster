/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';
import { testRecords } from './fixtures/deskRecords';

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
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getTailoringCitations').mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('briefing → strengthen an entry → save through PUT → threads, all from ledger data', async () => {
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(testRecords);
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getTailoringCitations').mockResolvedValue({});
    const update = vi.spyOn(apiClient, 'updateEvidence').mockResolvedValue({ success: true, entry: testRecords[2].entry, filePath: 'evidence/acme/ev-003.md' });
    const create = vi.spyOn(apiClient, 'saveEvidence');

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your strongest thread: Platform' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Strengthen Latency work' }));
    expect(await screen.findByRole('heading', { name: /Strengthen evidence: Latency work/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save to ledger file' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('ev-003', expect.anything(), expect.any(String)));
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Back to briefing/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Threads' }));
    expect(await screen.findByText('Story Threads & Node Map')).toBeInTheDocument();
    expect(screen.getAllByText('Platform').length).toBeGreaterThan(0);
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
