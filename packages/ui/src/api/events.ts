import { CorpusNotificationSchema, type CorpusNotification } from '@featherduster/core';
import { DraftRevisionTokenSchema, type RevisionToken } from '@featherduster/core';
export interface DraftChangeEvent { draftId: string; token?: RevisionToken }
export type DraftChangeListener = (event: DraftChangeEvent) => void;
export type ChangeListener = (event: any) => void;
export type TailoringListener = (event: any) => void;
export type StatusListener = (connected: boolean) => void;

class SseClient {
  private eventSource: EventSource | null = null;
  private changeListeners = new Set<ChangeListener>();
  private draftListeners = new Set<DraftChangeListener>();
  private tailoringListeners = new Set<TailoringListener>();
  private corpusListeners = new Set<(event: CorpusNotification) => void>();
  private jobsListeners = new Set<ChangeListener>();
  private workspaceIntegrityListeners = new Set<ChangeListener>();
  private statusListeners = new Set<StatusListener>();
  private connected = false;
  private retryAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  isConnected(): boolean {
    return this.connected;
  }

  private totalListeners(): number {
    return this.draftListeners.size + this.corpusListeners.size + this.jobsListeners.size + this.workspaceIntegrityListeners.size + this.changeListeners.size + this.tailoringListeners.size + this.statusListeners.size;
  }

  private setConnected(status: boolean) {
    if (this.connected !== status) {
      this.connected = status;
      for (const listener of this.statusListeners) {
        try {
          listener(status);
        } catch {
          // Ignore subscriber error
        }
      }
    }
  }

  private connect() {
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }

    if (this.eventSource || typeof EventSource === 'undefined') {
      return;
    }

    try {
      const source = new EventSource('/api/events');
      this.eventSource = source;

      source.addEventListener('connected', () => {
        this.retryAttempts = 0;
        this.setConnected(true);
      });

      source.addEventListener('ping', () => {
        this.retryAttempts = 0;
        this.setConnected(true);
      });

      source.addEventListener('change', (e: MessageEvent) => {
        let data: any;
        try {
          data = JSON.parse(e.data);
        } catch {
          data = e.data;
        }
        for (const listener of this.changeListeners) {
          try {
            listener(data);
          } catch {
            // Ignore subscriber error
          }
        }
      });

      source.addEventListener('tailoring', (e: MessageEvent) => {
        let data: any;
        try {
          data = JSON.parse(e.data);
        } catch {
          data = e.data;
        }
        for (const listener of this.tailoringListeners) {
          try {
            listener(data);
          } catch {
            // Ignore subscriber error
          }
        }
      });

      source.addEventListener('corpus', (e: MessageEvent) => {
        try { const data = CorpusNotificationSchema.parse(JSON.parse(e.data)); for (const listener of this.corpusListeners) { try { listener(data); } catch { /* isolate observers */ } } } catch { /* invalid frame */ }
      });

      source.addEventListener('jobs', (e: MessageEvent) => {
        let data: unknown;
        try { data = JSON.parse(e.data); } catch { return; }
        for (const listener of this.jobsListeners) { try { listener(data); } catch { /* isolate observers */ } }
      });

      source.addEventListener('workspace_integrity', (e: MessageEvent) => {
        let data: any;
        try {
          data = JSON.parse(e.data);
        } catch {
          data = e.data;
        }
        for (const listener of this.workspaceIntegrityListeners) {
          try {
            listener(data);
          } catch {
            // Ignore subscriber error
          }
        }
      });

      source.addEventListener('tailoring-draft', (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data);
          if (!data || typeof data !== 'object' || !('draftId' in data) || typeof data.draftId !== 'string') return;
          const token = 'token' in data ? DraftRevisionTokenSchema.parse(data.token) : undefined;
          for (const listener of this.draftListeners) {
            try { listener({ draftId: data.draftId, token }); } catch { /* Isolate listeners. */ }
          }
        } catch { /* Ignore malformed metadata events. */ }
      });

      source.onopen = () => {
        this.retryAttempts = 0;
        this.setConnected(true);
      };

      source.onerror = () => {
        this.setConnected(false);
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        // Only schedule reconnect if there are still active subscribers
        if (this.totalListeners() > 0) {
          const delay = Math.min(1000 * Math.pow(2, this.retryAttempts), 30000) + Math.random() * 500;
          this.retryAttempts++;
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
          }, delay);
        }
      };
    } catch {
      this.setConnected(false);
      this.eventSource = null;
      if (this.totalListeners() > 0) {
        const delay = Math.min(1000 * Math.pow(2, this.retryAttempts), 30000) + Math.random() * 500;
        this.retryAttempts++;
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
        }, delay);
      }
    }
  }

  private scheduleDisconnectIfOrphaned() {
    if (this.totalListeners() === 0 && this.eventSource) {
      // Delay closing slightly so fast unmount/remount cycles (e.g. React StrictMode) don't thrash connections
      if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = setTimeout(() => {
        this.disconnectTimeout = null;
        if (this.totalListeners() === 0) {
          this.close();
        }
      }, 5000);
    }
  }

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    this.connect();
    return () => {
      this.changeListeners.delete(listener);
      this.scheduleDisconnectIfOrphaned();
    };
  }

  onDraftChange(listener: DraftChangeListener): () => void {
    this.draftListeners.add(listener);
    this.connect();
    return () => { this.draftListeners.delete(listener); this.scheduleDisconnectIfOrphaned(); };
  }

  onTailoring(listener: TailoringListener): () => void {
    this.tailoringListeners.add(listener);
    this.connect();
    return () => {
      this.tailoringListeners.delete(listener);
      this.scheduleDisconnectIfOrphaned();
    };
  }

  onCorpus(listener: (event: CorpusNotification) => void): () => void {
    this.corpusListeners.add(listener); this.connect();
    return () => { this.corpusListeners.delete(listener); this.scheduleDisconnectIfOrphaned(); };
  }

  onWorkspaceIntegrity(listener: ChangeListener): () => void {
    this.workspaceIntegrityListeners.add(listener);
    this.connect();
    return () => {
      this.workspaceIntegrityListeners.delete(listener);
      this.scheduleDisconnectIfOrphaned();
    };
  }

  onTopic(topic: string, listener: ChangeListener): () => void {
    if (topic === 'workspace_integrity') {
      return this.onWorkspaceIntegrity(listener);
    }
    if (topic === 'corpus') {
      return this.onCorpus(listener);
    }
    if (topic === 'jobs' || topic.startsWith('jobs:')) {
      return this.onJobs((data: any) => {
        if (topic === 'jobs') {
          listener(data);
        } else {
          const jobId = topic.slice(5);
          if (data && (data.job_id === jobId || data.id === jobId)) {
            listener(data);
          }
        }
      });
    }
    return this.onChange(listener);
  }

  onJobs(listener: ChangeListener): () => void {
    this.jobsListeners.add(listener);
    this.connect();
    return () => { this.jobsListeners.delete(listener); this.scheduleDisconnectIfOrphaned(); };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.connected);
    this.connect();
    return () => {
      this.statusListeners.delete(listener);
      this.scheduleDisconnectIfOrphaned();
    };
  }

  close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.setConnected(false);
    this.retryAttempts = 0;
  }

  resetForTesting() {
    this.close();
    this.corpusListeners.clear();
    this.jobsListeners.clear();
    this.workspaceIntegrityListeners.clear();
    this.changeListeners.clear();
    this.tailoringListeners.clear();
    this.draftListeners.clear();
    this.statusListeners.clear();
  }
}

export const sseClient = new SseClient();
