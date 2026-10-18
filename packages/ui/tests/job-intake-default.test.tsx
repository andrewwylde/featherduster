/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { JobIntake } from '../src/views/jobs/JobIntake.js';
afterEach(cleanup);
it('opens normal intake in URLs and still lets the user choose Text', () => {
  render(<JobIntake onSaved={() => {}} />);
  expect(screen.getByRole('button', { name: 'URLs', pressed: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Posting text' }));
  expect(screen.getByRole('button', { name: 'Posting text', pressed: true })).toBeInTheDocument();
});
it('opens failed-capture recovery in Text', () => {
  render(<JobIntake fallback={{ id: 'job', revision: 1 }} onSaved={() => {}} />);
  expect(screen.getByRole('textbox', { name: 'Posting text' })).toBeInTheDocument();
});

