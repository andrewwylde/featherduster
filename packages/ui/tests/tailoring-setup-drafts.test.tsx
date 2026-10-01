/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/api/client';
vi.mock('../src/views/ResumeTailor', () => ({ ResumeTailor: () => null }));
import { RECOVERY_PREFIX } from '../src/tailoring-drafts/recovery';

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/tailor');
  vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: '/workspace', workspaceId: 'workspace' });
  vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({ isClean: true, issues: [] });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getResumes').mockResolvedValue([{ id: 'base', name: 'Base', type: 'template' }] as any);
  vi.spyOn(apiClient, 'getRunners').mockResolvedValue({ runners: [{ id: 'claude', label: 'Claude', available: true, isDefault: true, locality: 'cloud' }] } as any);
  vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
  vi.spyOn(apiClient, 'listTailoringDrafts').mockResolvedValue({ workspaceId: 'workspace', records: [], recoveryErrors: [] });
  vi.spyOn(apiClient, 'getTailoringDraft').mockRejectedValue(Object.assign(Error('Not found'), { status: 404 }));
  vi.spyOn(apiClient, 'createTailoringDraft').mockImplementation(() => new Promise(() => {}));
});
afterEach(() => cleanup());
it('creates a recoverable URL on the first edit, retaining the same form before any server response', async () => {
  const first = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  const posting = await screen.findByLabelText('Job posting');
  await waitFor(() => expect(screen.getByLabelText('Base resume')).toHaveValue('base'));
  expect(Object.keys(localStorage).filter(k => k.startsWith(RECOVERY_PREFIX))).toHaveLength(0);
  fireEvent.change(posting, { target: { value: 'Immediate refresh posting' } });
  expect(window.location.pathname).toMatch(/^\/tailor\/drafts\/[\da-f-]{36}$/);
  expect(screen.getByLabelText('Job posting')).toHaveValue('Immediate refresh posting');
  expect(screen.getByRole('button', { name: 'Back to list' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(key)!).record.payload.posting).toBe('Immediate refresh posting');
  first.unmount(); render(<App />);
  expect(await screen.findByLabelText('Job posting')).toHaveValue('Immediate refresh posting');
});
it('shows unavailable for unknown draft IDs', async () => {
  window.history.replaceState({}, '', '/tailor/drafts/11111111-1111-4111-8111-111111111111');
  render(<App />);
  expect(await screen.findByText('Draft unavailable')).toBeInTheDocument();
});
it('keeps healthy runs visible when draft loading fails', async () => {
  vi.mocked(apiClient.listTailoringDrafts).mockRejectedValue(Error('Draft store unavailable'));
  vi.mocked(apiClient.listTailoringRuns).mockResolvedValue([{ slug: 'healthy', title: 'Healthy run', state: 'complete', updated: new Date().toISOString() }] as any);
  render(<App />);
  expect(await screen.findByText('Healthy run')).toBeInTheDocument();
  expect(await screen.findByText(/Draft store unavailable/)).toBeInTheDocument();
});
it('does not allow unprotected setup edits before workspace identity is confirmed', async () => {
  vi.mocked(apiClient.getHealth).mockResolvedValue({ status: 'ok', workspaceDir: '/workspace' });
  vi.mocked(apiClient.listTailoringDrafts).mockRejectedValue(Error('Offline'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  expect(await screen.findByText(/Workspace identity unavailable/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Job posting')).not.toBeInTheDocument();
});
it('returns to the list after cancelling a draft', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  const posting = await screen.findByLabelText('Job posting');
  await waitFor(() => expect(screen.getByLabelText('Base resume')).toHaveValue('base'));
  fireEvent.change(posting, { target: { value: 'Saved posting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Tailor your resume to a job')).toBeInTheDocument();
  expect(await screen.findByText('Saved posting')).toBeInTheDocument();
});
it('keeps a first-edit draft URL and blocks navigation if browser storage fails', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  const posting = await screen.findByLabelText('Job posting');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
  fireEvent.change(posting, { target: { value: 'Must not lose this posting' } });
  expect(window.location.pathname).toMatch(/^\/tailor\/drafts\//);
  fireEvent.click(screen.getByRole('link', { name: 'Skills' }));
  expect(window.location.pathname).toMatch(/^\/tailor\/drafts\//);
  expect(screen.getByLabelText('Job posting')).toHaveValue('Must not lose this posting');
});
it('awaits the workspace save before creating a run and preserves posting when creation fails', async () => {
  let acknowledge: (value: any) => void = () => {};
  vi.mocked(apiClient.createTailoringDraft).mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  const create = vi.spyOn(apiClient, 'createRunFromDraft').mockRejectedValue(Error('Runner offline'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  const posting = await screen.findByLabelText('Job posting');
  await waitFor(() => expect(screen.getByLabelText('Model runner')).toHaveValue('claude'));
  fireEvent.change(posting, { target: { value: 'A posting long enough to create a run' } });
  const draftId = window.location.pathname.split('/').at(-1)!;
  fireEvent.click(screen.getByRole('button', { name: 'Create run' }));
  await waitFor(() => expect(apiClient.createTailoringDraft).toHaveBeenCalledTimes(1));
  expect(create).not.toHaveBeenCalled();
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  const record = JSON.parse(localStorage.getItem(key)!).record;
  acknowledge({ record, token: { revision: 1, fingerprint: 'saved' }, mutationId: vi.mocked(apiClient.createTailoringDraft).mock.calls[0][0].mutationId });
  expect(await screen.findByRole('alert')).toHaveTextContent('Runner offline');
  expect(create).toHaveBeenCalledWith(draftId, { expected: { revision: 1, fingerprint: 'saved' }, operationId: expect.any(String) });
  expect(screen.getByLabelText('Job posting')).toHaveValue('A posting long enough to create a run');
});
import { BrowserRecovery } from '../src/tailoring-drafts/recovery';
import { TailoringRunList } from '../src/views/tailoring/TailoringRunList';
import { sseClient } from '../src/api/events';
function setupRecord(id = '11111111-1111-4111-8111-111111111111') {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id, kind: 'setup', lifecycle: 'draft', revision: 0, createdAt: now, editedAt: now, savedAt: now, context: {}, appliedContent: {}, base: null, payload: { posting: 'Saved setup posting', label: 'Saved setup', baseResumeId: 'base', runner: 'claude' } } as const;
}
it('labels divergent browser versions without silently presenting the latest one as selected', async () => {
  const recovery = new BrowserRecovery(); const record = setupRecord();
  for (const writerId of ['a', 'b']) recovery.write({ workspaceId: 'workspace', draftId: record.id, writerId, base: null, mutationId: writerId, localSequence: 1, savedAt: record.savedAt, record: { ...record, payload: { ...record.payload, label: `Version ${writerId}` } } });
  render(<TailoringRunList onOpenRun={() => {}} recovery={recovery} workspaceId="workspace" />);
  expect(await screen.findByText('2 browser recovery versions — choose when opening')).toBeInTheDocument();
  cleanup(); recovery.dispose();
});
it('orders browser recovery by content edit time, not a later pane persistence time', async () => {
  const recovery = new BrowserRecovery();
  const older = { ...setupRecord(), editedAt: '2026-09-01T12:00:00.000Z', payload: { ...setupRecord().payload, label: 'Older content' } };
  const newer = { ...setupRecord('22222222-2222-4222-8222-222222222222'), editedAt: '2026-09-02T12:00:00.000Z', payload: { ...setupRecord().payload, label: 'Newer content' } };
  recovery.write({ workspaceId: 'workspace', draftId: older.id, writerId: recovery.writerId, base: null, mutationId: 'pane', localSequence: 1, savedAt: '2026-09-03T12:00:00.000Z', record: { ...older, context: { mobilePane: 'matcher' } } });
  recovery.write({ workspaceId: 'workspace', draftId: newer.id, writerId: recovery.writerId, base: null, mutationId: 'content', localSequence: 1, savedAt: newer.editedAt, record: newer });
  render(<TailoringRunList onOpenRun={() => {}} recovery={recovery} workspaceId="workspace" />);
  await screen.findByText('Newer content');
  expect(screen.getAllByRole('listitem').map(row => row.querySelector('strong')?.textContent)).toEqual(['Newer content', 'Older content']);
  cleanup(); recovery.dispose();
});
it('keeps healthy server drafts visible when a later refresh fails', async () => {
  vi.mocked(apiClient.listTailoringDrafts).mockResolvedValue({ workspaceId: 'workspace', records: [{ record: setupRecord(), token: { revision: 1, fingerprint: 'a' } }], recoveryErrors: [] });
  render(<TailoringRunList onOpenRun={() => {}} />);
  expect(await screen.findByText('Saved setup')).toBeInTheDocument();
  vi.mocked(apiClient.listTailoringDrafts).mockRejectedValue(Error('Refresh offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Refresh offline')).toBeInTheDocument();
  expect(screen.getByText('Saved setup')).toBeInTheDocument();
});
it('shows browser-only drafts and corrupt-copy errors alongside healthy runs', async () => {
  const recovery = new BrowserRecovery();
  recovery.write({ workspaceId: 'workspace', draftId: setupRecord().id, writerId: recovery.writerId, base: null, mutationId: 'local', localSequence: 1, savedAt: new Date().toISOString(), record: setupRecord() });
  localStorage.setItem(`${RECOVERY_PREFIX}workspace:broken:writer`, '{invalid');
  vi.mocked(apiClient.listTailoringDrafts).mockRejectedValue(Error('Draft store offline'));
  render(<TailoringRunList onOpenRun={() => {}} recovery={recovery} workspaceId="workspace" />);
  expect(await screen.findByText('Saved setup')).toBeInTheDocument();
  expect(screen.getByText('Saved in this browser')).toBeInTheDocument();
  expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
  cleanup(); recovery.dispose();
});
it('does not label a generated but unfinalized legacy run Completed', async () => {
  vi.mocked(apiClient.listTailoringRuns).mockResolvedValue([{ slug: 'brief-ready', title: 'Brief ready', state: 'complete', finalized_path: null, updated: new Date().toISOString() }] as any);
  render(<TailoringRunList onOpenRun={() => {}} />);
  expect(await screen.findByText('Brief ready')).toBeInTheDocument();
  expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
});
it('shows available runs even while draft loading is pending', async () => {
  vi.mocked(apiClient.listTailoringDrafts).mockImplementation(() => new Promise(() => {}));
  vi.mocked(apiClient.listTailoringRuns).mockResolvedValue([{ slug: 'healthy', title: 'Healthy pending run', state: 'analysis_review', updated: new Date().toISOString() }] as any);
  render(<TailoringRunList onOpenRun={() => {}} />);
  expect(await screen.findByText('Healthy pending run')).toBeInTheDocument();
});
it('allows setup with health-confirmed identity while the draft list is still pending', async () => {
  vi.mocked(apiClient.listTailoringDrafts).mockImplementation(() => new Promise(() => {}));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  expect(await screen.findByLabelText('Job posting')).toBeInTheDocument();
});
it('refreshes work when a draft-change event arrives', async () => {
  let onChange: (() => void) | undefined;
  vi.spyOn(sseClient, 'onDraftChange').mockImplementation(listener => { onChange = () => listener({} as any); return () => {}; });
  render(<TailoringRunList onOpenRun={() => {}} />);
  await screen.findByText('No tailoring runs yet.');
  vi.mocked(apiClient.listTailoringDrafts).mockResolvedValue({ workspaceId: 'workspace', records: [{ record: setupRecord(), token: { revision: 1, fingerprint: 'a' } }], recoveryErrors: [] });
  onChange?.();
  expect(await screen.findByText('Saved setup')).toBeInTheDocument();
});
import { StrictMode } from 'react';
it('keeps cross-tab recovery notifications active after StrictMode effect remount', async () => {
  render(<StrictMode><App /></StrictMode>);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  const posting = await screen.findByLabelText('Job posting');
  fireEvent.change(posting, { target: { value: 'My first posting' } });
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  const snapshot = JSON.parse(localStorage.getItem(key)!);
  snapshot.writerId = 'other-page'; snapshot.record.payload.posting = 'Other tab text';
  const otherKey = `${RECOVERY_PREFIX}workspace:${snapshot.draftId}:other-page`;
  localStorage.setItem(otherKey, JSON.stringify(snapshot));
  fireEvent(window, new StorageEvent('storage', { key: otherKey, newValue: JSON.stringify(snapshot) }));
  expect(await screen.findByText(/Conflicting draft versions/)).toBeInTheDocument();
  expect(screen.getByLabelText('Job posting')).toHaveValue('My first posting');
});
it('recovers a browser-only setup after the server create request failed', async () => {
  vi.mocked(apiClient.createTailoringDraft).mockRejectedValue(Error('Save offline'));
  const first = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  fireEvent.change(await screen.findByLabelText('Job posting'), { target: { value: 'Offline posting for refresh' } });
  expect(await screen.findByText(/Workspace save pending/)).toBeInTheDocument();
  first.unmount(); render(<App />);
  expect(await screen.findByLabelText('Job posting')).toHaveValue('Offline posting for refresh');
});
it('retains a tombstoned local copy without recreating the deleted workspace draft', async () => {
  const recovery = new BrowserRecovery();
  recovery.write({ workspaceId: 'workspace', draftId: setupRecord().id, writerId: recovery.writerId, base: null, mutationId: 'local', localSequence: 1, savedAt: new Date().toISOString(), record: setupRecord() });
  vi.mocked(apiClient.getTailoringDraft).mockRejectedValue(Object.assign(Error('Discarded'), { status: 410 }));
  window.history.replaceState({}, '', `/tailor/drafts/${setupRecord().id}`);
  render(<App />);
  expect(await screen.findByText(/Conflicting draft versions/)).toBeInTheDocument();
  expect(screen.getByLabelText('Job posting')).toHaveValue('Saved setup posting');
  expect(apiClient.createTailoringDraft).not.toHaveBeenCalled();
  cleanup(); recovery.dispose();
});
it('Tailor navigation always returns to the list after editing a setup', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  fireEvent.change(await screen.findByLabelText('Job posting'), { target: { value: 'Keep in list' } });
  fireEvent.click(screen.getByRole('link', { name: 'Tailor' }));
  expect(await screen.findByText('Tailor your resume to a job')).toBeInTheDocument();
  expect(screen.queryByLabelText('Job posting')).not.toBeInTheDocument();
});
import { TailoringDraftRoute } from '../src/views/tailoring/TailoringDraftRoute';
it('protects a handed-off posting immediately and fills late fetched defaults', async () => {
  let finishRunners: (value: any) => void = () => {};
  vi.mocked(apiClient.getRunners).mockImplementation(() => new Promise(resolve => { finishRunners = resolve; }));
  const consumed = vi.fn();
  render(<TailoringDraftRoute navigate={() => {}} registerGuard={() => {}} onOpenCanvas={() => {}} onOpenSettings={() => {}} initialPosting="Handed-off posting" onInitialPostingConsumed={consumed} />);
  await waitFor(() => expect(apiClient.getHealth).toHaveBeenCalled());
  expect(consumed).toHaveBeenCalled();
  const earlyKey = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(earlyKey)!).record.payload.posting).toBe('Handed-off posting');
  finishRunners({ runners: [{ id: 'claude', label: 'Claude', available: true, isDefault: true, locality: 'cloud' }] });
  expect(await screen.findByLabelText('Model runner')).toHaveValue('claude');
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  expect(JSON.parse(localStorage.getItem(key)!).record.payload).toMatchObject({ runner: 'claude', baseResumeId: 'base', posting: 'Handed-off posting' });
});
it('renders browser recovery immediately while both network lists remain pending', async () => {
  const recovery = new BrowserRecovery();
  recovery.write({ workspaceId: 'workspace', draftId: setupRecord().id, writerId: recovery.writerId, base: null, mutationId: 'local', localSequence: 1, savedAt: new Date().toISOString(), record: setupRecord() });
  vi.mocked(apiClient.listTailoringRuns).mockImplementation(() => new Promise(() => {}));
  vi.mocked(apiClient.listTailoringDrafts).mockImplementation(() => new Promise(() => {}));
  render(<TailoringRunList onOpenRun={() => {}} recovery={recovery} workspaceId="workspace" />);
  expect(await screen.findByText('Saved setup')).toBeInTheDocument();
  expect(screen.getByText('Saved in this browser')).toBeInTheDocument();
  cleanup(); recovery.dispose();
});
it('stops queued writes and disables editing when health and delayed list identities disagree', async () => {
  let finishList: (value: any) => void = () => {};
  const pending = new Promise<any>(resolve => { finishList = resolve; });
  vi.mocked(apiClient.listTailoringDrafts).mockReturnValue(pending);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  fireEvent.change(await screen.findByLabelText('Job posting'), { target: { value: 'Keep this local work' } });
  const key = Object.keys(localStorage).find(k => k.startsWith(RECOVERY_PREFIX))!;
  finishList({ workspaceId: 'other-workspace', records: [], recoveryErrors: [] });
  expect(await screen.findByText(/Workspace identity changed/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Job posting')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create run' })).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(key)!).record.payload.posting).toBe('Keep this local work');
  // Advance beyond the coordinator debounce. Identity invalidation must cancel it.
  await new Promise(resolve => setTimeout(resolve, 650));
  expect(apiClient.createTailoringDraft).not.toHaveBeenCalled();
});
it.each(['memory', 'browser', 'workspace'] as const)('preserves the browser unload guard after workspace mismatch (durability: %s)', async durability => {
  if (durability === 'workspace') vi.mocked(apiClient.createTailoringDraft).mockImplementation(async input => ({ record: { ...setupRecord(input.record.id), payload: input.record.payload as any }, token: { revision: 1, fingerprint: 'saved' }, mutationId: input.mutationId }));
  let finishList: (value: any) => void = () => {};
  vi.mocked(apiClient.listTailoringDrafts).mockReturnValue(new Promise(resolve => { finishList = resolve; }));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  const posting = await screen.findByLabelText('Job posting');
  if (durability === 'memory') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
  fireEvent.change(posting, { target: { value: 'Keep the latest unsent text' } });
  if (durability === 'workspace') await screen.findByText('Draft saved');
  finishList({ workspaceId: 'other-workspace', records: [], recoveryErrors: [] });
  await screen.findByText(/Workspace identity changed/);
  const beforeUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(durability === 'memory');
});
it.each(['unmount', 'same-host', 'same-host-list'] as const)('does not navigate after leaving a pending create operation (%s)', async leave => {
  let finishCreate: (value: any) => void = () => {};
  let saved: any;
  vi.mocked(apiClient.createTailoringDraft).mockImplementation(async input => {
    saved = { record: { ...setupRecord(input.record.id), payload: input.record.payload }, token: { revision: 1, fingerprint: 'saved' } };
    return { ...saved, mutationId: input.mutationId };
  });
  vi.spyOn(apiClient, 'createRunFromDraft').mockReturnValue(new Promise(resolve => { finishCreate = resolve; }));
  const navigate = vi.fn();
  const props = { navigate, registerGuard: () => {}, onOpenCanvas: () => {}, onOpenSettings: () => {} };
  const host = render(<TailoringDraftRoute {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
  fireEvent.change(await screen.findByLabelText('Job posting'), { target: { value: 'Posting long enough to create a run' } });
  const draftPath = navigate.mock.calls[0][0] as string;
  host.rerender(<TailoringDraftRoute {...props} draftId={draftPath.split('/').at(-1)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create run' }));
  await waitFor(() => expect(apiClient.createRunFromDraft).toHaveBeenCalled());
  if (leave === 'unmount') host.unmount();
  else if (leave === 'same-host-list') host.rerender(<TailoringDraftRoute {...props} />);
  else host.rerender(<TailoringDraftRoute {...props} draftId="22222222-2222-4222-8222-222222222222" />);
  navigate.mockClear();
  await act(async () => { finishCreate({ ...saved, slug: 'created-after-leaving' }); });
  expect(navigate).not.toHaveBeenCalled();
});
