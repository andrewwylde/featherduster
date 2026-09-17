import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createApp } from '../src/server.js';
import { WorkspaceWatcher } from '../src/watcher.js';
import {
  ANTHROPIC_KEY_ACCOUNT,
  MemoryCredentialStore,
  UnavailableCredentialStore,
  resolveAnthropicCredential,
  summarizeAnthropicCredential,
  type CredentialStore,
} from '../src/settings/credentials.js';
import { writeRunnerSettings, revokeRunnerConsent } from '../src/settings/runner-settings.js';
import { ClaudeAuthManager } from '../src/settings/claude-auth.js';
import { AnthropicApiRunner } from '../src/runners/anthropic-api.js';
import type { RunnerFactory } from '../src/runners/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = path.join(here, 'fixtures', 'fake-claude.mjs');
const KEY = 'sk-ant-api03-test-key-000000000000wxyz';

const CONFIG_WITH_COMMENTS = `# Workspace config — keep this comment
active_profile: sample-company
default_export_target: markdown
port: 4173
runner:
  default: claude-code # preferred runner
  step_timeout_seconds: 180
  claude-code:
    model: ""
  anthropic-api:
    model: claude-opus-5
  ollama:
    url: http://127.0.0.1:11434
    model: ""
    max_context: 32768
runner_consent:
  claude-code: '2026-09-16'
  anthropic-api: '2026-09-16'
`;

function authManager(env: NodeJS.ProcessEnv = {}) {
  return new ClaudeAuthManager({ command: process.execPath, prefixArgs: [fakeClaude], env: { ...process.env, ...env }, loginTimeoutMs: 5000 });
}

