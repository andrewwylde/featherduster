/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';

describe('static application routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: 'C:/workspace' });
    vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({ isClean: true, issues: [] });
    vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['/briefing', 'Briefing'],
    ['/threads', 'Threads'],
    ['/evidence', 'Evidence'],
    ['/skills', 'Skills'],
    ['/exports', 'Exports'],
  ])('renders %s directly', async (path, navLabel) => {
    window.history.replaceState({}, '', path);
    render(<App />);
    expect(await screen.findByRole('link', { name: navLabel })).toHaveAttribute('aria-current', 'page');
  });

  it('updates the URL on navigation and restores the view on browser navigation', async () => {
    window.history.replaceState({}, '', '/briefing');
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /Skills/i }));
    expect(window.location.pathname).toBe('/skills');
    expect(await screen.findByText(/Competency Gap Matrix/i)).toBeInTheDocument();

    window.history.pushState({}, '', '/exports');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(window.location.pathname).toBe('/exports'));
    expect(await screen.findByText(/Resume Tailoring Canvas/i)).toBeInTheDocument();
  });
});
