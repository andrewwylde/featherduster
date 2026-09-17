import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexRunner, buildCodexArgs, CODEX_DISABLED_FEATURES } from '../src/runners/codex.js';
import { CodexAuthManager, parseCodexLoginStatus } from '../src/settings/codex-auth.js';
import { maskSecrets } from '../src/settings/login-process.js';
import { createApp } from '../src/server.js';
import { WorkspaceWatcher } from '../src/watcher.js';
import { MemoryCredentialStore } from '../src/settings/credentials.js';
import { ClaudeAuthManager } from '../src/settings/claude-auth.js';
import type { RunnerRequest } from '../src/runners/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeCodex = path.join(here, 'fixtures', 'fake-codex.mjs');
const schema = { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false };

const tmpRecord = () => path.join(os.tmpdir(), `fd-codex-record-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

function request(overrides: Partial<RunnerRequest> = {}): RunnerRequest & { events: Array<{ kind: string; text: string }> } {
  const events: Array<{ kind: string; text: string }> = [];
  return { system: 'SYSTEM', prompt: 'PROMPT', schema, signal: new AbortController().signal, onProgress: (e) => events.push(e), events, ...overrides };
}

const runner = (env: NodeJS.ProcessEnv = {}) =>
  new CodexRunner({ command: process.execPath, prefixArgs: [fakeCodex], env: { ...process.env, ...env } });

const auth = (env: NodeJS.ProcessEnv = {}) =>
  new CodexAuthManager({ command: process.execPath, prefixArgs: [fakeCodex], env: { ...process.env, ...env }, loginTimeoutMs: 5000 });

async function waitFor<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > ms) throw new Error(`timed out: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Codex login status parsing and masking', () => {
  it('recognizes ChatGPT, API key, and signed-out states', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT', 0)).toMatchObject({ loggedIn: true, method: 'chatgpt' });
    const key = parseCodexLoginStatus('Logged in using an API key - sk-proj-abcdefghijklmnopqrstuvwxyz', 0);
    expect(key).toMatchObject({ loggedIn: true, method: 'api-key' });
    expect(key.detail).not.toContain('klmnop');
    expect(parseCodexLoginStatus('Not logged in', 1)).toMatchObject({ loggedIn: false, method: null });
  });

  it('masks key-like tokens', () => {
    expect(maskSecrets('key sk-proj-abcdefghijklmnopqrstuvwxyz done')).toBe('key sk-proj-a… done');
  });
});

