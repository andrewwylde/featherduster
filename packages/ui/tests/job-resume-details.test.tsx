/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { JobResumeDetails } from '../src/views/jobs/JobResumeDetails.js';
afterEach(cleanup);
it('opens one secondary view and returns focus to Details', () => {
  render(<JobResumeDetails preview={<p>Resume preview</p>} renderView={name => <p>{name} content</p>} />);
  expect(screen.queryByText('checks content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Checks' }));
  expect(screen.getByRole('heading', { name: 'Checks' })).toHaveFocus();
  expect(screen.queryByText('Resume preview')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
});
it('dismisses the menu with Escape and supports arrow keys', () => {
  render(<JobResumeDetails preview={<p>Preview</p>} renderView={() => null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByRole('menuitem', { name: 'Checks' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Corrections' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
});

