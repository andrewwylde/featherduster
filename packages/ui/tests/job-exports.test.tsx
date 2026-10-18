/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JobExports } from '../src/views/jobs/JobExports.js';
import { apiClient } from '../src/api/client.js';
const job = { id: 'job', workspace_id: 'workspace', revision: 1 } as any;
const artifact = { id: 'artifact', version_fingerprint: 'fingerprint' } as any;
const files = ['resume.pdf', 'resume.md', 'resume.txt', 'resume.html', 'resume.typ', 'resume.tex', 'confidential-dossier.md', 'confidential-dossier.html'].map(name => ({ name, type: name.endsWith('.html') ? 'text/html' : name.endsWith('.pdf') ? 'application/pdf' : 'text/plain', confidential: name.startsWith('confidential') }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
function setup(blocked: boolean | string = false) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return response({ release: { id: 'saved' } });
    if (url.includes('/check?')) return response({ files });
    return response({ releases: [{ id: 'saved', created_at: '2026-01-01', files: files.slice(0, 1) }] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<JobExports job={job} artifact={artifact} blocked={blocked} />);
  return fetcher;
}
function open() { const details = screen.getByText('Export and saved releases').closest('details')!; details.open = true; fireEvent(details, new Event('toggle')); }
it('is compact and inert until opened; offers all checked resume formats without generic rendering', async () => {
  const fetcher = setup(); expect(fetcher).not.toHaveBeenCalled();
  open(); await screen.findByRole('button', { name: 'Download resume.pdf' });
  expect(screen.getByRole('button', { name: 'Download resume.tex' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Open resume.pdf to print' })).toHaveAttribute('href', expect.stringContaining('artifact_fingerprint'));
  expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/jobs/job/exports'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save release bundle' }));
  await screen.findByText(/Saved actual files/);
  expect(fetcher).toHaveBeenCalledWith('/api/jobs/job/exports', expect.objectContaining({ method: 'POST', body: expect.stringContaining('artifact_fingerprint') }));
});
it('keeps saved release access while pending/historical publication is blocked with a next action', async () => {
  setup(true); open(); await screen.findByText(/Return to the current checked resume/);
  expect(screen.getByRole('button', { name: 'Save release bundle' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'resume.pdf' })).toHaveAttribute('href', '/api/jobs/job/exports/saved/resume.pdf?download=1');
});
it('names the actual reason when current exports are blocked', async () => {
  setup('The job details changed after this resume was prepared. Prepare it again with the current details; saved releases remain below.'); open();
  expect(await screen.findByRole('alert')).toHaveTextContent('The job details changed after this resume was prepared.');
  expect(screen.queryByText(/historical or pending/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Download / })).not.toBeInTheDocument();
});
it('discloses the confidential dossier separately and refuses unsaved material drafts', async () => {
  setup(); open(); await screen.findByRole('button', { name: 'Download resume.pdf' });
  fireEvent.change(screen.getByLabelText('Export material'), { target: { value: 'dossier' } });
  await screen.findByRole('button', { name: 'Download confidential-dossier.md' });
  expect(screen.getByRole('note')).toHaveTextContent('Do not send it');
  expect(screen.queryByRole('button', { name: 'Download resume.pdf' })).not.toBeInTheDocument();
  localStorage.setItem('job-material:workspace:job:cover_letter', 'draft');
  const material = vi.spyOn(apiClient, 'getJobMaterial');
  fireEvent.change(screen.getByLabelText('Export material'), { target: { value: 'cover_letter' } });
  await screen.findByText(/unsaved draft/); expect(material).not.toHaveBeenCalled();
});
it('reports clipboard denial rather than acknowledging a false copy', async () => {
  const fetcher = setup(); open(); await screen.findByRole('button', { name: 'Copy plain text' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard denied')) } });
  fetcher.mockResolvedValueOnce({ ok: true, text: async () => 'Persisted wording' } as any);
  fireEvent.click(screen.getByRole('button', { name: 'Copy plain text' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Clipboard access is blocked by your browser. Download the .txt file instead.');
  expect(screen.queryByText('Copied saved text')).not.toBeInTheDocument();
});
it('shows a server stale-input reason and retains the shelf after download failure', async () => {
  const fetcher = setup(); open(); await screen.findByRole('button', { name: 'Download resume.md' });
  fetcher.mockResolvedValueOnce(response({ error: 'Privacy changed. Check a new resume.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Download resume.md' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Privacy changed'));
  expect(screen.getByRole('link', { name: 'resume.pdf' })).toBeInTheDocument();
});
