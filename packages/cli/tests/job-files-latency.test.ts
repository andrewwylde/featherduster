import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobFiles, fingerprint } from '../src/jobs/files.js';
import { runTool } from '../src/render/tool-process.js';

const latency = vi.hoisted(() => ({ enabled: false, reads: 0 }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const resolver = ((...args: Parameters<typeof actual.realpathSync>) => {
    if (latency.enabled) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    return actual.realpathSync(...args);
  }) as typeof actual.realpathSync;
  resolver.native = actual.realpathSync.native;
  return { ...actual, realpathSync: resolver, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => { latency.reads++; return actual.readFileSync(...args); } }; 
});
afterEach(() => { latency.enabled = false; });
it('keeps PDF completions responsive during repeated immutable reads on slow JS realpath', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-path-latency-'));
  try {
    const files = new JobFiles(dir), job = randomUUID(), snapshot = randomUUID();
    files.writeBundle('snapshots', job, snapshot, { 'input.json': '{}' });
    const reference = { id: `${files.bundlePath('snapshots', job, snapshot)}/input.json`, fingerprint: fingerprint('{}') };
    // Windows JS realpath repeatedly lstats every ancestor; emulate the measured
    // slow fallback while leaving the native resolver and all security checks real.
    latency.enabled = true;
    const probe = runTool('pdfinfo', { command: process.execPath, prefixArgs: ['-e', "console.log('ok')"] }, [], { timeoutMs: 1000 }).then(value => ({ value }), error => ({ error }));
    for (let i = 0; i < 20; i++) expect(files.readSnapshot(reference, job, snapshot).toString()).toBe('{}');
    expect(await probe).toEqual({ value: 'ok\n' });
    const before = latency.reads;
    files.withReadScope(() => {
      const bytes = files.readSnapshot(reference, job, snapshot);
      bytes.fill(0);
      expect(files.readSnapshot(reference, job, snapshot).toString()).toBe('{}');
      expect(latency.reads - before).toBe(1);
      expect(() => files.readSnapshot({ ...reference, fingerprint: 'wrong' }, job, snapshot)).toThrow('fingerprint mismatch');
    });
    fs.writeFileSync(path.join(dir, reference.id), 'tampered');
    expect(() => files.withReadScope(() => files.readSnapshot(reference, job, snapshot))).toThrow('fingerprint mismatch');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