describe('CodexRunner', () => {
  it('builds tool-less, config-isolated exec args', () => {
    const args = buildCodexArgs({ schemaFile: 's.json', lastMessageFile: 'o.json', cwd: '/tmp/x', model: 'gpt-5' });
    expect(args.slice(0, 1)).toEqual(['exec']);
    for (const flag of ['--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--json']) expect(args).toContain(flag);
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    for (const feature of CODEX_DISABLED_FEATURES) expect(args).toContain(feature);
    expect(args).toContain('shell_tool');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args.slice(-3)).toEqual(['-m', 'gpt-5', '-']);
  });

  it('detects version and sign-in state', async () => {
    expect(await runner().detect()).toMatchObject({ available: true });
    expect((await runner({ FAKE_CODEX_AUTH: 'out' }).detect()).detail).toMatch(/not signed in/);
    expect((await new CodexRunner({ command: 'definitely-not-codex-xyz' }).detect()).available).toBe(false);
  });

  it('pipes instructions and input on stdin from an empty temp dir, strips API key env, and parses the last message', async () => {
    const rec = tmpRecord();
    const req = request({ prompt: 'x'.repeat(40_000) });
    const out = await runner({ FAKE_CODEX_RECORD: rec, OPENAI_API_KEY: 'sk-should-not-pass-through' }).run(req);
    expect(out).toEqual({ word: 'PINEAPPLE' });
    const r = JSON.parse(fs.readFileSync(rec, 'utf-8'));
    expect(r.stdin).toContain('SYSTEM');
    expect(r.stdin).toContain('x'.repeat(40_000));
    expect(r.schema).toEqual(schema);
    expect(r.cwdEntries).toEqual([]);
    expect(r.hasEnvKey).toBe(false);
    expect(req.events.some((e) => e.kind === 'token' && e.text === 'thinking')).toBe(true);
    fs.rmSync(rec, { force: true });
  });

  it('maps auth failures, non-JSON output, and aborts', async () => {
    await expect(runner({ FAKE_CODEX_MODE: 'auth' }).run(request())).rejects.toMatchObject({ code: 'auth' });
    await expect(runner({ FAKE_CODEX_MODE: 'text' }).run(request())).rejects.toMatchObject({ code: 'invalid_output' });
    const controller = new AbortController();
    const pending = runner({ FAKE_CODEX_MODE: 'hang' }).run(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 300);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('CodexAuthManager', () => {
  it('reports status and logs in with ChatGPT or device code', async () => {
    const manager = auth();
    expect(manager.status()).toMatchObject({ installed: true, loggedIn: true, method: 'chatgpt' });

    manager.startLogin('device');
    const done = await waitFor(() => manager.loginJob!, (j) => j.state !== 'running');
    expect(done.state).toBe('succeeded');
    expect(done.output).toContain('ABCD-EFGH');
    expect(done.url).toBe('https://auth.openai.com/codex/device');
  });

  it('cancels a hanging login', async () => {
    const manager = auth({ FAKE_CODEX_LOGIN: 'hang' });
    manager.startLogin('chatgpt');
    await new Promise((r) => setTimeout(r, 300));
    expect(manager.cancelLogin()?.state).toBe('cancelled');
  });

  it('passes an API key over stdin, hides env keys, and masks the key in output', () => {
    const rec = tmpRecord();
    const key = 'sk-proj-test-abcdefghijklmnopqrstuvwxyz';
    const result = auth({ FAKE_CODEX_RECORD: rec, OPENAI_API_KEY: 'sk-env-should-be-hidden' }).loginWithApiKey(key);
    expect(result.ok).toBe(true);
    expect(result.detail).not.toContain('klmnop');
    expect(JSON.parse(fs.readFileSync(rec, 'utf-8'))).toEqual({ keyLength: key.length, hasEnvKey: false });
    fs.rmSync(rec, { force: true });
  });

  it('logs out', () => {
    expect(auth().logout()).toEqual({ ok: true, detail: 'Successfully logged out' });
  });
});

describe('Codex settings routes', () => {
  let ws: string;
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: { host: '127.0.0.1:4173', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  };

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-codex-routes-'));
    fs.mkdirSync(path.join(ws, '.featherduster'));
    fs.writeFileSync(path.join(ws, '.featherduster', 'config.yaml'), 'runner:\n  default: claude-code\n');
    app = createApp(ws, {
      watcher: new WorkspaceWatcher(ws),
      credentialStore: new MemoryCredentialStore(),
      claudeAuth: new ClaudeAuthManager({ command: 'definitely-not-claude-xyz' }),
      codexAuth: auth(),
      runnerFactory: (id) => (id === 'codex' ? runner() : null),
    });
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it('exposes status, device login, API key login, logout, test, and codex preferences', async () => {
    expect((await call('GET', '/api/settings/codex/auth')).json.status).toMatchObject({ loggedIn: true, method: 'chatgpt' });

    expect((await call('POST', '/api/settings/codex/login', { mode: 'device' })).status).toBe(202);
    const finished = await waitFor(() => call('GET', '/api/settings/codex/auth'), (r) => r.json.login?.state !== 'running');
    expect(finished.json.login.output).toContain('ABCD-EFGH');

    expect((await call('POST', '/api/settings/codex/api-key', { apiKey: 'short' })).status).toBe(400);
    const keyed = await call('POST', '/api/settings/codex/api-key', { apiKey: 'sk-proj-test-abcdefghijklmnopqrstuvwxyz' });
    expect(keyed.status).toBe(200);
    expect(keyed.text).not.toContain('klmnopqrstuvwxyz');

    expect((await call('POST', '/api/settings/codex/logout', {})).json.ok).toBe(true);
    expect((await call('POST', '/api/settings/runners/codex/test', {})).json).toMatchObject({ available: true });

    const saved = await call('PUT', '/api/settings/runner', { default: 'codex', codex: { model: 'gpt-5-codex' } });
    expect(saved.json.runner).toMatchObject({ default: 'codex', codex: { model: 'gpt-5-codex', command: 'codex' } });
  });
});
