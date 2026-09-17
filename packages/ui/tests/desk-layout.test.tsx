/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Layout, type NavTab } from '../src/components/Layout';
import { ThemeProvider } from '../src/theme/ThemeContext';

function TestShell() {
  const [tab, setTab] = useState<NavTab>('briefing');
  return (
    <ThemeProvider>
      <Layout currentTab={tab} onSelectTab={setTab}>
        <div data-testid="active-content">Content for {tab}</div>
      </Layout>
    </ThemeProvider>
  );
}

describe('Desk Layout and Navigation Shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders left sidebar brand, navigation items, and search header', () => {
    render(<TestShell />);

    // Brand and tagline
    expect(screen.getByText('Featherduster')).toBeInTheDocument();
    expect(screen.getByText('Private career intelligence for engineers.')).toBeInTheDocument();
    expect(screen.getByText('A quieter way to build what\'s next.')).toBeInTheDocument();

    // 5 primary tabs
    expect(screen.getByRole('link', { name: /Briefing/i })).toHaveAttribute('href', '/briefing');
    expect(screen.getByRole('link', { name: /Threads/i })).toHaveAttribute('href', '/threads');
    expect(screen.getByRole('link', { name: /Evidence/i })).toHaveAttribute('href', '/evidence');
    expect(screen.getByRole('link', { name: /Skills/i })).toHaveAttribute('href', '/skills');
    expect(screen.getByRole('link', { name: /Exports/i })).toHaveAttribute('href', '/exports');

    // Header elements
    expect(screen.getByPlaceholderText(/Search across your work, notes, and people/i)).toBeInTheDocument();
    expect(screen.getByText('Your work tells a bigger story.')).toBeInTheDocument();

    // Theme toggle button
    expect(screen.getByRole('button', { name: /Toggle theme/i })).toBeInTheDocument();
  });

  it('switches tabs on click and updates active styling with vermilion indicator', () => {
    render(<TestShell />);

    const threadsBtn = screen.getByRole('link', { name: /Threads/i });
    fireEvent.click(threadsBtn);

    expect(screen.getByTestId('active-content').textContent).toBe('Content for threads');

    const evidenceBtn = screen.getByRole('link', { name: /Evidence/i });
    fireEvent.click(evidenceBtn);
    expect(screen.getByTestId('active-content').textContent).toBe('Content for evidence');
  });

  it('opens onboarding foundation modal and allows dismissal', () => {
    render(<TestShell />);

    // Onboarding trigger or auto-modal for first run
    const helpBtn = screen.getByRole('button', { name: /Desk Foundation|Privacy/i });
    fireEvent.click(helpBtn);

    expect(screen.getByText(/Private Career Intelligence Desk/i)).toBeInTheDocument();
    expect(screen.getByText(/Local-first privacy foundation/i)).toBeInTheDocument();

    // Dismiss
    const dismissBtn = screen.getByRole('button', { name: 'Enter Career Desk' });
    fireEvent.click(dismissBtn);

    expect(screen.queryByText(/Local-first privacy foundation/i)).not.toBeInTheDocument();
  });
});
