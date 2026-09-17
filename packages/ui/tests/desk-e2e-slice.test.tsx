/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

  it('labels fixture-backed views as sample data and offers no evidence capture', async () => {
    const saveSpy = vi.spyOn(apiClient, 'saveEvidence');
    render(<App />);

    expect(await screen.findByRole('note', { name: /Sample data/i })).toHaveTextContent(/not your ledger/i);
    expect(screen.queryByRole('button', { name: /Start focused interview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Capture evidence entry/i })).not.toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Threads' }));
    expect(await screen.findByRole('note', { name: /Sample data/i })).toBeInTheDocument();
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
