import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { CodexRunner } from '../src/runners/codex.js';
import { ClaudeCodeRunner } from '../src/runners/claude-code.js';
import { CodexAuthManager } from '../src/settings/codex-auth.js';
import { ClaudeAuthManager } from '../src/settings/claude-auth.js';
import { runTool } from '../src/render/tool-process.js';
import { discoveryProcess } from '../src/runners/discovery-process.js';

// A slow installed CLI, not a missing executable. No real credentials or tools.
const options = { command: process.execPath, prefixArgs: ['-e', `setTimeout(() => { console.log('Logged in using ChatGPT'); }, 1800)`, '--'] };

describe('discovery must not starve PDF subprocess completion or HTTP polling', () => {
  it('bounds hung processes and oversized output, and retains nonzero status output', async () => {
    const hung = await discoveryProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 });
    expect(hung.error).toBeDefined();
    expect(hung.status).not.toBe(0);
    const noisy = await discoveryProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"], { timeout: 3000 });
    expect(noisy.error).toBeDefined();
    const signedOut = await discoveryProcess(process.execPath, ['-e', "console.error('Not logged in'); process.exit(1)"], { timeout: 3000 });
    expect(signedOut).toMatchObject({ status: 1, error: undefined });
    expect(signedOut.stderr).toContain('Not logged in');
  });
  it.each(['codex', 'claude', 'codex-auth', 'claude-auth'])('%s yields while a slow status process runs', async kind => {
    const app = new Hono();
    app.get('/health', c => c.json({ ok: true }));
    app.get('/discovery', async c => {
      const result = kind === 'codex' ? await new CodexRunner(options).detect()
        : kind === 'claude' ? await new ClaudeCodeRunner(options).detect()
        : kind === 'codex-auth' ? await new CodexAuthManager(options).status()
        : await new ClaudeAuthManager(options).status();
      return c.json(result);
    });
    const started = performance.now();
    const probe = runTool('pdfinfo', { command: process.execPath, prefixArgs: ['-e', "console.log('PDF probe completed')"] }, [], { timeoutMs: 1000 }).then(value => ({ value }), error => ({ error }));
    const discovery = app.request('/discovery');
    const health = await app.request('/health');
    const elapsed = performance.now() - started;
    const result = await probe;
    await discovery;
    expect(health.status).toBe(200);
    expect(result).toEqual({ value: 'PDF probe completed\n' });
    expect(elapsed).toBeLessThan(1000);
  }, 15000);
});
