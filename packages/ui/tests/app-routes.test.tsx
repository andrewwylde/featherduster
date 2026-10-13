/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';

describe('static application routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: 'C:/workspace', workspaceId: 'workspace' });
    vi.spyOn(apiClient, 'listTailoringDrafts').mockResolvedValue({ workspaceId: 'workspace', records: [], recoveryErrors: [] });
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getRunners').mockResolvedValue({ runners: [], consent: {} });
    vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({ isClean: true, issues: [] });
    vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['/briefing', 'Briefing'],
    ['/threads', 'Threads'],
    ['/evidence', 'Evidence'],
    ['/skills', 'Skills'],
    ['/tailor', 'Tailor'],
    ['/jobs', 'Jobs'],
  ])('renders %s directly', async (path, navLabel) => {
    window.history.replaceState({}, '', path);
    render(<App />);
    expect(await screen.findByRole('link', { name: navLabel })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the canvas under the tailor tab', async () => {
    window.history.replaceState({}, '', '/tailor/canvas');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Tailor' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: /Resume Tailoring Canvas/i })).toBeInTheDocument();
  });

  it('redirects the legacy /exports route to the canvas', async () => {
    window.history.replaceState({}, '', '/exports');
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/tailor/canvas'));
    expect(await screen.findByRole('link', { name: 'Tailor' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: /Resume Tailoring Canvas/i })).toBeInTheDocument();
  });

  it('updates the URL on navigation and restores the view on browser navigation', async () => {
    window.history.replaceState({}, '', '/briefing');
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /Skills/i }));
    expect(window.location.pathname).toBe('/skills');
    expect(await screen.findByText(/Competency Gap Matrix/i)).toBeInTheDocument();

    window.history.pushState({}, '', '/tailor/canvas');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(window.location.pathname).toBe('/tailor/canvas'));
    expect(await screen.findByRole('heading', { name: /Resume Tailoring Canvas/i })).toBeInTheDocument();
  });
  it('keeps manual edits while a separate linked job canvas is opened and revisited', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const spec = { profile: { name: 'Alex', title: 'Engineer', email: 'a@example.com' }, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Original bullet', citations: [] }] }], education: [], skills: [] };
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([{ id: 'base', name: 'Base', type: 'template', filePath: 'base.yaml', spec }]);
    vi.spyOn(apiClient, 'getJobDraft').mockResolvedValue({ draft: { schema_version: 1, id, workspace_id: 'w', job_id: id, revision: 0, input_snapshot_id: id, parent_artifact_version_id: id, candidate: spec, proposals: { proposals: [] }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } });
    window.history.replaceState({}, '', '/tailor/canvas');
    render(<App />);
    const manual = await screen.findByDisplayValue('Original bullet');
    fireEvent.change(manual, { target: { value: 'Unsaved manual bullet' } });
    window.history.pushState({}, '', `/tailor/canvas/jobs/${id}/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await screen.findByRole('button', { name: 'Save job draft' });
    const linked = await screen.findByDisplayValue('Original bullet');
    fireEvent.change(linked, { target: { value: 'Unsaved linked bullet' } });
    window.history.pushState({}, '', '/tailor/canvas');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(manual).toHaveValue('Unsaved manual bullet'));
    expect(manual).toBeVisible();
    window.history.pushState({}, '', `/tailor/canvas/jobs/${id}/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(linked).toBeVisible());
    expect(linked).toHaveValue('Unsaved linked bullet');
    expect(apiClient.getJobDraft).toHaveBeenCalledTimes(1);
  });

});

import { tailorViewForPath } from '../src/routing';
describe('resumable tailoring routes', () => {
  it('parses draft identity and run query context', () => {
    expect(tailorViewForPath('/tailor/drafts/11111111-1111-4111-8111-111111111111')).toEqual({ mode: 'draft', draftId: '11111111-1111-4111-8111-111111111111' });
    expect(tailorViewForPath('/tailor/acme?step=alignment')).toEqual({ mode: 'run', slug: 'acme', step: 'alignment' });
    expect(tailorViewForPath('/tailor/acme?step=bogus')).toEqual({ mode: 'run', slug: 'acme' });
  });
  it.each(['/tailor/drafts', '/tailor/drafts/nope', '/tailor/drafts/id/extra'])('reserves malformed draft URL %s', (path) => {
    expect(tailorViewForPath(path)).toEqual({ mode: 'unavailable' });
  });
});

vi.mock('../src/views/tailoring/TailoringRun', () => ({ TailoringRun: ({ slug, selectedStep }: { slug: string; selectedStep?: string }) => <div>Run {slug} step {selectedStep || 'default'}</div> }));
it('restores run query context on popstate and Tailor navigation opens the list', async () => {
  window.history.replaceState({}, '', '/tailor/acme?step=alignment');
  render(<App />);
  expect(screen.getByText('Run acme step alignment')).toBeInTheDocument();
  window.history.pushState({}, '', '/tailor/acme?step=brief');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(await screen.findByText('Run acme step brief')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Tailor' }));
  expect(window.location.pathname).toBe('/tailor');
  expect(await screen.findByText('Tailor your resume to a job')).toBeInTheDocument();
  cleanup();
});
