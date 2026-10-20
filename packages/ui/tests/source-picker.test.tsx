/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SourcePicker } from '../src/components/SourcePicker.js';

it('finds sources with fuzzy typing and selects only on confirmation', () => {
  const select = vi.fn();
  render(<SourcePicker label="Captured source" value="a" onSelect={select} options={[
    { id: 'a', name: 'Production deployment', type: 'narrative' },
    { id: 'b', name: 'Backend services', type: 'summary' },
  ]} />);
  const input = screen.getByRole('combobox', { name: 'Captured source' });
  expect(input).toHaveValue('Production deployment · narrative');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'bknd svc' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith('b');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  cleanup();
});
