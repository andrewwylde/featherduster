import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createScopedWatcher } from '../src/watcher.js';
import { createApp } from '../src/server.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createScopedWatcher', () => {
  let testDir: string;
  let watcher: ReturnType<typeof createScopedWatcher> | null = null;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'watcher-test-'));
    await fs.mkdir(path.join(testDir, '.leases'), { recursive: true });
    await fs.mkdir(path.join(testDir, '.cache'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'corpus'), { recursive: true });
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('ignores sqlite wal/shm and operational lease writes while coalescing rapid user file changes', async () => {
    const events: string[] = [];
    watcher = createScopedWatcher(testDir, (event) => events.push(event.path));

    // Write operational sidecars
    await fs.writeFile(path.join(testDir, 'featherduster.db-wal'), 'data');
    await fs.writeFile(path.join(testDir, 'featherduster.db-shm'), 'data');
    await fs.writeFile(path.join(testDir, '.leases', 'worker.lock'), 'data');

    // Rapidly write evidence file
    await fs.writeFile(path.join(testDir, 'corpus', 'facts.yaml'), 'v1');
    await fs.writeFile(path.join(testDir, 'corpus', 'facts.yaml'), 'v2');

    await sleep(150);
    expect(events.filter(e => e.includes('db-wal') || e.includes('.leases'))).toHaveLength(0);
    expect(events.filter(e => e.includes('facts.yaml'))).toHaveLength(1);
  });

  it('ignores .cache, tmp directories, and temporary files', async () => {
    const events: string[] = [];
    watcher = createScopedWatcher(testDir, (event) => events.push(event.path));

    await fs.writeFile(path.join(testDir, '.cache', 'temp.json'), 'cached');
    await fs.writeFile(path.join(testDir, 'tmp', 'artifact.tmp'), 'data');
    await fs.writeFile(path.join(testDir, 'corpus', 'notes.tmp.123abc'), 'partial');
    await fs.writeFile(path.join(testDir, 'corpus', 'notes.yaml'), 'final');

    await sleep(150);
    expect(events.filter(e => e.includes('.cache') || e.includes('tmp'))).toHaveLength(0);
    expect(events.filter(e => e.includes('notes.yaml'))).toHaveLength(1);
  });

  it('ignores SQLite database operational sidecars, jobs database writes, and generated artifacts (SL-BUG-007)', async () => {
    const events: string[] = [];
    watcher = createScopedWatcher(testDir, (event) => events.push(event.path));

    // Operational SQLite sidecars and jobs DB
    const jobsDir = path.join(testDir, '.featherduster', 'jobs');
    const artifactsDir = path.join(jobsDir, 'artifacts', 'job-1', 'v1');
    const snapshotsDir = path.join(testDir, 'tailoring', 'jobs', 'job-1', 'snapshots', 's1');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.mkdir(snapshotsDir, { recursive: true });

    await fs.writeFile(path.join(jobsDir, 'jobs.sqlite3'), 'data');
    await fs.writeFile(path.join(jobsDir, 'jobs.sqlite3-wal'), 'data');
    await fs.writeFile(path.join(jobsDir, 'jobs.sqlite3-shm'), 'data');
    await fs.writeFile(path.join(jobsDir, 'jobs.sqlite3-journal'), 'data');
    await fs.writeFile(path.join(testDir, 'legacy.db-journal'), 'data');
    await fs.writeFile(path.join(artifactsDir, 'resume.pdf'), 'pdf');
    await fs.writeFile(path.join(artifactsDir, 'preview-0.png'), 'png');
    await fs.writeFile(path.join(snapshotsDir, 'base-resume.yaml'), 'snapshot');

    // Genuine user-editable files inside .featherduster and workspace
    const dotFeather = path.join(testDir, '.featherduster');
    await fs.writeFile(path.join(dotFeather, 'config.yaml'), 'runner: test');
    await fs.writeFile(path.join(dotFeather, 'privacy-rules.yaml'), 'exclude: []');

    await sleep(200);

    // Operational writes are suppressed
    expect(events.filter(e => e.includes('jobs.sqlite3') || e.includes('db-journal') || e.includes('artifacts') || e.includes('snapshots'))).toHaveLength(0);

    // User-editable files trigger events
    expect(events.filter(e => e.includes('config.yaml'))).toHaveLength(1);
    expect(events.filter(e => e.includes('privacy-rules.yaml'))).toHaveLength(1);
  });

  it('correctly classifies Windows backslash paths in isOperationalOrIgnoredPath (SL-BUG-007)', async () => {
    const { isOperationalOrIgnoredPath } = await import('../src/watcher.js');
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\jobs\\jobs.sqlite3')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\jobs\\jobs.sqlite3-wal')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\jobs\\jobs.sqlite3-shm')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\jobs\\jobs.sqlite3-journal')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\jobs\\artifacts\\123\\456\\resume.pdf')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\tailoring\\jobs\\123\\snapshots\\456\\base.yaml')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\data.db-wal')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\app.db-journal')).toBe(true);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.leases\\worker.lock')).toBe(true);

    // User editable paths must NOT be ignored
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\config.yaml')).toBe(false);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\privacy-rules.yaml')).toBe(false);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\.featherduster\\skills\\de-slop\\SKILL.md')).toBe(false);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\evidence\\experience.md')).toBe(false);
    expect(isOperationalOrIgnoredPath('C:\\workspace\\resumes\\base.yaml')).toBe(false);
  });

  it('scopes SSE broadcast channels by topic: corpus, jobs:jobId, and workspace_integrity', async () => {
    const app = createApp(testDir);

    // 1. Subscribe to topic=corpus
    const resCorpus = await app.request('/api/events?topic=corpus');
    expect(resCorpus.status).toBe(200);
    expect(resCorpus.headers.get('content-type')).toContain('text/event-stream');

    // 2. Subscribe to topic=workspace_integrity
    const resIntegrity = await app.request('/api/events?topic=workspace_integrity');
    expect(resIntegrity.status).toBe(200);

    // 3. Subscribe to topic=jobs:specific-job
    const resJobs = await app.request('/api/events?topic=jobs:specific-job');
    expect(resJobs.status).toBe(200);

    await app.disposeJobs();
  });
});