async function waitFor<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > ms) throw new Error(`timed out: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('credential resolution', () => {
  it('prefers env over the keychain and never exposes more than last4', () => {
    const store = new MemoryCredentialStore();
    store.set(ANTHROPIC_KEY_ACCOUNT, KEY);
    expect(resolveAnthropicCredential({}, store)).toEqual({ key: KEY, source: 'keychain' });
    expect(resolveAnthropicCredential({ ANTHROPIC_API_KEY: 'env-key-1234567890' }, store)?.source).toBe('env');
    const summary = summarizeAnthropicCredential({ ANTHROPIC_API_KEY: 'env-key-1234567890' }, store);
    expect(summary).toMatchObject({ configured: true, source: 'env', envVar: 'ANTHROPIC_API_KEY', last4: '7890', shadowedKeychainValue: true });
    expect(JSON.stringify(summary)).not.toContain('env-key');
  });

  it('reports an unavailable store without throwing on read', () => {
    const store = new UnavailableCredentialStore('no secret service');
    expect(summarizeAnthropicCredential({}, store)).toMatchObject({ configured: false, storeAvailable: false, storeDetail: 'no secret service' });
    expect(() => store.set(ANTHROPIC_KEY_ACCOUNT, KEY)).toThrow(/unavailable/);
  });
});

describe('runner settings writer', () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-settings-'));
    fs.mkdirSync(path.join(ws, '.featherduster'));
    fs.writeFileSync(path.join(ws, '.featherduster', 'config.yaml'), CONFIG_WITH_COMMENTS);
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it('patches values while preserving comments and unrelated keys', () => {
    writeRunnerSettings(ws, { default: 'ollama', ollama: { model: 'llama3.1:8b' }, deslop_warn_band: 'high' });
    const text = fs.readFileSync(path.join(ws, '.featherduster', 'config.yaml'), 'utf-8');
    expect(text).toContain('# Workspace config — keep this comment');
    expect(text).toContain('# preferred runner');
    const parsed = yaml.load(text) as any;
    expect(parsed.runner.default).toBe('ollama');
    expect(parsed.runner.ollama).toEqual({ url: 'http://127.0.0.1:11434', model: 'llama3.1:8b', max_context: 32768 });
    expect(parsed.deslop_warn_band).toBe('high');
    expect(parsed.active_profile).toBe('sample-company');
  });

  it('revokes consent for one runner only', () => {
    revokeRunnerConsent(ws, 'claude-code');
    const parsed = yaml.load(fs.readFileSync(path.join(ws, '.featherduster', 'config.yaml'), 'utf-8')) as any;
    expect(parsed.runner_consent).toEqual({ 'anthropic-api': '2026-09-16' });
  });
});

describe('ClaudeAuthManager', () => {
  it('reads status JSON and hides API key env vars from the CLI', () => {
    const record = path.join(os.tmpdir(), `fd-auth-env-${Date.now()}.json`);
    const status = authManager({ ANTHROPIC_API_KEY: 'should-not-leak', FAKE_CLAUDE_ENV_RECORD: record }).status();
    expect(status).toMatchObject({ installed: true, loggedIn: true, email: 'dev@example.com', subscriptionType: 'pro' });
    expect(JSON.parse(fs.readFileSync(record, 'utf-8')).hasKey).toBe(false);
    fs.rmSync(record, { force: true });
  });

  it('reports a missing CLI', () => {
    expect(new ClaudeAuthManager({ command: 'definitely-not-claude-xyz' }).status()).toMatchObject({ installed: false, loggedIn: false });
  });

  it('tracks a successful login and captures the sign-in URL', async () => {
    const manager = authManager();
    const job = manager.startLogin('console');
    expect(job.state).toBe('running');
    const done = await waitFor(() => manager.loginJob!, (j) => j.state !== 'running');
    expect(done.state).toBe('succeeded');
    expect(done.url).toBe('https://claude.ai/oauth/authorize?mode=console');
  });

  it('reports failed and cancelled logins', async () => {
    const failing = authManager({ FAKE_CLAUDE_LOGIN: 'fail' });
    failing.startLogin('claudeai');
    expect((await waitFor(() => failing.loginJob!, (j) => j.state !== 'running')).state).toBe('failed');

    const hanging = authManager({ FAKE_CLAUDE_LOGIN: 'hang' });
    hanging.startLogin('claudeai');
    await new Promise((r) => setTimeout(r, 300));
    expect(hanging.cancelLogin()?.state).toBe('cancelled');
  });

  it('logs out', () => {
    expect(authManager().logout()).toEqual({ ok: true, detail: 'Logged out.' });
  });
});

describe('settings API', () => {
  let ws: string;
  let store: CredentialStore;
  let app: ReturnType<typeof createApp>;

  const call = async (method: string, url: string, body?: unknown, contentType = 'application/json') => {
    const res = await app.request(url, {
      method,
      headers: { host: '127.0.0.1:4173', ...(contentType ? { 'content-type': contentType } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  };

  const build = (env: NodeJS.ProcessEnv = {}) => {
    const runnerFactory: RunnerFactory = (id) => (id === 'anthropic-api' ? new AnthropicApiRunner({ env, store }) : null);
    app = createApp(ws, {
      watcher: new WorkspaceWatcher(ws),
      credentialStore: store,
      claudeAuth: authManager(),
      runnerFactory,
      env,
    });
  };

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-settings-api-'));
    fs.mkdirSync(path.join(ws, '.featherduster'));
    fs.writeFileSync(path.join(ws, '.featherduster', 'config.yaml'), CONFIG_WITH_COMMENTS);
    store = new MemoryCredentialStore();
    build();
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it('saves an API key to the store and never returns it', async () => {
    const saved = await call('PUT', '/api/settings/credentials/anthropic', { apiKey: KEY });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain('sk-ant-api03');
    expect(saved.json.credentials.anthropic).toMatchObject({ configured: true, source: 'keychain', last4: 'wxyz' });
    expect(store.get(ANTHROPIC_KEY_ACCOUNT)).toBe(KEY);

    const tested = await call('POST', '/api/settings/runners/anthropic-api/test', {});
    expect(tested.json).toMatchObject({ available: true });
    expect(tested.text).not.toContain('sk-ant-api03');

    const removed = await call('DELETE', '/api/settings/credentials/anthropic', {});
    expect(removed.json.credentials.anthropic.configured).toBe(false);
  });

  it('rejects malformed keys and non-JSON mutations', async () => {
    expect((await call('PUT', '/api/settings/credentials/anthropic', { apiKey: 'short' })).status).toBe(400);
    const form = await call('PUT', '/api/settings/credentials/anthropic', `apiKey=${KEY}`, 'application/x-www-form-urlencoded');
    expect(form.status).toBe(415);
    expect(store.get(ANTHROPIC_KEY_ACCOUNT)).toBeNull();
  });

  it('reports env-sourced keys as active even when a stored key exists', async () => {
    store.set(ANTHROPIC_KEY_ACCOUNT, KEY);
    build({ ANTHROPIC_API_KEY: 'env-key-abcdefghijklmnop' });
    const res = await call('GET', '/api/settings');
    expect(res.json.credentials.anthropic).toMatchObject({ source: 'env', envVar: 'ANTHROPIC_API_KEY', shadowedKeychainValue: true, last4: 'mnop' });
  });

  it('returns 503 when the OS store is unavailable', async () => {
    store = new UnavailableCredentialStore('no keyring');
    build();
    const res = await call('PUT', '/api/settings/credentials/anthropic', { apiKey: KEY });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe('store_unavailable');
  });

  it('validates and saves runner preferences, and revokes consent', async () => {
    expect((await call('PUT', '/api/settings/runner', { step_timeout_seconds: 5 })).status).toBe(400);
    expect((await call('PUT', '/api/settings/runner', { ollama: { url: 'file:///etc/passwd' } })).status).toBe(400);
    expect((await call('PUT', '/api/settings/runner', { bogus: true })).status).toBe(400);

    const ok = await call('PUT', '/api/settings/runner', { default: 'anthropic-api', step_timeout_seconds: 300, 'anthropic-api': { model: 'claude-sonnet-5' } });
    expect(ok.status).toBe(200);
    expect(ok.json.runner).toMatchObject({ default: 'anthropic-api', step_timeout_seconds: 300, 'anthropic-api': { model: 'claude-sonnet-5' } });
    expect(fs.readFileSync(path.join(ws, '.featherduster', 'config.yaml'), 'utf-8')).toContain('# preferred runner');

    const revoked = await call('DELETE', '/api/settings/consent/claude-code', {});
    expect(revoked.json.runner_consent).toEqual({ 'anthropic-api': '2026-09-16' });
  });

  it('exposes Claude Code auth status and login jobs', async () => {
    const status = await call('GET', '/api/settings/claude-code/auth');
    expect(status.json.status).toMatchObject({ loggedIn: true, email: 'dev@example.com' });
    const started = await call('POST', '/api/settings/claude-code/login', { mode: 'claudeai' });
    expect(started.status).toBe(202);
    expect(started.json.login.state).toBe('running');
    const finished = await waitFor(() => call('GET', '/api/settings/claude-code/auth'), (r) => r.json.login?.state !== 'running');
    expect(finished.json.login.state).toBe('succeeded');
    expect((await call('POST', '/api/settings/claude-code/logout', {})).json.ok).toBe(true);
  });

  it('lists Ollama models or reports it unreachable', async () => {
    const res = await call('GET', '/api/settings/ollama/models?url=http://127.0.0.1:9');
    expect(res.json).toMatchObject({ reachable: false, models: [] });
    expect((await call('GET', '/api/settings/ollama/models?url=ftp://x')).status).toBe(400);
  });
});
