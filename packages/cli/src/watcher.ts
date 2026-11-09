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

export const WATCHER_IGNORE_REGEXES = [
  /.*\.db-(?:wal|shm|journal)$/,
  /.*\.sqlite3?(?:-(?:wal|shm|journal))?$/,
  /(?:^|[\\/])\.leases(?:[\\/]|$)/,
  /(?:^|[\\/])\.cache(?:[\\/]|$)/,
  /(?:^|[\\/])tmp(?:[\\/]|$)/,
  /.*\.tmp\.[a-zA-Z0-9]+$/,
  /(?:^|[\\/])\.featherduster[\\/]jobs(?:[\\/]|$)/,
  /(?:^|[\\/])tailoring[\\/]jobs[\\/][^\\/]+[\\/]snapshots(?:[\\/]|$)/,
  /(?:^|[\\/])tailoring-drafts[\\/]operations(?:[\\/]|$)/,
  /(?:^|[\\/])tailoring-drafts[\\/].*\.lock/,
];

export function isOperationalOrIgnoredPath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, '/');
  for (const regex of WATCHER_IGNORE_REGEXES) {
    if (regex.test(normalized)) return true;
  }
  if (normalized.endsWith('.tmp')) return true;
  return false;
}

export class WorkspaceWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly workspaceDir: string;
  private readonly debounceMs: number;
  private subscribers = new Set<(event: WatcherChangeEvent) => void>();
  private pathTimers = new Map<string, NodeJS.Timeout>();
  private pendingByPath = new Map<string, WatcherChangeEvent>();

  constructor(workspaceDir: string, options?: WorkspaceWatcherOptions) {
    super();
    this.workspaceDir = path.resolve(workspaceDir);
    this.debounceMs = options?.debounceMs ?? 50;
  }

  /**
   * Starts watching the workspace directory.
   */
  start(): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.workspaceDir, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignored: [
        /.*\.db-(?:wal|shm|journal)$/,
        /.*\.sqlite3?(?:-(?:wal|shm|journal))?$/,
        /(?:^|[\\/])\.leases(?:[\\/]|$)/,
        /(?:^|[\\/])\.cache(?:[\\/]|$)/,
        /(?:^|[\\/])tmp(?:[\\/]|$)/,
        /.*\.tmp\.[a-zA-Z0-9]+$/,
        /(?:^|[\\/])\.featherduster[\\/]jobs(?:[\\/]|$)/,
        /(?:^|[\\/])tailoring[\\/]jobs[\\/][^\\/]+[\\/]snapshots(?:[\\/]|$)/,
        /(^|[/\\])\.(?!featherduster)/, // dotfiles except .featherduster
        '**/node_modules/**',
        '**/.git/**',
        '**/*.tmp',
        '**/tailoring-drafts/operations/**',
        '**/tailoring-drafts/*.lock*/**',
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

      if (!relativePath || relativePath === '.') return;
      if (isOperationalOrIgnoredPath(normalizedPath) || isOperationalOrIgnoredPath(relativePath)) return;

      if (relativePath.startsWith('tailoring-drafts/') && !/^tailoring-drafts\/[0-9a-f-]{36}\.json$/i.test(relativePath)) return;

      const changeEvent: WatcherChangeEvent = {
        type,
        path: normalizedPath,
        relativePath,
        timestamp: Date.now(),
      };

      this.pendingByPath.set(normalizedPath, changeEvent);

      const existingTimer = this.pathTimers.get(normalizedPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.pathTimers.delete(normalizedPath);
        const evt = this.pendingByPath.get(normalizedPath);
        this.pendingByPath.delete(normalizedPath);

        if (evt) {
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

      this.pathTimers.set(normalizedPath, timer);
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
    for (const timer of this.pathTimers.values()) {
      clearTimeout(timer);
    }
    this.pathTimers.clear();
    this.pendingByPath.clear();
    this.subscribers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}

export function createScopedWatcher(
  workspaceDir: string,
  listener: (event: WatcherChangeEvent) => void,
  options?: WorkspaceWatcherOptions,
): WorkspaceWatcher {
  const watcher = new WorkspaceWatcher(workspaceDir, options);
  watcher.subscribe(listener);
  watcher.start();
  return watcher;
}
