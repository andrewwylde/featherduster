import { canonicalJson, type DraftAcknowledgement, type DraftContext, type DraftEnvelope, type DraftPayload, type DraftRecord, type DraftUpdate, type RevisionToken } from '@featherduster/core';
import type { ApiClient, DraftSeed } from '../api/client';
import { recoveryKey, type BrowserRecovery, type BrowserRecoverySnapshot } from './recovery';

export type DraftSaveStatus = 'saved' | 'saving' | 'browser-only' | 'unsaved' | 'conflict';
export interface DraftCoordinatorSnapshot {
  record: DraftRecord | null;
  token: RevisionToken | null;
  status: DraftSaveStatus;
  savedAt?: string;
  hasUnsavedContent: boolean;
  conflicts: BrowserRecoverySnapshot[];
  error?: unknown;
}
export interface DraftCoordinatorOptions {
  /** Previously confirmed workspace identity; never derive this from a path or URL. */
  workspaceId: string;
  draftId: string;
  api: Pick<ApiClient, 'getHealth' | 'getTailoringDraft' | 'createTailoringDraft' | 'saveTailoringDraft'>;
  recovery: BrowserRecovery;
  id?: () => string;
  now?: () => string;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}
interface Pending {
  mutationId: string;
  contentSequence: number;
  contextSequence: number;
  change: 'content' | 'context';
  update?: DraftUpdate;
  seed?: DraftSeed;
}
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** One serialized writer. An uncertain request is replayed before sending newer edits. */
export class DraftCoordinator {
  private state: DraftCoordinatorSnapshot = { record: null, token: null, status: 'saved', hasUnsavedContent: false, conflicts: [] };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private savedSequence = 0;
  private browserSequence = -1;
  private contextSequence = 0;
  private savedContextSequence = 0;
  private contextChanges = new Map<keyof DraftContext, number>();
  private mutationId = '';
  private pending?: Pending;
  private deferredServer?: DraftEnvelope;
  private adopted: BrowserRecoverySnapshot[] = [];
  private active = false;
  private disposed = false;
  private verified = false;
  private paused = false;
  private choicePauses = new Set<symbol>();
  private validationPaused = false;
  private attempt = 0;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private readonly timers;
  private readonly newId;
  private readonly now;
  constructor(private readonly options: DraftCoordinatorOptions) {
    this.timers = options.timers ?? {
      setTimeout: (callback: () => void, delay?: number) => globalThis.setTimeout(callback, delay),
      clearTimeout: (timer) => globalThis.clearTimeout(timer),
    };
    this.newId = options.id ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }
  /** Confirmed workspace identity, shared with hosts borrowing this writer. */
  get workspaceId(): string { return this.options.workspaceId; }
  getSnapshot = (): DraftCoordinatorSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  hasUnsavedContent = (): boolean => this.sequence !== this.savedSequence && this.browserSequence !== this.sequence;
  canLeave = (): boolean => !this.hasUnsavedContent();
  private emit(patch: Partial<DraftCoordinatorSnapshot> = {}) {
    this.state = { ...this.state, ...patch, hasUnsavedContent: this.hasUnsavedContent() };
    this.listeners.forEach(listener => listener());
  }
  private schedule(delay = 500) {
    if (this.timer) this.timers.clearTimeout(this.timer);
    if (!this.disposed && !this.paused && this.choicePauses.size === 0) this.timer = this.timers.setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }
  private persist() {
    if (!this.state.record) return;
    const result = this.options.recovery.write({ workspaceId: this.options.workspaceId, draftId: this.options.draftId, writerId: this.options.recovery.writerId, base: this.state.token, mutationId: this.mutationId, localSequence: this.sequence, savedAt: this.now(), record: this.state.record });
    if (result.ok) this.browserSequence = this.sequence;
  }
  /** Preserve a conflict copy without pretending a refresh was a user edit. */
  enterConflict(error?: unknown): void {
    this.paused = true;
    if (this.state.record) {
      if (this.sequence === this.savedSequence) this.sequence += 1;
      if (!this.mutationId) this.mutationId = this.newId();
      this.persist();
    }
    this.emit({ status: 'conflict', conflicts: this.conflictCandidates(), error });
  }
  private conflictCandidates(): BrowserRecoverySnapshot[] {
    const conflicts = this.options.recovery.list(this.options.workspaceId).snapshots.filter(s => s.draftId === this.options.draftId);
    // A quota failure must still expose the in-memory version as a choice.
    if (this.state.record && (this.sequence !== this.savedSequence || this.contextSequence !== this.savedContextSequence) && !conflicts.some(s => s.writerId === this.options.recovery.writerId && s.mutationId === this.mutationId)) conflicts.push({ workspaceId: this.workspaceId, draftId: this.options.draftId, writerId: this.options.recovery.writerId, base: this.state.token, mutationId: this.mutationId, localSequence: this.sequence, savedAt: this.state.record.editedAt, record: this.state.record });
    return conflicts;
  }
  private onReconnect = () => { this.verified = false; if (!this.paused) void this.retry(); };
  private onBeforeUnload = (event: BeforeUnloadEvent) => { if (this.hasUnsavedContent()) { event.preventDefault(); event.returnValue = ''; } };
  /** Attaches browser listeners separately so React StrictMode cleanup can safely reconnect. */
  connect = () => {
    this.disposed = false;
    if (this.unsubscribe) return;
    this.unsubscribe = this.options.recovery.subscribe(event => {
      const incoming = event.snapshot;
      if (incoming?.workspaceId === this.options.workspaceId && incoming.draftId === this.options.draftId && incoming.writerId !== this.options.recovery.writerId && !equal(incoming.record.payload, this.state.record?.payload)) {
        if (this.state.status === 'conflict') this.emit({ conflicts: this.conflictCandidates() });
        else if (this.state.record) this.enterConflict();
      }
    });
    if (typeof window !== 'undefined') { window.addEventListener('online', this.onReconnect); window.addEventListener('focus', this.onReconnect); window.addEventListener('beforeunload', this.onBeforeUnload); }
    if (this.sequence !== this.savedSequence || this.contextSequence !== this.savedContextSequence) this.schedule();
  };
  async hydrate(server?: DraftEnvelope | null, initial?: DraftRecord): Promise<void> {
    this.connect();
    const locals = this.options.recovery.list(this.options.workspaceId).snapshots.filter(s => s.draftId === this.options.draftId);
    let fetched = server;
    let unavailable = false;
    let missing = false;
    if (server === undefined) {
      try {
        const health = await this.options.api.getHealth();
        if (health.workspaceId !== this.options.workspaceId) throw Object.assign(Error('Workspace identity could not be confirmed'), { status: 409 });
        this.verified = true;
        fetched = await this.options.api.getTailoringDraft(this.options.draftId);
      } catch (error) {
        this.verified = false;
        const status = (error as { status?: number })?.status;
        missing = status === 404 || status === 410 || status === 409;
        unavailable = !missing;
        fetched = null;
        this.emit({ error });
        if (!locals.length && !initial && !missing) throw error;
      }
    }
    if (this.disposed) return;
    if (this.sequence !== this.savedSequence || this.contextSequence !== this.savedContextSequence || this.active) { if (fetched) this.reconcile(fetched); return; }
    const baseline = fetched?.token ?? (unavailable ? locals[0]?.base ?? null : null);
    this.emit({ record: fetched?.record ?? initial ?? locals[0]?.record ?? null, token: baseline, savedAt: fetched?.record.savedAt });
    if (missing) { this.paused = true; this.emit({ status: 'conflict', conflicts: locals }); return; }
    if (!locals.length) return;
    // Completed versions never adopt browser content into an autosave writer.
    if (fetched?.record.lifecycle === 'completed') { this.paused = true; this.emit({ status: 'conflict', conflicts: locals }); return; }
    const divergent = locals.some(s => !equal(s.base, baseline)) || locals.some(s => !equal(s.record.payload, locals[0].record.payload));
    if (divergent) { this.paused = true; this.emit({ status: 'conflict', conflicts: locals }); return; }
    const local = [...locals].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
    this.adopted = locals;
    this.sequence = Math.max(1, local.localSequence); this.browserSequence = this.sequence; this.mutationId = this.newId();
    this.contextSequence += 1;
    this.emit({ record: local.record, status: 'browser-only' }); this.persist(); this.schedule();
  }
  edit(payload: DraftPayload): void {
    if (!this.state.record) throw Error('Hydrate a draft before editing');
    this.sequence += 1; this.mutationId = this.newId();
    this.state = { ...this.state, record: { ...this.state.record, payload, editedAt: this.now() } as DraftRecord };
    this.persist();
    this.emit({ status: this.validationPaused ? this.hasUnsavedContent() ? 'unsaved' : 'browser-only' : this.paused ? 'conflict' : 'saving', error: undefined });
    this.schedule();
  }
  updateContext(context: DraftContext): void {
    if (!this.state.record) return;
    this.contextSequence += 1;
    for (const key of new Set([...Object.keys(this.state.record.context), ...Object.keys(context)]) as Set<keyof DraftContext>) {
      if (this.state.record.context[key] !== context[key]) this.contextChanges.set(key, this.contextSequence);
    }
    this.state = { ...this.state, record: { ...this.state.record, context } };
    this.mutationId = this.newId();
    this.persist(); this.emit(); this.schedule();
  }
  async flush(): Promise<void> {
    if (this.active || this.disposed || this.paused || this.choicePauses.size > 0 || !this.state.record) return;
    if (!this.pending && this.sequence === this.savedSequence && this.contextSequence === this.savedContextSequence) return;
    this.active = true;
    const generation = this.generation;
    let acknowledged = false;
    let dispatched: Pending | undefined;
    try {
      if (!this.verified) {
        const health = await this.options.api.getHealth();
        if (health.workspaceId !== this.options.workspaceId) throw Object.assign(Error('Workspace identity could not be confirmed'), { status: 409 });
        this.verified = true;
      }
      if (this.disposed || generation !== this.generation) return;
      if (!this.pending) {
        const record = this.state.record;
        const change = this.sequence !== this.savedSequence ? 'content' : 'context';
        const mutationId = this.newId();
        this.pending = { mutationId, change, contentSequence: this.sequence, contextSequence: this.contextSequence };
        if (this.state.token) this.pending.update = { expected: this.state.token, mutationId, change, ...(change === 'content' ? { payload: record.payload } : {}), context: record.context };
        else {
          if (record.kind === 'run') throw Object.assign(Error('Run drafts must be created by the workspace'), { status: 422 });
          this.pending.seed = { id: record.id, kind: record.kind, payload: record.payload, context: record.context } as DraftSeed;
          this.pending.change = 'content';
        }
      }
      const request = this.pending;
      dispatched = request;
      const ack: DraftAcknowledgement = request.update ? await this.options.api.saveTailoringDraft(this.options.draftId, request.update) : await this.options.api.createTailoringDraft({ record: request.seed!, mutationId: request.mutationId });
      if (this.disposed || generation !== this.generation) return;
      if (ack.mutationId !== request.mutationId) throw Error('Acknowledgement does not match pending mutation');
      this.pending = undefined; this.attempt = 0;
      if (request.change === 'content') this.savedSequence = request.contentSequence;
      this.savedContextSequence = request.contextSequence;
      for (const [key, sequence] of this.contextChanges) if (sequence <= request.contextSequence) this.contextChanges.delete(key);
      const current = this.state.record;
      const merged = {
        ...ack.record,
        ...(this.sequence !== this.savedSequence || request.change === 'context' ? { payload: current.payload, editedAt: current.editedAt } : {}),
        ...(this.contextSequence !== this.savedContextSequence ? { context: current.context } : {}),
      } as DraftRecord;
      this.state = { ...this.state, record: merged, token: ack.token, savedAt: request.change === 'content' ? ack.record.savedAt : this.state.savedAt };
      if (!this.paused && this.sequence === this.savedSequence && this.contextSequence === this.savedContextSequence) {
        this.options.recovery.remove(recoveryKey(this.options.workspaceId, this.options.draftId, this.options.recovery.writerId), this.mutationId);
      } else this.persist();
      if (!this.paused && request.change === 'content') {
        for (const local of this.adopted) this.options.recovery.remove(recoveryKey(local.workspaceId, local.draftId, local.writerId), local.mutationId);
        this.adopted = [];
      }
      this.emit({ status: this.paused ? 'conflict' : this.sequence === this.savedSequence ? 'saved' : 'saving', error: undefined });
      acknowledged = true;
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.verified = false;
      const status = (error as { status?: number })?.status;
      if (status === 409 && dispatched?.change === 'context' && dispatched === this.pending
        && this.sequence === this.savedSequence && !this.paused) {
        // A definitive rejection releases this mutation. Unknown responses keep
        // their original request untouched for exact replay instead.
        this.pending = undefined;
        try {
          const health = await this.options.api.getHealth();
          if (this.disposed || generation !== this.generation) return;
          if (health.workspaceId !== this.options.workspaceId) throw Error('Workspace identity could not be confirmed');
          const fresh = await this.options.api.getTailoringDraft(this.options.draftId);
          if (this.disposed || generation !== this.generation) return;
          if (this.adoptContextRevision(fresh)) {
            this.verified = true;
            acknowledged = true;
            return;
          }
        } catch (refreshError) { error = refreshError; }
        if (this.disposed || generation !== this.generation) return;
      }
      this.validationPaused = status === 400 || status === 422;
      // Validation responses definitively reject this request. Keep uncertain
      // requests for exact replay, but allow corrected content to replace these.
      if (this.validationPaused) this.pending = undefined;
      this.paused = [400, 422, 409, 410].includes(status ?? 0);
      if (status === 409 || status === 410) this.enterConflict(error);
      this.emit({ status: status === 409 || status === 410 ? 'conflict' : this.hasUnsavedContent() ? 'unsaved' : this.sequence === this.savedSequence ? 'saved' : 'browser-only', error });
      if (!this.paused) this.schedule([1000, 2000, 5000, 10000][Math.min(this.attempt++, 3)]);
      return;
    } finally {
      this.active = false;
      if (acknowledged && this.deferredServer) {
        const server = this.deferredServer;
        this.deferredServer = undefined;
        this.reconcile(server);
      }
      // Even an obsolete response releases the active-request gate. Barriers
      // must observe that transition after a server version has been selected.
      if (!this.disposed) this.emit();
      // Completion owns queue draining, including early returns for superseded
      // requests. Failed current requests retain their retry timer/backoff.
      if ((acknowledged || generation !== this.generation) && !this.disposed && !this.paused
        && (this.sequence !== this.savedSequence || this.contextSequence !== this.savedContextSequence)) void this.flush();
    }
  }
  retry = async (): Promise<void> => {
    if (this.state.status === 'conflict') return;
    this.paused = false; this.validationPaused = false; this.verified = false;
    this.emit({ error: undefined });
    if (this.timer) this.timers.clearTimeout(this.timer);
    await this.flush();
  };
  /**
   * Workspace durability barrier for Apply/approval commands. Unlike background
   * flush(), waits through queued edits and context saves, returns the current
   * server token, and rejects on failure, conflict, or disposal. Browser recovery
   * alone does not satisfy this barrier. Call retry() after correcting a failure.
   */
  awaitSaved = (): Promise<DraftEnvelope> => new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const check = (): boolean => {
      const error = this.disposed ? Error('Draft coordinator disposed')
        : this.state.error ?? (this.paused || this.choicePauses.size > 0 || this.state.status === 'conflict' ? Error('Draft save is paused; finish the current choice, resolve the conflict, or retry corrected content')
          : !this.state.record ? Error('Draft has not been hydrated')
            : !this.state.token && !this.pending && this.sequence === this.savedSequence && this.contextSequence === this.savedContextSequence ? Error('Draft has no durable initial workspace version; edit it before saving') : undefined);
      if (error) { unsubscribe(); reject(error); return true; }
      if (!this.active && !this.pending && !this.deferredServer && this.sequence === this.savedSequence && this.contextSequence === this.savedContextSequence && this.state.record && this.state.token) {
        unsubscribe(); resolve({ record: this.state.record, token: this.state.token }); return true;
      }
      return false;
    };
    unsubscribe = this.subscribe(check);
    if (!check()) void this.flush();
  });
  /** SSE refresh never replaces edits awaiting acknowledgement. */
  reconcile(server: DraftEnvelope): void {
    if (equal(server.token, this.state.token)) return;
    // Events can precede their HTTP acknowledgement. Compare only after the
    // pending request has a receipt, including when a lost response is replayed.
    if (this.active || this.pending) {
      if (!this.deferredServer || server.token.revision >= this.deferredServer.token.revision) this.deferredServer = server;
      return;
    }
    if (this.state.token && server.token.revision < this.state.token.revision) return;
    if (this.paused || this.sequence !== this.savedSequence) {
      this.enterConflict(); return;
    }
    if (this.contextSequence !== this.savedContextSequence) {
      if (!this.adoptContextRevision(server)) this.enterConflict();
      else this.schedule();
      return;
    }
    this.emit({ record: server.record, token: server.token, savedAt: server.record.savedAt });
  }
  /** Only navigation can be rebased; content always requires an explicit choice. */
  private adoptContextRevision(server: DraftEnvelope): boolean {
    const current = this.state.record;
    if (!current || this.paused || this.sequence !== this.savedSequence || this.pending
      || current.lifecycle !== 'draft' || server.record.lifecycle !== 'draft'
      || server.record.id !== this.options.draftId || server.record.kind !== current.kind
      || server.record.runSlug !== current.runSlug || server.record.parentCompletionId !== current.parentCompletionId
      || server.record.base?.resumeId !== current.base?.resumeId
      || !this.state.token || server.token.revision <= this.state.token.revision) return false;
    const context = { ...server.record.context };
    for (const key of this.contextChanges.keys()) {
      Object.assign(context, { [key]: current.context[key] });
      if (current.context[key] === undefined) delete context[key];
    }
    this.state = { ...this.state, record: { ...server.record, context }, token: server.token, savedAt: server.record.savedAt, error: undefined };
    this.persist(); this.emit();
    return true;
  }
  /** Caller loads/forks asynchronously; snapshots survive failed actions. */
  pauseForChoice(): () => void {
    const hold = Symbol('draft-choice');
    this.choicePauses.add(hold);
    return () => { if (this.choicePauses.delete(hold) && this.choicePauses.size === 0) this.schedule(); };
  }
  async resolveConflict(action: () => Promise<DraftEnvelope>, selected?: BrowserRecoverySnapshot): Promise<DraftEnvelope> {
    // Command I/O needs a temporary hold, not a new conflict. A failed discard
    // can then be cancelled without releasing a real conflict received meanwhile.
    const release = this.pauseForChoice();
    const sequence = this.sequence;
    const contextSequence = this.contextSequence;
    const candidates = selected ? [selected] : this.options.recovery.list(this.options.workspaceId).snapshots.filter(s => s.draftId === this.options.draftId && (s.writerId === this.options.recovery.writerId || this.adopted.some(a => a.writerId === s.writerId && a.mutationId === s.mutationId)));
    try {
      const result = await action();
      if (this.disposed) return result;
      if (result.record.id !== this.options.draftId) {
        for (const local of candidates) this.options.recovery.remove(recoveryKey(local.workspaceId, local.draftId, local.writerId), local.mutationId);
        return result; // A successful fork is routed by the caller.
      }
      if (sequence !== this.sequence || contextSequence !== this.contextSequence) {
        this.paused = true; this.emit({ status: 'conflict' }); return result;
      }
      this.generation += 1;
      this.pending = undefined; this.paused = false; this.sequence = 0; this.savedSequence = 0; this.contextSequence = 0; this.savedContextSequence = 0;
      this.validationPaused = false;
      this.contextChanges.clear();
      this.browserSequence = -1; this.mutationId = ''; this.adopted = []; this.deferredServer = undefined;
      for (const local of candidates) this.options.recovery.remove(recoveryKey(local.workspaceId, local.draftId, local.writerId), local.mutationId);
      this.emit({ record: result.record, token: result.token, savedAt: result.record.savedAt, status: 'saved', conflicts: [], error: undefined });
      return result;
    } finally { release(); }
  }
  dispose = (): void => {
    this.disposed = true;
    this.listeners.forEach(listener => listener());
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.unsubscribe?.(); this.unsubscribe = undefined;
    if (typeof window !== 'undefined') { window.removeEventListener('online', this.onReconnect); window.removeEventListener('focus', this.onReconnect); window.removeEventListener('beforeunload', this.onBeforeUnload); }
    this.listeners.clear();
  };
}
