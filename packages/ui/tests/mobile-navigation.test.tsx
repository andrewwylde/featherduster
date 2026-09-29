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

describe('Mobile Navigation and Responsive Shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders mobile bottom navigation bar with primary tabs and more button', () => {
    render(<TestShell />);

    const mobileNav = screen.getByRole('navigation', { name: /Mobile Navigation/i });
    expect(mobileNav).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Mobile Briefing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mobile Tailor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mobile Threads/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mobile Evidence/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mobile Skills/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mobile More/i })).toBeInTheDocument();
  });

  it('switches tabs when mobile bottom nav buttons are clicked', () => {
    render(<TestShell />);

    const tailorBtn = screen.getByRole('button', { name: /Mobile Tailor/i });
    fireEvent.click(tailorBtn);

    expect(screen.getByTestId('active-content')).toHaveTextContent('Content for tailor');
  });

  it('opens and closes the MobileMoreDrawer when More button is clicked', () => {
    render(<TestShell />);

    const moreBtn = screen.getByRole('button', { name: /Mobile More/i });
    fireEvent.click(moreBtn);

    // Drawer opens
    expect(screen.getByRole('dialog', { name: /Quick Navigation & Utilities/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();

    // Clicking Settings navigates to settings tab and closes drawer
    const settingsBtn = screen.getByRole('button', { name: /Settings/i });
    fireEvent.click(settingsBtn);

    expect(screen.getByTestId('active-content')).toHaveTextContent('Content for settings');
    expect(screen.queryByRole('dialog', { name: /Quick Navigation & Utilities/i })).not.toBeInTheDocument();
  });

  it('renders mobile integrity indicator and allows toggling search bar in header', () => {
    render(<TestShell />);

    // Mobile search toggle button exists in header
    const searchToggle = screen.getByRole('button', { name: /Toggle search bar/i });
    expect(searchToggle).toBeInTheDocument();

    // Clicking search toggle displays the expanded mobile search input
    fireEvent.click(searchToggle);
    const searchInputs = screen.getAllByPlaceholderText(/Search across your work/i);
    expect(searchInputs.length).toBeGreaterThan(0);
  });
});
