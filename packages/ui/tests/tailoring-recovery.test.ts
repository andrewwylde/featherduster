/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRecovery, recoveryKey, type BrowserRecoverySnapshot } from '../src/tailoring-drafts/recovery.js';

const snapshot = (overrides: Partial<BrowserRecoverySnapshot> = {}): BrowserRecoverySnapshot => ({
  workspaceId: 'workspace-a',
  draftId: '00000000-0000-4000-8000-000000000001',
  writerId: 'writer-a',
  base: null,
  mutationId: 'mutation-a',
  localSequence: 1,
  savedAt: '2026-09-30T12:00:00.000Z',
  record: {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'setup',
    lifecycle: 'draft',
    revision: 0,
    createdAt: '2026-09-30T12:00:00.000Z',
    editedAt: '2026-09-30T12:00:00.000Z',
    savedAt: '2026-09-30T12:00:00.000Z',
    base: null,
    payload: { posting: '', label: '', baseResumeId: '', runner: '' },
    context: {},
    appliedContent: {},
  },
  ...overrides,
});

describe('BrowserRecovery', () => {
  beforeEach(() => localStorage.clear());

  it('writes and reads a complete snapshot synchronously', () => {
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    const value = snapshot();
    expect(recovery.write(value)).toMatchObject({ ok: true, key: recoveryKey('workspace-a', value.draftId, 'writer-a') });
    expect(recovery.list('workspace-a')).toEqual({ snapshots: [value], errors: [] });
  });

  it('isolates records by workspace while scanning all writers', () => {
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    recovery.write(snapshot());
    recovery.write(snapshot({ workspaceId: 'workspace-b', mutationId: 'mutation-b' }));
    expect(recovery.list('workspace-a').snapshots).toHaveLength(1);
    expect(recovery.list('workspace-b').snapshots).toHaveLength(1);
  });

  it('reports quota failures without claiming a durable write', () => {
    const storage = { ...localStorage, setItem: vi.fn(() => { throw new DOMException('quota', 'QuotaExceededError'); }) } as unknown as Storage;
    const recovery = new BrowserRecovery({ storage, writerId: 'writer-a' });
    expect(recovery.write(snapshot()).ok).toBe(false);
  });

  it('keeps independent writers and discovers a closed tab snapshot', () => {
    const first = new BrowserRecovery({ writerId: 'writer-a' });
    const second = new BrowserRecovery({ writerId: 'writer-b' });
    first.write(snapshot());
    second.write(snapshot({ writerId: 'writer-b', mutationId: 'mutation-b', localSequence: 2 }));
    expect(new BrowserRecovery({ writerId: 'new-page' }).list('workspace-a').snapshots).toHaveLength(2);
  });

  it('removes only the acknowledged mutation and preserves newer pending data', () => {
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    const value = snapshot();
    recovery.write(value);
    expect(recovery.remove(recoveryKey(value.workspaceId, value.draftId, value.writerId), 'older')).toMatchObject({ ok: true, removed: false });
    expect(recovery.remove(recoveryKey(value.workspaceId, value.draftId, value.writerId), value.mutationId)).toMatchObject({ ok: true, removed: true });
  });

  it('skips malformed records without overwriting their raw value', () => {
    const key = recoveryKey('workspace-a', snapshot().draftId, 'closed-writer');
    localStorage.setItem(key, '{malformed');
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    expect(recovery.list('workspace-a').snapshots).toEqual([]);
    expect(recovery.list('workspace-a').errors).toHaveLength(1);
    expect(localStorage.getItem(key)).toBe('{malformed');
  });

  it('notifies subscribers and stops notifying after disposal', () => {
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    const listener = vi.fn();
    recovery.subscribe(listener);
    recovery.write(snapshot());
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'write' }));
    recovery.dispose();
    recovery.write(snapshot({ mutationId: 'mutation-after-dispose' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns an explicit failure when snapshot serialization fails', () => {
    const value = snapshot() as BrowserRecoverySnapshot & { circular?: unknown };
    value.circular = value;
    expect(new BrowserRecovery({ writerId: 'writer-a' }).write(value).ok).toBe(false);
  });

  it('uses one UUID writer identity for the page lifetime', () => {
    const first = new BrowserRecovery();
    const second = new BrowserRecovery();
    expect(first.writerId).toBe(second.writerId);
    expect(first.writerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('reports denied storage and scan failures explicitly', () => {
    const deniedWindow = { get localStorage(): Storage { throw new Error('denied'); } } as unknown as Window;
    const denied = new BrowserRecovery({ window: deniedWindow });
    expect(denied.list('workspace-a').errors[0].message).toContain('denied');
    const brokenStorage = {
      get length(): number { throw new Error('length failed'); },
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
    } as unknown as Storage;
    expect(new BrowserRecovery({ storage: brokenStorage }).list('workspace-a').errors[0].message).toContain('length failed');
  });

  it('rejects identity mismatches and reports key mismatches without overwriting', () => {
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    const value = snapshot({ draftId: '00000000-0000-4000-8000-000000000002' });
    expect(recovery.write(value).ok).toBe(false);
    const key = recoveryKey('workspace-a', snapshot().draftId, 'writer-a');
    localStorage.setItem(key, JSON.stringify({ ...snapshot(), writerId: 'other-writer' }));
    expect(recovery.list('workspace-a').errors).toHaveLength(1);
    expect(localStorage.getItem(key)).toContain('other-writer');
  });

  it('delivers storage removal events', () => {
    const recovery = new BrowserRecovery({ writerId: 'writer-a' });
    const listener = vi.fn();
    recovery.subscribe(listener);
    const value = snapshot();
    window.dispatchEvent(new StorageEvent('storage', { key: recoveryKey(value.workspaceId, value.draftId, value.writerId), oldValue: JSON.stringify(value), newValue: null }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'remove' }));
  });
});
