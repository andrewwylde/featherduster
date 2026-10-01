/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';
import { RECOVERY_PREFIX } from '../src/tailoring-drafts/recovery';

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/tailor/canvas');
  vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: '/workspace', workspaceId: 'workspace' });
  vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({ isClean: true, issues: [] });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getResumes').mockResolvedValue([{ id: 'base', name: 'Base', type: 'template', spec: { profile: { name: 'Alex', title: 'Engineer', email: 'alex@example.com' }, experiences: [], education: [], skills: [] } }] as any);
  vi.spyOn(apiClient, 'getRunners').mockResolvedValue({ runners: [{ id: 'claude', label: 'Claude', available: true, isDefault: true, locality: 'cloud' }] } as any);
  vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
  vi.spyOn(apiClient, 'listTailoringDrafts').mockResolvedValue({ workspaceId: 'workspace', records: [], recoveryErrors: [] });
  vi.spyOn(apiClient, 'getTailoringDraft').mockRejectedValue(Object.assign(Error('Not found'), { status: 404 }));
  vi.spyOn(apiClient, 'createTailoringDraft').mockImplementation(() => new Promise(() => {}));
});
afterEach(() => cleanup());
it.each(['workspace mismatch', 'navigation', 'source switch'] as const)('rejects pending variant verification after %s and retains local content', async reason => {
  let resolveList!: (value: Awaited<ReturnType<typeof apiClient.listTailoringDrafts>>) => void;
  vi.mocked(apiClient.listTailoringDrafts).mockImplementation(() => new Promise(resolve => { resolveList = resolve; }));
  const base = (await apiClient.getResumes())[0];
  vi.mocked(apiClient.getResumes).mockResolvedValue([base, { ...base, id: 'second', name: 'Second' }]);
  const save = vi.spyOn(apiClient, 'saveResume').mockResolvedValue({ success: true, name: 'variant', filePath: 'variant.yaml' });
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/Paste target job specification/), { target: { value: 'Retained manual content' } });
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  let resolveHealth!: (value: Awaited<ReturnType<typeof apiClient.getHealth>>) => void;
  vi.mocked(apiClient.getHealth).mockImplementation(() => new Promise(resolve => { resolveHealth = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Variant' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. netflix-agent-platform'), { target: { value: 'variant' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save Variant' }));
  expect(resolveHealth).toBeTypeOf('function');
  if (reason === 'workspace mismatch') {
    await act(async () => resolveList({ workspaceId: 'different-workspace', records: [], recoveryErrors: [] }));
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace identity changed');
  } else {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    if (reason === 'navigation') fireEvent.click(screen.getByRole('link', { name: 'Skills' }));
    else fireEvent.change(screen.getByLabelText('Select resume variant'), { target: { value: 'second' } });
  }
  await act(async () => resolveHealth({ status: 'ok', workspaceDir: '/workspace', workspaceId: 'workspace' }));
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(JSON.parse(localStorage.getItem(key)!).record.payload.jobDescription).toBe('Retained manual content');
});

it('blocks a fresh canvas without a source and can retry after a resume is added', async () => {
  const available = await apiClient.getResumes();
  vi.mocked(apiClient.getResumes).mockResolvedValue([]);
  render(<App />);
  expect(await screen.findByText('No source resume available')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Paste target job specification/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Add Experience/i })).not.toBeInTheDocument();
  expect(Object.keys(localStorage).filter(k => k.startsWith(RECOVERY_PREFIX))).toHaveLength(0);
  vi.mocked(apiClient.getResumes).mockResolvedValue(available);
  fireEvent.click(screen.getByRole('button', { name: 'Reload resumes' }));
  fireEvent.change(await screen.findByPlaceholderText(/Paste target job specification/), { target: { value: 'Now protected' } });
  expect(window.location.pathname).toMatch(/^\/tailor\/drafts\//);
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(key)!).record.payload.jobDescription).toBe('Now protected');
});

it('keeps a hydrated manual draft editable when its source disappears from the resume list', async () => {
  const first = render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/Paste target job specification/), { target: { value: 'Recovered content' } });
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  const pinnedBase = JSON.parse(localStorage.getItem(key)!).record.base;
  first.unmount();
  vi.mocked(apiClient.getResumes).mockResolvedValue([]);
  render(<App />);
  fireEvent.change(await screen.findByDisplayValue('Recovered content'), { target: { value: 'Edited without current source' } });
  expect(screen.getByLabelText('Select resume variant')).toHaveValue('base');
  const recovered = JSON.parse(localStorage.getItem(key)!).record;
  expect(recovered.payload.jobDescription).toBe('Edited without current source');
  expect(recovered.base).toEqual(pinnedBase);
});

it('persists the first manual mutation before routing and restores it before the server debounce', async () => {
  const first = render(<App />);
  const posting = await screen.findByPlaceholderText(/Paste target job specification/);
  posting.focus();
  expect(Object.keys(localStorage).filter(k => k.startsWith(RECOVERY_PREFIX))).toHaveLength(0);
  fireEvent.change(posting, { target: { value: 'My durable posting' } });
  expect(posting).toHaveFocus();
  expect(screen.getByDisplayValue('My durable posting')).toBe(posting);
  expect(window.location.pathname).toMatch(/^\/tailor\/drafts\/[\da-f-]{36}$/);
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(key)!).record.payload.jobDescription).toBe('My durable posting');
  expect(apiClient.createTailoringDraft).not.toHaveBeenCalled();
  first.unmount(); render(<App />);
  expect(await screen.findByDisplayValue('My durable posting')).toBeInTheDocument();
});

