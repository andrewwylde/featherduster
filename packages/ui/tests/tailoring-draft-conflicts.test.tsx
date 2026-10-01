/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftEnvelope } from '@featherduster/core';
import { DraftCoordinator } from '../src/tailoring-drafts/coordinator';
import { BrowserRecovery, type BrowserRecoverySnapshot } from '../src/tailoring-drafts/recovery';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DraftConflictDialog, DraftControls } from '../src/views/tailoring/DraftConflictDialog';
import { apiClient } from '../src/api/client';

const id = '11111111-1111-4111-8111-111111111111';
const time = '2026-09-30T12:00:00.000Z';
const server: DraftEnvelope = { token: { revision: 1, fingerprint: 'one' }, record: { id, kind: 'setup', schemaVersion: 1, lifecycle: 'draft', revision: 1, createdAt: time, savedAt: time, editedAt: time, payload: { posting: 'Server text', label: '', runner: '', baseResumeId: '' }, base: null, context: {}, appliedContent: {} } };
let writer: DraftCoordinator; let recovery: BrowserRecovery;
const local = (writerId: string, posting: string): BrowserRecoverySnapshot => ({ workspaceId: 'workspace', draftId: id, writerId, base: server.token, mutationId: writerId, localSequence: 1, savedAt: time, record: { ...server.record, payload: { ...server.record.payload, posting } } as any });
function make(api: any = {}) { recovery = new BrowserRecovery({ writerId: 'mine' }); writer = new DraftCoordinator({ workspaceId: 'workspace', draftId: id, recovery, api: { getHealth: vi.fn().mockResolvedValue({ workspaceId: 'workspace' }), saveTailoringDraft: vi.fn(), ...api } }); return writer; }
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); writer?.dispose(); recovery?.dispose(); vi.restoreAllMocks(); });
it('preserves an external artifact conflict without changing the user edit timestamp', async () => {
  make(); await writer.hydrate(server);
  writer.enterConflict();
  expect(writer.getSnapshot().status).toBe('conflict');
  expect(writer.getSnapshot().record?.editedAt).toBe(time);
  expect(writer.getSnapshot().conflicts[0].record).toEqual(server.record);
});
it('keeps all versions until fork acknowledgement then removes only the selected mutation', async () => {
  make(); recovery.write(local('a', 'Version A')); recovery.write(local('b', 'Version B'));
  await writer.hydrate(server);
  const selected = writer.getSnapshot().conflicts.find(s => s.writerId === 'a')!;
  let finish!: (envelope: DraftEnvelope) => void;
  const fork = { ...server, record: { ...selected.record, id: '22222222-2222-4222-8222-222222222222' } };
  const pending = writer.resolveConflict(() => new Promise(resolve => { finish = resolve; }), selected);
  expect(recovery.list('workspace').snapshots).toHaveLength(2);
  finish(fork); await pending;
  expect(recovery.list('workspace').snapshots.map(s => s.writerId)).toEqual(['b']);
});
it('successful load preserves another writer and a selected copy changed while the choice was pending', async () => {
  make(); recovery.write(local('a', 'Version A')); recovery.write(local('b', 'Version B')); await writer.hydrate(server);
  const selected = writer.getSnapshot().conflicts[0];
  let finish!: (envelope: DraftEnvelope) => void;
  const pending = writer.resolveConflict(() => new Promise(resolve => { finish = resolve; }), selected);
  recovery.write({ ...selected, mutationId: 'newer-mutation', record: { ...selected.record, payload: { ...server.record.payload, posting: 'Newer browser text' } } as any });
  finish(server); await pending;
  expect(recovery.list('workspace').snapshots).toHaveLength(2);
});
it('deleted draft recovery is paused and a failed load never clears the local text', async () => {
  const save = vi.fn(); make({ getTailoringDraft: vi.fn().mockRejectedValue({ status: 410 }), saveTailoringDraft: save });
  recovery.write(local('a', 'Deleted but recoverable')); await writer.hydrate(); await writer.flush();
  expect(writer.getSnapshot().status).toBe('conflict'); expect(save).not.toHaveBeenCalled();
  await expect(writer.resolveConflict(async () => { throw Error('fetch failed'); }, writer.getSnapshot().conflicts[0])).rejects.toThrow('fetch failed');
  expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'Deleted but recoverable' });
});
it('requires an explicit browser version choice and forks the selected content', async () => {
  make(); recovery.write(local('a', 'Version A')); recovery.write(local('b', 'Version B')); await writer.hydrate(server);
  const fork = vi.spyOn(apiClient, 'forkTailoringDraft').mockImplementation(async (_, input) => ({ record: { ...input.sourceSnapshot, id: '22222222-2222-4222-8222-222222222222' }, token: server.token }));
  const onFork = vi.fn();
  render(<DraftConflictDialog coordinator={writer} verifyWorkspace={async () => {}} onFork={onFork} onBack={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Resolve draft conflict' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Keep mine as a separate draft' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Browser version 2/));
  expect((screen.getByLabelText('Selected recovery content') as HTMLTextAreaElement).value).toContain('Version B');
  fireEvent.click(screen.getByRole('button', { name: 'Keep mine as a separate draft' }));
  await waitFor(() => expect(onFork).toHaveBeenCalled());
  expect(fork.mock.calls[0][1].sourceSnapshot.payload).toMatchObject({ posting: 'Version B' });
  expect(recovery.list('workspace').snapshots.map(s => s.writerId)).toEqual(['a']);
});
it('load newer replaces content only after successful fetch', async () => {
  make(); recovery.write(local('a', 'Local text')); await writer.hydrate({ ...server, token: { revision: 2, fingerprint: 'newer' } });
  const get = vi.spyOn(apiClient, 'getTailoringDraft').mockRejectedValueOnce(Error('Offline')).mockResolvedValue(server);
  render(<DraftConflictDialog coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load newer version' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline'); expect(recovery.list('workspace').snapshots).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Load newer version' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(writer.getSnapshot().status).toBe('saved'));
  expect(writer.getSnapshot().record?.payload).toEqual(server.record.payload);
});
it('requires confirmation before discard and keeps recovery when a newer server revision wins', async () => {
  make(); await writer.hydrate(server); writer.edit({ ...server.record.payload, posting: 'Unapplied local text' } as any);
  const discard = vi.spyOn(apiClient, 'discardTailoringDraft').mockRejectedValue(Object.assign(Error('Revision conflict'), { status: 409 }));
  const onBack = vi.fn();
  render(<DraftControls coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={onBack} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  expect(discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await waitFor(() => expect(discard).toHaveBeenCalledWith(id, expect.objectContaining({ expected: server.token })));
  await waitFor(() => expect(writer.getSnapshot().status).toBe('conflict'));
  expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'Unapplied local text' });
  expect(onBack).not.toHaveBeenCalled();
});
it('does not navigate from an editor left while its fork request was pending', async () => {
  make(); recovery.write(local('a', 'Local text')); await writer.hydrate({ ...server, token: { revision: 2, fingerprint: 'newer' } });
  let finish!: (draft: DraftEnvelope) => void;
  const fork = vi.spyOn(apiClient, 'forkTailoringDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const onFork = vi.fn();
  const view = render(<DraftConflictDialog coordinator={writer} verifyWorkspace={async () => {}} onFork={onFork} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Keep mine as a separate draft' }));
  await waitFor(() => expect(fork).toHaveBeenCalled()); view.unmount();
  finish({ ...server, record: { ...server.record, id: '22222222-2222-4222-8222-222222222222' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(onFork).not.toHaveBeenCalled();
});
it('keeps a newer context recovery copy when a selected browser mutation is forked', async () => {
  make(); await writer.hydrate(server); writer.edit({ ...server.record.payload, posting: 'Local text' } as any); writer.enterConflict();
  const selected = writer.getSnapshot().conflicts[0];
  let finish!: (draft: DraftEnvelope) => void;
  const pending = writer.resolveConflict(() => new Promise(resolve => { finish = resolve; }), selected);
  writer.updateContext({ mobilePane: 'context' });
  finish({ ...server, record: { ...server.record, id: '22222222-2222-4222-8222-222222222222' } }); await pending;
  expect(recovery.list('workspace').snapshots[0]?.record.context.mobilePane).toBe('context');
});
it('Keep editing resumes autosave when a save acknowledges while discard confirmation is open', async () => {
  let finish!: (draft: any) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async (_, update) => ({ ...server, record: { ...server.record, payload: update.payload }, token: { revision: 3, fingerprint: 'three' }, mutationId: update.mutationId }));
  make({ saveTailoringDraft: save }); await writer.hydrate(server); writer.edit({ ...server.record.payload, posting: 'First edit' } as any);
  const pending = writer.flush(); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  render(<DraftControls coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  await act(async () => { finish({ ...server, record: { ...server.record, payload: save.mock.calls[0][1].payload }, token: { revision: 2, fingerprint: 'two' }, mutationId: save.mock.calls[0][1].mutationId }); await pending; });
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await expect(writer.awaitSaved()).resolves.toMatchObject({ token: { revision: 2 } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => { writer.edit({ ...server.record.payload, posting: 'Continued edit' } as any); await writer.awaitSaved(); });
  expect(save).toHaveBeenCalledTimes(2); expect(writer.getSnapshot().record?.payload).toMatchObject({ posting: 'Continued edit' });
});
it('Keep editing never releases a real browser conflict received during discard confirmation', async () => {
  const save = vi.fn(); make({ saveTailoringDraft: save }); await writer.hydrate(server); writer.edit({ ...server.record.payload, posting: 'Mine' } as any);
  render(<DraftControls coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  act(() => { recovery.write(local('other', 'Other text')); });
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('dialog', { name: 'Resolve draft conflict' })).toBeInTheDocument();
  await expect(writer.awaitSaved()).rejects.toThrow(/paused|conflict/); await writer.flush(); expect(save).not.toHaveBeenCalled();
});
it('keeps memory-only text selectable across repeated other-writer events after storage failure', async () => {
  make(); await writer.hydrate(server);
  vi.spyOn(recovery, 'write').mockReturnValue({ ok: false, key: 'memory', error: 'quota' });
  writer.edit({ ...server.record.payload, posting: 'Memory-only edit' } as any); writer.enterConflict();
  render(<DraftConflictDialog coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} />);
  for (const mutation of ['first', 'second', 'third']) {
    const snapshot = { ...local('other', `Other ${mutation}`), mutationId: mutation };
    const key = `featherduster:tailoring:v1:workspace:${id}:other`;
    act(() => { localStorage.setItem(key, JSON.stringify(snapshot)); window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(snapshot) })); });
    expect(writer.getSnapshot().conflicts.some(copy => (copy.record.payload as any).posting === 'Memory-only edit')).toBe(true);
    expect(writer.canLeave()).toBe(false);
    expect(recovery.list('workspace').snapshots.map(copy => copy.writerId)).toEqual(['other']);
  }
  fireEvent.click(screen.getByLabelText(/Browser version 2/));
  expect(screen.getByLabelText('Selected recovery content')).toHaveValue('Memory-only edit');
});
it('releases the temporary confirmation hold after a successful run reset', async () => {
  const run = { ...server, record: { ...server.record, kind: 'run', runSlug: 'run', base: { resumeId: 'base', fingerprint: 'base', spec: { profile: { name: 'Person', title: 'Engineer', email: 'p@example.com' }, experiences: [], skills: [], education: [] } }, payload: { proposalTextById: { p: 'Unapplied' }, artifactTokens: {} } } } as DraftEnvelope;
  make(); await writer.hydrate(run);
  const reset = { ...run, record: { ...run.record, payload: { proposalTextById: {}, artifactTokens: {} } }, token: { revision: 2, fingerprint: 'reset' } } as DraftEnvelope;
  vi.spyOn(apiClient, 'discardTailoringDraft').mockResolvedValue(reset);
  const onLoaded = vi.fn();
  render(<DraftControls coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} onLoaded={onLoaded} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard unapplied edits' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(reset));
  await expect(writer.awaitSaved()).resolves.toEqual(reset);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it.each([undefined, 500])('Keep editing resumes autosave after discard fails with status %s', async status => {
  const save = vi.fn().mockImplementation(async (_, update) => ({ ...server, record: { ...server.record, payload: update.payload }, token: { revision: 2, fingerprint: 'saved' }, mutationId: update.mutationId }));
  make({ saveTailoringDraft: save }); await writer.hydrate(server); writer.edit({ ...server.record.payload, posting: 'Preserve my edits' } as any);
  vi.spyOn(apiClient, 'discardTailoringDraft').mockRejectedValue(Object.assign(Error('Discard unavailable'), { status }));
  render(<DraftControls coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Discard unavailable');
  expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'Preserve my edits' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await act(async () => { writer.edit({ ...server.record.payload, posting: 'Continue after failure' } as any); await expect(writer.awaitSaved()).resolves.toMatchObject({ token: { revision: 2 } }); });
  expect(save).toHaveBeenCalledTimes(1); expect(writer.getSnapshot().status).toBe('saved'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('retains a real conflict arriving during a discard request that then fails', async () => {
  const save = vi.fn(); make({ saveTailoringDraft: save }); await writer.hydrate(server); writer.edit({ ...server.record.payload, posting: 'My protected edit' } as any);
  let fail!: (error: Error) => void;
  const discard = vi.spyOn(apiClient, 'discardTailoringDraft').mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  render(<DraftControls coordinator={writer} verifyWorkspace={async () => {}} onFork={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await waitFor(() => expect(discard).toHaveBeenCalled());
  await act(async () => { recovery.write(local('other', 'Other pending edit')); fail(Object.assign(Error('Server failed'), { status: 500 })); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Server failed');
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('dialog', { name: 'Resolve draft conflict' })).toBeInTheDocument();
  expect(writer.getSnapshot().conflicts).toHaveLength(2); await expect(writer.awaitSaved()).rejects.toThrow(/paused|conflict/); await writer.flush(); expect(save).not.toHaveBeenCalled();
});
