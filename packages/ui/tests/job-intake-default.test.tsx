/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { JobIntake } from '../src/views/jobs/JobIntake.js';
import { apiClient } from '../src/api/client.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
it('shows a refused request as link-only, with the HTTP status instead of ready', async () => {
  vi.spyOn(apiClient, 'previewJobs').mockResolvedValue({ preview_id: 'preview', preview: { workspace_id: 'workspace', items: [{ index: 0, original: 'https://example.com/role', valid: true, job: null, error: { code: 'http_error', status: 403, message: 'The site refused browser capture (HTTP 403). Paste posting text instead.' }, fallback_available: true, duplicate_id: null, candidates: [], capture_attempts: [{ method: 'http', outcome: 'failed', status: 403 }, { method: 'browser', outcome: 'failed', status: 403 }] }] } });
  render(<JobIntake onSaved={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Job URLs' }), { target: { value: 'https://example.com/role' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByText('Link only — posting needed')).toBeInTheDocument();
  expect(screen.queryByText('Ready to add')).not.toBeInTheDocument();
  expect(screen.getByText(/site refused browser capture \(HTTP 403\)/)).toBeInTheDocument();
  expect(screen.getByText('Direct request: HTTP 403')).toBeInTheDocument();
  expect(screen.getByText('Browser capture: HTTP 403')).toBeInTheDocument();
});
it('shows a successful browser recovery and retains the direct diagnostic', async () => {
  vi.spyOn(apiClient, 'previewJobs').mockResolvedValue({ preview_id: 'preview', preview: { workspace_id: 'workspace', items: [{ index: 0, original: 'https://example.com/role', valid: true, job: null, error: null, fallback_available: false, duplicate_id: null, candidates: [], capture_method: 'browser', capture_attempts: [{ method: 'http', outcome: 'failed', status: 403 }, { method: 'browser', outcome: 'captured' }] }] } });
  render(<JobIntake onSaved={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Job URLs' }), { target: { value: 'https://example.com/role' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByText('Ready to add')).toBeInTheDocument();
  expect(screen.getByText(/Captured with browser.*HTTP 403/)).toBeInTheDocument();
});

