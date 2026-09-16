/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';

function ThemeTester() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-val">{theme}</span>
      <span data-testid="resolved-val">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('light')}>Set Light</button>
    </div>
  );
}

describe('Desk Theme System', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    cleanup();
  });

  it('provides default light or dark theme and toggles dark class on document element', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeTester />
      </ThemeProvider>
    );

    expect(screen.getByTestId('resolved-val').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByText('Set Dark'));
    expect(screen.getByTestId('resolved-val').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('featherduster-theme')).toBe('dark');

    fireEvent.click(screen.getByText('Set Light'));
    expect(screen.getByTestId('resolved-val').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
