/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';

describe('End-to-End User Workflows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('dark');

    // Default mocks for all API calls
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

  describe('Briefing Workspace Flow', () => {
    it('renders the app with navigation links', () => {
      render(<App />);

      // App should render with nav links
      expect(screen.getByRole('link', { name: /Briefing/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Tailor/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Threads/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Evidence/i })).toBeInTheDocument();
    });

    it('allows users to navigate between briefing and tailor views', async () => {
      render(<App />);

      // Navigate to tailor
      const tailorLink = screen.getByRole('link', { name: /Tailor/i });
      fireEvent.click(tailorLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/tailor');
      });

      // Navigate back to briefing
      const briefingLink = screen.getByRole('link', { name: /Briefing/i });
      fireEvent.click(briefingLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/briefing');
      });
    });

    it('allows users to navigate to threads view', async () => {
      render(<App />);

      // Navigate to threads
      const threadsLink = screen.getByRole('link', { name: /Threads/i });
      fireEvent.click(threadsLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/threads');
      });
    });
  });

  describe('Tailoring Workspace Flow', () => {
    it('navigates to tailor workspace', async () => {
      render(<App />);

      // Navigate to tailor
      const tailorTab = screen.getByRole('link', { name: /Tailor/i });
      fireEvent.click(tailorTab);

      // Should navigate to tailor path
      await waitFor(() => {
        expect(window.location.pathname).toBe('/tailor');
      });
    });

    it('allows users to navigate back from tailor', async () => {
      render(<App />);

      // Navigate to tailor
      const tailorTab = screen.getByRole('link', { name: /Tailor/i });
      fireEvent.click(tailorTab);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/tailor');
      });

      // Navigate back to briefing
      const briefingLink = screen.getByRole('link', { name: /Briefing/i });
      fireEvent.click(briefingLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/briefing');
      });
    });
  });

  describe('Evidence Explorer Flow', () => {
    it('allows users to navigate to evidence explorer', async () => {
      render(<App />);

      // Navigate to evidence explorer
      const evidenceLink = screen.getByRole('link', { name: /Evidence/i });
      fireEvent.click(evidenceLink);

      // Should navigate to evidence path
      await waitFor(() => {
        expect(window.location.pathname).toBe('/evidence');
      });
    });

    it('allows users to navigate between briefing and evidence', async () => {
      render(<App />);

      // Navigate to evidence
      const evidenceLink = screen.getByRole('link', { name: /Evidence/i });
      fireEvent.click(evidenceLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/evidence');
      });

      // Navigate back to briefing
      const briefingLink = screen.getByRole('link', { name: /Briefing/i });
      fireEvent.click(briefingLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/briefing');
      });
    });
  });

  describe('Navigation and Layout Flow', () => {
    it('navigates between briefing and threads views', async () => {
      render(<App />);

      // Navigate to threads
      fireEvent.click(screen.getByRole('link', { name: /Threads/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/threads');
      });

      // Navigate back to briefing
      fireEvent.click(screen.getByRole('link', { name: /Briefing/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/briefing');
      });
    });

    it('navigates between briefing and evidence views', async () => {
      render(<App />);

      // Navigate to evidence
      fireEvent.click(screen.getByRole('link', { name: /Evidence/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/evidence');
      });

      // Navigate back to briefing
      fireEvent.click(screen.getByRole('link', { name: /Briefing/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/briefing');
      });
    });

    it('allows sequential navigation through multiple tabs', async () => {
      render(<App />);

      // Tailor -> Threads
      fireEvent.click(screen.getByRole('link', { name: /Tailor/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/tailor');
      });

      fireEvent.click(screen.getByRole('link', { name: /Threads/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/threads');
      });

      // Threads -> Evidence
      fireEvent.click(screen.getByRole('link', { name: /Evidence/i }));
      await waitFor(() => {
        expect(window.location.pathname).toBe('/evidence');
      });
    });
  });;

  describe('Theme and UI Behavior', () => {
    it('provides theme toggle button in UI', () => {
      render(<App />);

      const themeToggle = screen.getByRole('button', { name: /Toggle theme/i });
      expect(themeToggle).toBeInTheDocument();
    });

    it('maintains navigation structure across renders', () => {
      render(<App />);

      const links = [
        screen.getByRole('link', { name: /Briefing/i }),
        screen.getByRole('link', { name: /Tailor/i }),
        screen.getByRole('link', { name: /Threads/i }),
        screen.getByRole('link', { name: /Evidence/i }),
      ];

      links.forEach((link) => {
        expect(link).toBeInTheDocument();
      });
    });
  });;

  describe('Rapid Navigation Flow', () => {
    it('supports rapid navigation between views', async () => {
      render(<App />);

      const navigationTests = [
        { name: /Tailor/i, path: '/tailor' },
        { name: /Threads/i, path: '/threads' },
        { name: /Evidence/i, path: '/evidence' },
        { name: /Briefing/i, path: '/briefing' },
      ];

      for (const test of navigationTests) {
        const link = screen.getByRole('link', { name: test.name });
        fireEvent.click(link);

        await waitFor(() => {
          expect(window.location.pathname).toBe(test.path);
        });
      }
    });
  });
});