it('creates independent drafts when changing source and retains the first browser recovery', async () => {
  const base = (await apiClient.getResumes())[0];
  vi.mocked(apiClient.getResumes).mockResolvedValue([base, { ...base, id: 'second', name: 'Second' }]);
  render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/Paste target job specification/), { target: { value: 'First manual edits' } });
  const firstPath = window.location.pathname;
  fireEvent.change(screen.getByLabelText('Select resume variant'), { target: { value: 'second' } });
  expect(window.location.pathname).not.toBe(firstPath);
  const snapshots = Object.keys(localStorage).filter(k => k.startsWith(RECOVERY_PREFIX)).map(k => JSON.parse(localStorage.getItem(k)!));
  expect(snapshots).toHaveLength(2);
  expect(snapshots.map(s => s.record.payload.selectedResumeId).sort()).toEqual(['base', 'second']);
  expect(snapshots.find(s => s.record.payload.selectedResumeId === 'base').record.payload.jobDescription).toBe('First manual edits');
});

it('retains a pane chosen before the first content edit without creating a defaults-only draft', async () => {
  render(<App />);
  await screen.findByPlaceholderText(/Paste target job specification/);
  fireEvent.click(screen.getByRole('tab', { name: /Matcher/i }));
  expect(Object.keys(localStorage).filter(k => k.startsWith(RECOVERY_PREFIX))).toHaveLength(0);
  fireEvent.change(screen.getByPlaceholderText(/Paste target job specification/), { target: { value: 'First content' } });
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(key)!).record.context.mobilePane).toBe('matcher');
});

it('restores excluded bullets, stable IDs, and unfinished fields in a non-first variant', async () => {
  const base = (await apiClient.getResumes())[0];
  vi.mocked(apiClient.getResumes).mockResolvedValue([base, { ...base, id: 'second', name: 'Second', spec: { ...base.spec, experiences: [{ company: 'Company', role: 'Role', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Keep excluded text', citations: ['ev-1'] }] }] } }]);
  const first = render(<App />);
  fireEvent.change(await screen.findByLabelText('Select resume variant'), { target: { value: 'second' } });
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.change(screen.getByPlaceholderText('Company'), { target: { value: '' } });
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  const before = JSON.parse(localStorage.getItem(key)!).record.payload;
  first.unmount(); render(<App />);
  expect(await screen.findByRole('checkbox')).not.toBeChecked();
  expect(screen.getByPlaceholderText('Company')).toHaveValue('');
  expect(screen.getByLabelText('Select resume variant')).toHaveValue('second');
  fireEvent.change(screen.getByPlaceholderText(/Paste target job specification/), { target: { value: 'Another edit' } });
  const after = JSON.parse(localStorage.getItem(key)!).record.payload;
  expect(after.experiences).toEqual(before.experiences);
  expect(after.experiences[0].bullets[0]).toMatchObject({ text: 'Keep excluded text', included: false });
});

it('guards navigation and source changes when no store holds the latest manual content', async () => {
  const base = (await apiClient.getResumes())[0];
  vi.mocked(apiClient.getResumes).mockResolvedValue([base, { ...base, id: 'second', name: 'Second' }]);
  render(<App />);
  const posting = await screen.findByPlaceholderText(/Paste target job specification/);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
  fireEvent.change(posting, { target: { value: 'Memory-only edits' } });
  const path = window.location.pathname;
  fireEvent.change(screen.getByLabelText('Select resume variant'), { target: { value: 'second' } });
  expect(screen.getByLabelText('Select resume variant')).toHaveValue('base');
  fireEvent.click(screen.getByRole('link', { name: 'Skills' }));
  expect(window.location.pathname).toBe(path);
  expect(screen.getByDisplayValue('Memory-only edits')).toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it('keeps the browser draft while a known workspace is offline and saves the mobile pane and squeeze mode', async () => {
  const first = render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/Paste target job specification/), { target: { value: 'Offline content' } });
  fireEvent.click(screen.getByRole('button', { name: /Squeeze/i }));
  fireEvent.click(screen.getByRole('tab', { name: /Matcher/i }));
  vi.mocked(apiClient.createTailoringDraft).mockRejectedValue(Error('Offline'));
  await waitFor(() => expect(apiClient.createTailoringDraft).toHaveBeenCalled());
  first.unmount(); render(<App />);
  expect(await screen.findByDisplayValue('Offline content')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Matcher/i })).toHaveAttribute('aria-selected', 'true');
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(key)!).record.payload.squeezeMode).toBe(true);
});
it('creates a durable setup handoff and preserves the independent manual draft', async () => {
  const first = render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/Paste target job specification/), { target: { value: 'Posting for setup with enough detail' } });
  const manualPath = window.location.pathname;
  fireEvent.click(screen.getByRole('button', { name: /Run full tailoring/i }));
  expect(window.location.pathname).not.toBe(manualPath);
  expect(window.location.pathname).toMatch(/^\/tailor\/drafts\//);
  expect(Object.keys(localStorage).filter(k => k.startsWith(RECOVERY_PREFIX))).toHaveLength(2);
  first.unmount(); render(<App />);
  expect(await screen.findByLabelText('Job posting')).toHaveValue('Posting for setup with enough detail');
});
