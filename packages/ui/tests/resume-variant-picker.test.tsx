/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { rankResumeVariants } from '../src/components/resume-variant-search.js';
import { ResumeVariantPicker } from '../src/components/ResumeVariantPicker.js';
const options = [
  { id: 'a', name: 'Senior Engineer', type: 'tailored' },
  { id: 'b', name: 'Engineer', type: 'template' },
  { id: 'c', name: 'Principal Engineer', type: 'tailored' },
];
afterEach(cleanup);
it('ranks exact before substring and supports ordered-character search', () => {
  expect(rankResumeVariants(options, ' engineer ').map(x => x.id)).toEqual(['b', 'a', 'c']);
  expect(rankResumeVariants(options, 'snr eng').map(x => x.id)).toEqual(['a']);
  expect(rankResumeVariants(options, 'TEMPLATE').map(x => x.id)).toEqual(['b']);
  expect(rankResumeVariants(options, '')).toEqual(options);
});
it('filters without selection and commits only on Enter', () => {
  const select = vi.fn();
  render(<ResumeVariantPicker options={options} value="b" onSelect={select} />);
  const input = screen.getByRole('combobox', { name: 'Select resume variant' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'snr eng' } });
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith('a');
});
it('retains a missing selected source and supports escape/no-results', () => {
  render(<ResumeVariantPicker options={options} value="saved-id" onSelect={() => {}} />);
  const input = screen.getByRole('combobox');
  expect(input).toHaveValue('saved-id (saved source)');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'zzzz' } });
  expect(screen.getByText('No matching resumes')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue('saved-id (saved source)');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('filters by directory path, file extension, and displays metadata', () => {
  const richOptions = [
    {
      id: 'tailored/main:yaml',
      name: 'Main Resume',
      type: 'tailored',
      filePath: 'resumes/tailored/main.yaml',
      extension: 'yaml',
      modifiedAt: '2026-11-01T12:00:00.000Z',
    },
    {
      id: 'tailored/main:tex',
      name: 'Main Resume LaTeX',
      type: 'tailored',
      filePath: 'resumes/tailored/main.tex',
      extension: 'tex',
      modifiedAt: '2026-11-02T12:00:00.000Z',
    },
    {
      id: 'archive/old:yaml',
      name: 'Archived Role',
      type: 'template',
      filePath: 'resumes/archive/old.yaml',
      extension: 'yaml',
      modifiedAt: '2025-01-01T12:00:00.000Z',
    },
  ];

  // Directory search
  expect(rankResumeVariants(richOptions, 'archive').map(x => x.id)).toEqual(['archive/old:yaml']);

  // Extension search
  expect(rankResumeVariants(richOptions, 'tex').map(x => x.id)).toEqual(['tailored/main:tex']);

  // Rendering displays path, extension, and date
  render(<ResumeVariantPicker options={richOptions} value="tailored/main:yaml" onSelect={() => {}} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);

  expect(screen.getByText('resumes/tailored/main.yaml')).toBeInTheDocument();
  expect(screen.getByText('resumes/tailored/main.tex')).toBeInTheDocument();
  expect(screen.getByText('(tailored · .yaml)')).toBeInTheDocument();
  expect(screen.getByText('(tailored · .tex)')).toBeInTheDocument();
});
