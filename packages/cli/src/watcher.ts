import { EventEmitter } from 'node:events';
import path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';

export interface WatcherChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  relativePath: string;
  timestamp: number;
}

export interface WorkspaceWatcherOptions {
  debounceMs?: number;
}

export class WorkspaceWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly workspaceDir: string;
  private readonly debounceMs: number;
  private subscribers = new Set<(event: WatcherChangeEvent) => void>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingEvents: WatcherChangeEvent[] = [];

  constructor(workspaceDir: string, options?: WorkspaceWatcherOptions) {
    super();
    this.workspaceDir = path.resolve(workspaceDir);
    this.debounceMs = options?.debounceMs ?? 100;
  }

  /**
   * Starts watching the evidence, rubrics, resumes, and .featherduster directories.
   */
  start(): void {
    if (this.watcher) return;

    const watchTargets = [
      path.join(this.workspaceDir, 'evidence'),
      path.join(this.workspaceDir, 'rubrics'),
      path.join(this.workspaceDir, 'resumes'),
      path.join(this.workspaceDir, '.featherduster'),
    ];

    this.watcher = chokidar.watch(watchTargets, {
      ignoreInitial: true,
      persistent: true,
      ignored: [
        /(^|[/\\])\.(?!featherduster)/, // dotfiles except .featherduster
        '**/node_modules/**',
        '**/.git/**',
        '**/*.tmp',
      ],
    });

    this.watcher.on('error', (err) => {
      this.emit('error', err);
    });

    const handleEvent = (type: 'add' | 'change' | 'unlink', filePath: string) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedWorkspace = this.workspaceDir.replace(/\\/g, '/');
      const relativePath = normalizedPath.startsWith(normalizedWorkspace)
        ? normalizedPath.slice(normalizedWorkspace.length).replace(/^\//, '')
        : path.relative(this.workspaceDir, filePath).replace(/\\/g, '/');

      const changeEvent: WatcherChangeEvent = {
        type,
        path: normalizedPath,
        relativePath,
        timestamp: Date.now(),
      };

      this.pendingEvents.push(changeEvent);

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        const events = [...this.pendingEvents];
        this.pendingEvents = [];
        this.debounceTimer = null;

        for (const evt of events) {
          this.emit('change', evt);
          for (const sub of this.subscribers) {
            try {
              sub(evt);
            } catch {
              // Ignore subscriber errors
            }
          }
        }
      }, this.debounceMs);
    };

    this.watcher.on('add', (fp) => handleEvent('add', fp));
    this.watcher.on('change', (fp) => handleEvent('change', fp));
    this.watcher.on('unlink', (fp) => handleEvent('unlink', fp));
  }

  /**
   * Subscribes a listener to change events and returns an unsubscribe function.
   */
  subscribe(listener: (event: WatcherChangeEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /**
   * Closes the underlying file watcher and stops all timers.
   */
  async close(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.subscribers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
