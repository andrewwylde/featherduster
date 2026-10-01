import { DraftRecordSchema, DraftRevisionTokenSchema, type DraftRecord, type DraftRevisionToken } from '@featherduster/core';

export const RECOVERY_PREFIX = 'featherduster:tailoring:v1:';

export function recoveryKey(workspaceId: string, draftId: string, writerId: string): string {
  return `${RECOVERY_PREFIX}${workspaceId}:${draftId}:${writerId}`;
}

export interface BrowserRecoverySnapshot {
  workspaceId: string;
  draftId: string;
  writerId: string;
  base: DraftRevisionToken | null;
  mutationId: string;
  localSequence: number;
  savedAt: string;
  record: DraftRecord;
}
export type RecoveryResult =
  | { ok: true; key: string; snapshot: BrowserRecoverySnapshot }
  | { ok: false; key: string; error: string };
export type RecoveryRemoveResult =
  | { ok: true; key: string; removed: boolean }
  | { ok: false; key: string; error: string };
export interface RecoveryListError { key: string; message: string }
export interface RecoveryListResult { snapshots: BrowserRecoverySnapshot[]; errors: RecoveryListError[] }
export interface RecoveryNotification { type: 'write' | 'remove'; key: string; snapshot?: BrowserRecoverySnapshot }
export interface BrowserRecoveryOptions {
  storage?: Storage;
  writerId?: string;
  channel?: BroadcastChannel;
  channelName?: string;
  window?: Window;
}

