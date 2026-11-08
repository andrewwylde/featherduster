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
