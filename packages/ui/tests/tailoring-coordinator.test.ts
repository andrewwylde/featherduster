/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftAcknowledgement, DraftEnvelope, DraftRecord } from '@featherduster/core';
import { BrowserRecovery } from '../src/tailoring-drafts/recovery';
import { DraftCoordinator } from '../src/tailoring-drafts/coordinator';
import { useTailoringDraft } from '../src/tailoring-drafts/useTailoringDraft';
import { renderHook } from '@testing-library/react';

const record: DraftRecord = { schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', kind: 'setup', lifecycle: 'draft', revision: 1, createdAt: '2026-09-30T12:00:00.000Z', editedAt: '2026-09-30T12:00:00.000Z', savedAt: '2026-09-30T12:00:00.000Z', base: null, payload: { posting: '', label: '', baseResumeId: '', runner: '' }, context: {}, appliedContent: {} };
const envelope: DraftEnvelope = { record, token: { revision: 1, fingerprint: 'one' } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const coordinators: DraftCoordinator[] = [];
function setup(brokenStorage = false) {
  const recovery = new BrowserRecovery({ writerId: 'writer', ...(brokenStorage ? { storage: { setItem() { throw Error('quota'); } } as unknown as Storage } : {}) });
  const api = { getHealth: vi.fn(async () => ({ status: 'ok' as const, workspaceDir: '/workspace', workspaceId: 'workspace' })), getTailoringDraft: vi.fn(async () => envelope), createTailoringDraft: vi.fn(), saveTailoringDraft: vi.fn() };
  let id = 0;
  const coordinator = new DraftCoordinator({ workspaceId: 'workspace', draftId: record.id, api, recovery, id: () => `mutation-${++id}` });
  coordinators.push(coordinator);
  return { coordinator, api, recovery };
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { coordinators.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });
it('timestamps offline content edits but preserves their timestamp when only context changes', async () => {
  const { coordinator, recovery } = setup();
  await coordinator.hydrate(envelope);
  vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
  coordinator.edit({ ...record.payload, posting: 'Offline edit' });
  expect(recovery.list('workspace').snapshots[0].record.editedAt).toBe('2026-10-01T12:00:00.000Z');
  vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
  coordinator.updateContext({ mobilePane: 'matcher' });
  expect(recovery.list('workspace').snapshots[0].record.editedAt).toBe('2026-10-01T12:00:00.000Z');
});
it('persists immediately and never lets acknowledgement A mark B saved or remove B', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope);
  const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockImplementationOnce(() => new Promise(() => {}));
  c.edit({ ...record.payload, posting: 'A' }); expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'A' }); expect(api.saveTailoringDraft).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500); const request = api.saveTailoringDraft.mock.calls[0][1];
  c.edit({ ...record.payload, posting: 'B' });
  a.resolve({ ...envelope, token: { revision: 2, fingerprint: 'two' }, mutationId: request.mutationId }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().status).not.toBe('saved'); expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'B' });
  expect(recovery.list('workspace').snapshots[0].base).toEqual({ revision: 2, fingerprint: 'two' });
});
it('replays failed content exactly before newer queued content and retries after one second', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope);
  api.saveTailoringDraft.mockRejectedValueOnce(Error('offline')).mockImplementationOnce(() => new Promise(() => {}));
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500);
  expect(c.getSnapshot().status).toBe('browser-only'); expect(c.canLeave()).toBe(true);
  c.edit({ ...record.payload, posting: 'B' }); await vi.advanceTimersByTimeAsync(1000);
  expect(api.saveTailoringDraft.mock.calls[1]).toEqual(api.saveTailoringDraft.mock.calls[0]);
});
it('blocks leaving only when neither store contains current content', async () => {
  const { coordinator: c, api } = setup(true); await c.hydrate(envelope); api.saveTailoringDraft.mockRejectedValue(Error('offline'));
  c.edit({ ...record.payload, posting: 'A' }); expect(c.hasUnsavedContent()).toBe(true); await vi.advanceTimersByTimeAsync(500); expect(c.getSnapshot().status).toBe('unsaved');
});
it('pauses on conflict and preserves recovery until asynchronous resolution succeeds', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope); api.saveTailoringDraft.mockRejectedValue({ status: 409 });
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(20000); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1); expect(c.getSnapshot().status).toBe('conflict');
  await expect(c.resolveConflict(async () => { throw Error('offline'); })).rejects.toThrow('offline'); expect(recovery.list('workspace').snapshots).toHaveLength(1);
});
it('requires a choice when server is newer than browser baseline', async () => {
  const { coordinator: c, recovery } = setup(); recovery.write({ workspaceId: 'workspace', draftId: record.id, writerId: 'other', base: envelope.token, mutationId: 'local', localSequence: 1, savedAt: record.savedAt, record: { ...record, payload: { ...record.payload, posting: 'local' } } });
  await c.hydrate({ ...envelope, token: { revision: 2, fingerprint: 'two' } }); expect(c.getSnapshot().status).toBe('conflict'); expect(recovery.list('workspace').snapshots).toHaveLength(1);
});
it('does not let context changes acknowledge content and serializes context after content', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockImplementationOnce(() => new Promise(() => {}));
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.updateContext({ activeStep: 'alignment' });
  const request = api.saveTailoringDraft.mock.calls[0][1]; a.resolve({ ...envelope, mutationId: request.mutationId, token: { revision: 2, fingerprint: 'two' } }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().status).toBe('saved'); expect(api.saveTailoringDraft.mock.calls[1][1]).toMatchObject({ change: 'context', expected: { revision: 2, fingerprint: 'two' } });
});
it('retains newer local content if edits occur while conflict resolution is loading', async () => {
  const { coordinator: c, recovery } = setup(); await c.hydrate(envelope); c.edit({ ...record.payload, posting: 'A' });
  const loaded = deferred<DraftEnvelope>(); const resolving = c.resolveConflict(() => loaded.promise); c.edit({ ...record.payload, posting: 'B' }); loaded.resolve(envelope); await resolving;
  expect(c.getSnapshot().record?.payload).toMatchObject({ posting: 'B' }); expect(recovery.list('workspace').snapshots).toHaveLength(1);
});
it('never overrides a cross-tab conflict with an in-flight acknowledgement', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500);
  recovery.write({ workspaceId: 'workspace', draftId: record.id, writerId: 'other', base: envelope.token, mutationId: 'other', localSequence: 1, savedAt: record.savedAt, record });
  a.resolve({ ...envelope, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0); expect(c.getSnapshot().status).toBe('conflict');
});
it('verifies workspace before writing and retains browser-only new drafts', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(null, record); api.getHealth.mockResolvedValue({ status: 'ok', workspaceDir: '/other', workspaceId: 'other' });
  c.edit({ ...record.payload, posting: 'new' }); await vi.advanceTimersByTimeAsync(500); expect(api.createTailoringDraft).not.toHaveBeenCalled(); expect(recovery.list('workspace').snapshots).toHaveLength(1);
});
it('restores a closed writer and retires its snapshot after the adopted content is saved', async () => {
  const { coordinator: c, api, recovery } = setup(); const local = { ...record, payload: { ...record.payload, posting: 'restored' } };
  recovery.write({ workspaceId: 'workspace', draftId: record.id, writerId: 'closed-tab', base: envelope.token, mutationId: 'old', localSequence: 4, savedAt: record.savedAt, record: local });
  api.saveTailoringDraft.mockImplementation(async (_id, request) => ({ record: local, token: { revision: 2, fingerprint: 'two' }, mutationId: request.mutationId }));
  await c.hydrate(envelope); expect(c.getSnapshot().record?.payload).toMatchObject({ posting: 'restored' }); await vi.advanceTimersByTimeAsync(500); expect(c.getSnapshot().status).toBe('saved'); expect(recovery.list('workspace').snapshots).toHaveLength(0);
});
it('replays a lost create response before updating newly edited content', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(null, record);
  api.createTailoringDraft.mockRejectedValueOnce(Error('response lost')).mockImplementationOnce(async request => ({ ...envelope, mutationId: request.mutationId }));
  api.saveTailoringDraft.mockImplementation(() => new Promise(() => {}));
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.edit({ ...record.payload, posting: 'B' }); await vi.advanceTimersByTimeAsync(1000);
  expect(api.createTailoringDraft.mock.calls[1]).toEqual(api.createTailoringDraft.mock.calls[0]); expect(api.createTailoringDraft.mock.calls[0][0].record).toEqual({ id: record.id, kind: 'setup', payload: { ...record.payload, posting: 'A' }, context: {} }); expect(api.saveTailoringDraft.mock.calls[0][1]).toMatchObject({ payload: { posting: 'B' }, expected: envelope.token }); expect(c.getSnapshot().status).not.toBe('saved');
});
it('retains recovery when a disposed coordinator receives a late acknowledgement', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.dispose(); a.resolve({ ...envelope, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0); expect(recovery.list('workspace').snapshots).toHaveLength(1);
});
it.each([400, 422, 410])('does not automatically retry status %s', async status => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); api.saveTailoringDraft.mockRejectedValue({ status }); c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(60000); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1);
});
it('retains queued navigation context when an external server revision arrives', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope);
  c.updateContext({ activeStep: 'alignment' });
  const fresh = { ...envelope, record: { ...record, revision: 2, payload: { ...record.payload, posting: 'generated' }, context: { diffMode: 'unified' as const } }, token: { revision: 2, fingerprint: 'two' } };
  c.reconcile(fresh);
  expect(c.getSnapshot()).toMatchObject({ status: 'saved', token: fresh.token, record: { payload: { posting: 'generated' }, context: { activeStep: 'alignment', diffMode: 'unified' } } });
  expect(recovery.list('workspace').snapshots[0]).toMatchObject({ base: fresh.token, record: { payload: { posting: 'generated' } } });
  api.saveTailoringDraft.mockImplementation(async (_id, request) => ({ ...fresh, record: { ...fresh.record, context: request.context }, token: { revision: 3, fingerprint: 'three' }, mutationId: request.mutationId }));
  expect((await c.awaitSaved()).token.revision).toBe(3);
  expect(api.saveTailoringDraft.mock.calls[0][1]).toMatchObject({ expected: fresh.token, change: 'context', context: { activeStep: 'alignment', diffMode: 'unified' } });
  expect(recovery.list('workspace').snapshots).toHaveLength(0);
});
it('keeps a stable coordinator for one document and disposes the previous document on navigation', () => {
  const { api, recovery } = setup(); const options = { workspaceId: 'workspace', draftId: record.id, api, recovery };
  const hook = renderHook(({ draftId }) => useTailoringDraft({ ...options, draftId }), { initialProps: { draftId: record.id } }); const original = hook.result.current.coordinator; const dispose = vi.spyOn(original, 'dispose');
  hook.rerender({ draftId: record.id }); expect(hook.result.current.coordinator).toBe(original); hook.rerender({ draftId: 'another-id' }); expect(hook.result.current.coordinator).not.toBe(original); expect(dispose).toHaveBeenCalledOnce(); hook.unmount();
});
it('refreshes a rejected context save and saves latest navigation with a fresh mutation', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope);
  const fresh = { ...envelope, record: { ...record, payload: { ...record.payload, posting: 'generated' } }, token: { revision: 2, fingerprint: 'two' } };
  const fetching = deferred<DraftEnvelope>(); const saving = deferred<DraftAcknowledgement>();
  api.getTailoringDraft.mockReturnValueOnce(fetching.promise);
  api.saveTailoringDraft.mockRejectedValueOnce({ status: 409 }).mockReturnValueOnce(saving.promise);
  c.updateContext({ activeStep: 'alignment' }); const first = c.flush();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.getTailoringDraft).toHaveBeenCalledWith(record.id);
  c.updateContext({ activeStep: 'brief', mobilePane: 'context' });
  let finished = false; const barrier = c.awaitSaved().then(value => { finished = true; return value; });
  fetching.resolve(fresh); await first;
  expect(api.getHealth).toHaveBeenCalledTimes(2);
  const retry = api.saveTailoringDraft.mock.calls[1][1];
  expect(retry).toMatchObject({ expected: fresh.token, change: 'context', context: { activeStep: 'brief', mobilePane: 'context' } });
  expect(retry.mutationId).not.toBe(api.saveTailoringDraft.mock.calls[0][1].mutationId);
  expect(c.getSnapshot().record?.payload).toMatchObject({ posting: 'generated' }); expect(finished).toBe(false);
  saving.resolve({ ...fresh, record: { ...fresh.record, context: retry.context }, token: { revision: 3, fingerprint: 'three' }, mutationId: retry.mutationId });
  expect((await barrier).record.context).toEqual({ activeStep: 'brief', mobilePane: 'context' });
});
it('retains new content typed while a rejected context save refreshes', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope);
  const fetching = deferred<DraftEnvelope>(); api.getTailoringDraft.mockReturnValueOnce(fetching.promise); api.saveTailoringDraft.mockRejectedValueOnce({ status: 409 });
  c.updateContext({ activeStep: 'alignment' }); const saving = c.flush(); await vi.advanceTimersByTimeAsync(0);
  c.edit({ ...record.payload, posting: 'typed during refresh' });
  fetching.resolve({ ...envelope, record: { ...record, payload: { ...record.payload, posting: 'remote' } }, token: { revision: 2, fingerprint: 'two' } }); await saving;
  expect(c.getSnapshot()).toMatchObject({ status: 'conflict', record: { payload: { posting: 'typed during refresh' } } });
  expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'typed during refresh' });
  await vi.advanceTimersByTimeAsync(1000); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1);
});
it.each(['dispose', 'choose-server'] as const)('ignores a late context refresh after %s', async action => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope);
  const fetching = deferred<DraftEnvelope>(); api.getTailoringDraft.mockReturnValueOnce(fetching.promise); api.saveTailoringDraft.mockRejectedValueOnce({ status: 409 });
  c.updateContext({ activeStep: 'alignment' }); const saving = c.flush(); await vi.advanceTimersByTimeAsync(0);
  const chosen = { ...envelope, token: { revision: 4, fingerprint: 'chosen' } };
  if (action === 'dispose') c.dispose(); else await c.resolveConflict(async () => chosen);
  fetching.resolve({ ...envelope, token: { revision: 2, fingerprint: 'late' } }); await saving;
  expect(c.getSnapshot().token).toEqual(action === 'dispose' ? envelope.token : chosen.token);
  expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1);
});
it.each(['completed', 'discarded', 'missing', 'workspace', 'foreign-id', 'kind', 'run-association', 'older'] as const)('does not retry navigation into an unsafe %s draft', async unsafe => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope);
  const fresh: DraftEnvelope = { ...envelope, record: { ...record }, token: { revision: 2, fingerprint: 'two' } };
  if (unsafe === 'completed' || unsafe === 'discarded') fresh.record.lifecycle = unsafe;
  if (unsafe === 'foreign-id') fresh.record.id = 'foreign';
  if (unsafe === 'kind') fresh.record = { ...fresh.record, kind: 'manual' } as DraftRecord;
  if (unsafe === 'run-association') fresh.record.runSlug = 'another-run';
  if (unsafe === 'older') fresh.token = { revision: 0, fingerprint: 'older' };
  api.getTailoringDraft.mockResolvedValue(fresh);
  if (unsafe === 'missing') api.getTailoringDraft.mockRejectedValue({ status: 404 });
  api.saveTailoringDraft.mockRejectedValueOnce({ status: 409 });
  c.updateContext({ activeStep: 'alignment' });
  if (unsafe === 'workspace') api.getHealth.mockResolvedValueOnce({ status: 'ok', workspaceId: 'workspace', workspaceDir: '/workspace' }).mockResolvedValueOnce({ status: 'ok', workspaceId: 'foreign', workspaceDir: '/other' });
  await c.flush(); await vi.advanceTimersByTimeAsync(1000);
  expect(c.getSnapshot()).toMatchObject({ status: 'conflict', token: envelope.token, record: { context: { activeStep: 'alignment' } } });
  expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1); expect(recovery.list('workspace').snapshots).toHaveLength(1);
  if (unsafe === 'workspace') expect(api.getTailoringDraft).not.toHaveBeenCalled();
});
it('replays an uncertain context request exactly before adopting a deferred server revision', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope);
  api.saveTailoringDraft.mockRejectedValueOnce(Error('response lost')).mockRejectedValueOnce({ status: 409 }).mockImplementationOnce(async (_id, request) => ({ ...envelope, token: { revision: 3, fingerprint: 'three' }, mutationId: request.mutationId, record: { ...record, context: request.context, payload: { ...record.payload, posting: 'generated' } } }));
  c.updateContext({ activeStep: 'alignment' }); await c.flush();
  const first = api.saveTailoringDraft.mock.calls[0][1]; c.updateContext({ activeStep: 'brief' });
  const fresh = { ...envelope, record: { ...record, payload: { ...record.payload, posting: 'generated' } }, token: { revision: 2, fingerprint: 'two' } };
  c.reconcile(fresh); api.getTailoringDraft.mockResolvedValue(fresh);
  await c.retry(); await vi.advanceTimersByTimeAsync(0);
  expect(api.saveTailoringDraft.mock.calls[1][1]).toEqual(first);
  expect(api.saveTailoringDraft.mock.calls[2][1]).toMatchObject({ expected: fresh.token, context: { activeStep: 'brief' } });
  expect(c.getSnapshot()).toMatchObject({ status: 'saved', record: { payload: { posting: 'generated' }, context: { activeStep: 'brief' } } });
});
it('keeps generated run payload, artifact tokens, applied metadata and base when navigation is queued', async () => {
  const { coordinator: c, api } = setup();
  const base = { resumeId: 'base', fingerprint: 'base', spec: { profile: { name: 'Sam', title: 'Engineer', email: 's@x.dev' }, summary: 'Engineer', experiences: [], skills: [], education: [] } };
  const run: DraftEnvelope = { ...envelope, record: { ...record, kind: 'run', runSlug: 'acme', base, payload: { proposalTextById: {}, artifactTokens: {} } } };
  await c.hydrate(run); c.updateContext({ activeStep: 'brief', mobilePane: 'context' });
  const analysis = { company: 'Acme', role: 'Engineer', seniority: 'Staff', mission: 'Build', requirements: [], boilerplate: [] };
  const fresh: DraftEnvelope = { token: { revision: 2, fingerprint: 'generated' }, record: { ...run.record, kind: 'run', base: { ...base, fingerprint: 'fresh-base' }, payload: { analysis, proposalTextById: {}, artifactTokens: { analysis: { revision: 1, fingerprint: 'analysis' } } }, appliedContent: { analysis }, savedAt: '2026-10-01T12:00:00.000Z', editedAt: '2026-10-01T12:00:00.000Z' } };
  c.reconcile(fresh);
  expect(c.getSnapshot()).toMatchObject({ token: fresh.token, savedAt: fresh.record.savedAt, record: { ...fresh.record, context: { activeStep: 'brief', mobilePane: 'context' } } });
  api.saveTailoringDraft.mockImplementation(async (_id, request) => ({ ...fresh, record: { ...fresh.record, context: request.context }, token: { revision: 3, fingerprint: 'three' }, mutationId: request.mutationId }));
  expect((await c.awaitSaved()).record.payload).toEqual(fresh.record.payload);
});
it('does not rebase navigation onto a different pinned resume source', async () => {
  const { coordinator: c, api } = setup();
  const base = { resumeId: 'base', fingerprint: 'base', spec: { profile: { name: 'Sam', title: 'Engineer', email: 's@x.dev' }, summary: 'Engineer', experiences: [], skills: [], education: [] } };
  const run: DraftEnvelope = { ...envelope, record: { ...record, kind: 'run', runSlug: 'acme', base, payload: { proposalTextById: {}, artifactTokens: {} } } };
  await c.hydrate(run); c.updateContext({ activeStep: 'brief' });
  c.reconcile({ ...run, record: { ...run.record, base: { ...base, resumeId: 'other' } }, token: { revision: 2, fingerprint: 'two' } });
  expect(c.getSnapshot().status).toBe('conflict'); await vi.advanceTimersByTimeAsync(1000); expect(api.saveTailoringDraft).not.toHaveBeenCalled();
});
it('merges server-owned metadata while preserving edits newer than an acknowledgement', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockImplementationOnce(() => new Promise(() => {}));
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.edit({ ...record.payload, posting: 'B' }); c.updateContext({ activeStep: 'brief' });
  a.resolve({ ...envelope, record: { ...record, revision: 2 }, token: { revision: 2, fingerprint: 'two' }, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().record).toMatchObject({ revision: 2, payload: { posting: 'B' }, context: { activeStep: 'brief' } });
});
it('hydrates known-workspace browser recovery when the server is offline', async () => {
  const { coordinator: c, api, recovery } = setup(); api.getTailoringDraft.mockRejectedValue(Error('offline')); recovery.write({ workspaceId: 'workspace', draftId: record.id, writerId: 'old-tab', base: envelope.token, mutationId: 'local', localSequence: 1, savedAt: record.savedAt, record: { ...record, payload: { ...record.payload, posting: 'offline work' } } });
  await c.hydrate(); expect(c.getSnapshot().record?.payload).toMatchObject({ posting: 'offline work' }); expect(c.getSnapshot().status).toBe('browser-only'); expect(c.canLeave()).toBe(true);
});
it('ignores an older in-flight acknowledgement after choosing a server version', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); const request = api.saveTailoringDraft.mock.calls[0][1]; const chosen = { ...envelope, record: { ...record, payload: { ...record.payload, posting: 'chosen' } }, token: { revision: 3, fingerprint: 'three' } };
  await c.resolveConflict(async () => chosen); a.resolve({ ...envelope, mutationId: request.mutationId }); await vi.advanceTimersByTimeAsync(0); expect(c.getSnapshot().token).toEqual(chosen.token); expect(c.getSnapshot().record?.payload).toMatchObject({ posting: 'chosen' });
});
it.each([false, true])('does not treat its SSE echo before acknowledgement as a conflict (newer local edit: %s)', async newerEdit => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockImplementationOnce(() => new Promise(() => {}));
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500);
  if (newerEdit) c.edit({ ...record.payload, posting: 'B' });
  const own = { ...envelope, record: { ...record, revision: 2, payload: { ...record.payload, posting: 'A' } }, token: { revision: 2, fingerprint: 'two' } };
  c.reconcile(own); expect(c.getSnapshot().status).toBe('saving');
  a.resolve({ ...own, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().status).toBe(newerEdit ? 'saving' : 'saved');
  expect(c.getSnapshot().record?.payload).toMatchObject({ posting: newerEdit ? 'B' : 'A' });
  if (newerEdit) { expect(api.saveTailoringDraft).toHaveBeenCalledTimes(2); expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'B' }); }
});
it('detects a real remote revision received during save after separating the own SSE echo', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.edit({ ...record.payload, posting: 'B' });
  const own = { ...envelope, token: { revision: 2, fingerprint: 'two' } }; const remote = { ...envelope, record: { ...record, revision: 3, payload: { ...record.payload, posting: 'remote' } }, token: { revision: 3, fingerprint: 'three' } };
  c.reconcile(own); c.reconcile(remote); a.resolve({ ...own, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().status).toBe('conflict'); expect(c.getSnapshot().record?.payload).toMatchObject({ posting: 'B' }); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1); expect(recovery.list('workspace').snapshots[0].record.payload).toMatchObject({ posting: 'B' });
});
it('does not reuse deleted recovery durability after conflict resolution when both stores fail', async () => {
  const { coordinator: c, api, recovery } = setup(); await c.hydrate(envelope); c.edit({ ...record.payload, posting: 'A' }); expect(c.canLeave()).toBe(true);
  await c.resolveConflict(async () => envelope); expect(recovery.list('workspace').snapshots).toHaveLength(0);
  vi.spyOn(recovery, 'write').mockReturnValue({ ok: false, key: 'failed', error: 'quota' }); api.saveTailoringDraft.mockRejectedValue(Error('offline'));
  c.edit({ ...record.payload, posting: 'B' }); expect(c.canLeave()).toBe(false); await vi.advanceTimersByTimeAsync(500); expect(c.getSnapshot().status).toBe('unsaved'); expect(c.hasUnsavedContent()).toBe(true);
});
it('awaitSaved waits for active A and newer B to receive matching acknowledgements', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); const b = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.edit({ ...record.payload, posting: 'B' }); let finished = false; const barrier = c.awaitSaved().then(result => { finished = true; return result; });
  a.resolve({ ...envelope, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId, token: { revision: 2, fingerprint: 'two' } }); await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(2);
  b.resolve({ ...envelope, record: { ...record, payload: { ...record.payload, posting: 'B' } }, mutationId: api.saveTailoringDraft.mock.calls[1][1].mutationId, token: { revision: 3, fingerprint: 'three' } });
  expect((await barrier).token).toEqual({ revision: 3, fingerprint: 'three' }); expect(finished).toBe(true);
});
it.each([409, 400, 422, undefined])('awaitSaved rejects failed workspace saves (status %s)', async status => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const error = Object.assign(Error('save failed'), { status }); api.saveTailoringDraft.mockRejectedValue(error); c.edit({ ...record.payload, posting: 'A' }); await expect(c.awaitSaved()).rejects.toBe(error);
});
it('awaitSaved rejects on dispose instead of hanging behind an unanswered request', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); api.saveTailoringDraft.mockImplementation(() => new Promise(() => {})); c.edit({ ...record.payload, posting: 'A' }); const barrier = c.awaitSaved(); const rejected = expect(barrier).rejects.toThrow('disposed'); c.dispose(); await rejected;
});
it.each([400, 422])('allows corrected content and manual retry after validation status %s', async status => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); api.saveTailoringDraft.mockRejectedValueOnce({ status }).mockImplementationOnce(async (_id, request) => ({ ...envelope, record: { ...record, payload: request.payload }, token: { revision: 2, fingerprint: 'two' }, mutationId: request.mutationId }));
  c.edit({ ...record.payload, posting: 'invalid' }); await vi.advanceTimersByTimeAsync(500); c.edit({ ...record.payload, posting: 'corrected' }); expect(c.getSnapshot().status).not.toBe('conflict'); await vi.advanceTimersByTimeAsync(60000); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1);
  await c.retry(); expect(api.saveTailoringDraft.mock.calls[1][1].payload).toMatchObject({ posting: 'corrected' }); expect(c.getSnapshot().status).toBe('saved'); await expect(c.awaitSaved()).resolves.toMatchObject({ token: { revision: 2, fingerprint: 'two' } });
});
it('awaitSaved rejects a deferred remote conflict before releasing the command barrier', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.edit({ ...record.payload, posting: 'B' }); const barrier = c.awaitSaved(); const rejected = expect(barrier).rejects.toThrow('conflict');
  c.reconcile({ ...envelope, token: { revision: 3, fingerprint: 'remote' } }); a.resolve({ ...envelope, token: { revision: 2, fingerprint: 'own' }, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await rejected;
});
it('awaitSaved waits for queued context so its returned token is safe for the next command', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); const context = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockReturnValueOnce(context.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); c.updateContext({ activeStep: 'brief' }); let finished = false; const barrier = c.awaitSaved().then(result => { finished = true; return result; });
  a.resolve({ ...envelope, token: { revision: 2, fingerprint: 'two' }, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false);
  context.resolve({ ...envelope, token: { revision: 3, fingerprint: 'three' }, mutationId: api.saveTailoringDraft.mock.calls[1][1].mutationId }); expect((await barrier).token.revision).toBe(3);
});
it('awaitSaved rejects an untouched new draft without creating default-only content', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(null, record);
  const result = c.awaitSaved().then(() => 'resolved', error => error.message); await vi.advanceTimersByTimeAsync(0);
  const outcome = await Promise.race([result, Promise.resolve('still pending')]); expect(outcome).toMatch(/no durable initial/i); expect(api.createTailoringDraft).not.toHaveBeenCalled();
});
it('awaitSaved settles after an obsolete request finishes following server-version selection', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); const chosen = { ...envelope, token: { revision: 3, fingerprint: 'chosen' } }; await c.resolveConflict(async () => chosen);
  const result = c.awaitSaved().then(value => value.token.fingerprint); a.resolve({ ...envelope, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0);
  expect(await Promise.race([result, Promise.resolve('still pending')])).toBe('chosen');
});
it('drains current edits after an obsolete request finishes even when their debounce already elapsed', async () => {
  const { coordinator: c, api } = setup(); await c.hydrate(envelope); const a = deferred<DraftAcknowledgement>(); const b = deferred<DraftAcknowledgement>(); api.saveTailoringDraft.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  c.edit({ ...record.payload, posting: 'A' }); await vi.advanceTimersByTimeAsync(500); const chosen = { ...envelope, token: { revision: 3, fingerprint: 'chosen' } }; await c.resolveConflict(async () => chosen);
  c.edit({ ...record.payload, posting: 'B' }); await vi.advanceTimersByTimeAsync(500); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(1); const barrier = c.awaitSaved();
  a.resolve({ ...envelope, mutationId: api.saveTailoringDraft.mock.calls[0][1].mutationId }); await vi.advanceTimersByTimeAsync(0); expect(api.saveTailoringDraft).toHaveBeenCalledTimes(2); expect(api.saveTailoringDraft.mock.calls[1][1]).toMatchObject({ expected: chosen.token, payload: { posting: 'B' } });
  b.resolve({ ...envelope, record: { ...record, payload: { ...record.payload, posting: 'B' } }, token: { revision: 4, fingerprint: 'four' }, mutationId: api.saveTailoringDraft.mock.calls[1][1].mutationId }); expect((await barrier).token.revision).toBe(4);
});