function uuid(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error('Secure UUID generation is unavailable');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const PAGE_WRITER_ID = uuid();

function parseSnapshot(value: string): { snapshot?: BrowserRecoverySnapshot; error?: string } {
  try {
    const raw: unknown = JSON.parse(value);
    if (raw === null || typeof raw !== 'object') return { error: 'Recovery value is not an object' };
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.workspaceId !== 'string' || !candidate.workspaceId || typeof candidate.draftId !== 'string' || !candidate.draftId || typeof candidate.writerId !== 'string' || !candidate.writerId || typeof candidate.mutationId !== 'string' || !candidate.mutationId || typeof candidate.localSequence !== 'number' || !Number.isSafeInteger(candidate.localSequence) || candidate.localSequence < 0 || typeof candidate.savedAt !== 'string' || Number.isNaN(Date.parse(candidate.savedAt))) return { error: 'Recovery metadata is malformed' };
    if (candidate.base !== null && !DraftRevisionTokenSchema.safeParse(candidate.base).success) return { error: 'Recovery base token is malformed' };
    const parsed = DraftRecordSchema.safeParse(candidate.record);
    if (!parsed.success) return { error: 'Recovery draft record is malformed' };
    if (parsed.data.id !== candidate.draftId) return { error: 'Recovery draft ID does not match its record ID' };
    return { snapshot: { ...candidate, record: parsed.data } as BrowserRecoverySnapshot };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

function validKey(key: string): boolean {
  const parts = key.slice(RECOVERY_PREFIX.length).split(':');
  return key.startsWith(RECOVERY_PREFIX) && parts.length === 3 && parts.every(Boolean);
}

export class BrowserRecovery {
  readonly writerId: string;
  private readonly storage?: Storage;
  private readonly storageError?: string;
  private readonly pageWindow?: Window;
  private readonly channel?: BroadcastChannel;
  private readonly listeners = new Set<(notification: RecoveryNotification) => void>();
  private readonly onStorageEvent: (event: StorageEvent) => void;
  private readonly onChannelMessage: (event: MessageEvent<RecoveryNotification>) => void;

  constructor(options: BrowserRecoveryOptions = {}) {
    this.writerId = options.writerId ?? PAGE_WRITER_ID;
    this.pageWindow = options.window ?? (typeof window !== 'undefined' ? window : undefined);
    if (options.storage) {
      this.storage = options.storage;
    } else {
      try {
        this.storage = this.pageWindow?.localStorage ?? globalThis.localStorage;
      } catch (error) {
        this.storageError = error instanceof Error ? error.message : String(error);
      }
    }
    if (options.channel) {
      this.channel = options.channel;
    } else if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(options.channelName ?? 'featherduster:tailoring:v1');
      } catch { /* optional */ }
    }
    this.onStorageEvent = (event) => {
      if (!event.key || !validKey(event.key)) return;
      if (event.newValue === null) {
        this.notify({ type: 'remove', key: event.key });
        return;
      }
      const parsed = parseSnapshot(event.newValue);
      if (parsed.snapshot && recoveryKey(parsed.snapshot.workspaceId, parsed.snapshot.draftId, parsed.snapshot.writerId) === event.key) {
        this.notify({ type: 'write', key: event.key, snapshot: parsed.snapshot });
      }
    };
    this.onChannelMessage = (event) => {
      const notification = event.data;
      if (!notification || !validKey(notification.key)) return;
      const validWrite = notification.type === 'write' && notification.snapshot && recoveryKey(notification.snapshot.workspaceId, notification.snapshot.draftId, notification.snapshot.writerId) === notification.key;
      if (notification.type === 'remove' || validWrite) {
        this.notify(notification);
      }
    };
    if (typeof this.pageWindow?.addEventListener === 'function') this.pageWindow.addEventListener('storage', this.onStorageEvent);
    if (typeof this.channel?.addEventListener === 'function') this.channel.addEventListener('message', this.onChannelMessage);
  }

  write(snapshot: BrowserRecoverySnapshot): RecoveryResult {
    const key = recoveryKey(snapshot.workspaceId, snapshot.draftId, snapshot.writerId);
    if (snapshot.draftId !== snapshot.record.id) return { ok: false, key, error: 'Recovery draft ID does not match its record ID' };
    if (!this.storage) return { ok: false, key, error: this.storageError ?? 'Browser storage is unavailable' };
    let serialized: string;
    try {
      serialized = JSON.stringify(snapshot);
    } catch (error) {
      return { ok: false, key, error: error instanceof Error ? error.message : String(error) };
    }
    const parsed = parseSnapshot(serialized);
    if (!parsed.snapshot || recoveryKey(parsed.snapshot.workspaceId, parsed.snapshot.draftId, parsed.snapshot.writerId) !== key) {
      return { ok: false, key, error: parsed.error ?? 'Invalid recovery snapshot' };
    }
    try {
      this.storage.setItem(key, serialized);
      this.publish({ type: 'write', key, snapshot: parsed.snapshot });
      return { ok: true, key, snapshot: parsed.snapshot };
    } catch (error) {
      return { ok: false, key, error: error instanceof Error ? error.message : String(error) };
    }
  }

  list(workspaceId: string): RecoveryListResult {
    const snapshots: BrowserRecoverySnapshot[] = [];
    const errors: RecoveryListError[] = [];
    if (!this.storage) {
      return { snapshots, errors: [{ key: RECOVERY_PREFIX, message: this.storageError ?? 'Browser storage is unavailable' }] };
    }
    let length: number;
    try {
      length = this.storage.length;
    } catch (error) {
      return { snapshots, errors: [{ key: RECOVERY_PREFIX, message: error instanceof Error ? error.message : String(error) }] };
    }
    for (let index = 0; index < length; index += 1) {
      let key: string | null;
      try {
        key = this.storage.key(index);
      } catch (error) {
        errors.push({ key: `${RECOVERY_PREFIX}index:${index}`, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!key?.startsWith(RECOVERY_PREFIX)) continue;
      if (!validKey(key)) {
        errors.push({ key, message: 'Recovery key is malformed' });
        continue;
      }
      let raw: string | null;
      try {
        raw = this.storage.getItem(key);
      } catch (error) {
        errors.push({ key, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (raw === null) continue;
      const parsed = parseSnapshot(raw);
      if (!parsed.snapshot) {
        errors.push({ key, message: parsed.error ?? 'Recovery value is malformed' });
        continue;
      }
      if (recoveryKey(parsed.snapshot.workspaceId, parsed.snapshot.draftId, parsed.snapshot.writerId) !== key) {
        errors.push({ key, message: 'Recovery key does not match embedded identity' });
        continue;
      }
      if (parsed.snapshot.workspaceId === workspaceId) snapshots.push(parsed.snapshot);
    }
    return { snapshots, errors };
  }

  remove(key: string, expectedMutationId: string): RecoveryRemoveResult {
    if (!this.storage) return { ok: false, key, error: this.storageError ?? 'Browser storage is unavailable' };
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) return { ok: true, key, removed: false };
      const parsed = parseSnapshot(raw);
      const matches = parsed.snapshot && recoveryKey(parsed.snapshot.workspaceId, parsed.snapshot.draftId, parsed.snapshot.writerId) === key && parsed.snapshot.mutationId === expectedMutationId;
      if (!matches) return { ok: true, key, removed: false };
      this.storage.removeItem(key);
      this.publish({ type: 'remove', key });
      return { ok: true, key, removed: true };
    } catch (error) {
      return { ok: false, key, error: error instanceof Error ? error.message : String(error) };
    }
  }

  subscribe(listener: (notification: RecoveryNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (typeof this.pageWindow?.removeEventListener === 'function') this.pageWindow.removeEventListener('storage', this.onStorageEvent);
    if (typeof this.channel?.removeEventListener === 'function') this.channel.removeEventListener('message', this.onChannelMessage);
    try { this.channel?.close(); } catch { /* disposed */ }
    this.listeners.clear();
  }

  private publish(notification: RecoveryNotification): void {
    this.notify(notification);
    try { this.channel?.postMessage(notification); } catch { /* best effort */ }
  }

  private notify(notification: RecoveryNotification): void {
    for (const listener of this.listeners) {
      try { listener(notification); } catch { /* listener failures do not undo writes */ }
    }
  }
}
