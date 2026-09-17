import type { Context, Hono, MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { loadTailoringConfig } from '../tailoring/config.js';
import type { RunnerFactory } from '../runners/registry.js';
import type { RunnerId } from '../runners/types.js';
import {
  ANTHROPIC_KEY_ACCOUNT,
  CredentialStoreError,
  summarizeAnthropicCredential,
  validateAnthropicKeyShape,
  type CredentialStore,
} from './credentials.js';
import { RunnerSettingsPatchSchema, revokeRunnerConsent, writeRunnerSettings } from './runner-settings.js';
import type { ClaudeAuthManager, LoginMode } from './claude-auth.js';
import type { CodexAuthManager } from './codex-auth.js';

export interface SettingsRouteDeps {
  workspaceDir: string;
  store: () => CredentialStore;
  claudeAuth: ClaudeAuthManager;
  codexAuth: CodexAuthManager;
  runnerFactory: RunnerFactory;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const TESTABLE: RunnerId[] = ['claude-code', 'codex', 'anthropic-api', 'ollama'];

/** Mutations must be JSON: blocks form-encoded cross-site requests in addition to the origin checks. */
const requireJson: MiddlewareHandler = async (c, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(c.req.method)) {
    const type = c.req.header('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'Settings changes require a JSON request.', code: 'unsupported_media_type' }, 415);
    }
  }
  await next();
};

async function body(c: Context): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export function mountSettingsRoutes(app: Hono, deps: SettingsRouteDeps): void {
  const env = () => deps.env ?? process.env;

  const snapshot = () => {
    const config = loadTailoringConfig(deps.workspaceDir);
    return {
      runner: config.runner,
      runner_consent: config.runner_consent,
      deslop_warn_band: config.deslop_warn_band,
      credentials: { anthropic: summarizeAnthropicCredential(env(), deps.store()) },
    };
  };

  app.use('/api/settings/*', requireJson);

  app.get('/api/settings', (c) => c.json(snapshot()));

  app.put('/api/settings/runner', async (c) => {
    try {
      const patch = RunnerSettingsPatchSchema.parse(await body(c));
      writeRunnerSettings(deps.workspaceDir, patch);
      return c.json(snapshot());
    } catch (err) {
      if (err instanceof ZodError) {
        return c.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'invalid' }, 400);
      }
      return c.json({ error: err instanceof Error ? err.message : 'Failed to save settings', code: 'write_failed' }, 500);
    }
  });

  app.put('/api/settings/credentials/anthropic', async (c) => {
    const { apiKey } = await body(c);
    const problem = validateAnthropicKeyShape(apiKey);
    if (problem) return c.json({ error: problem, code: 'invalid_key' }, 400);
    try {
      deps.store().set(ANTHROPIC_KEY_ACCOUNT, String(apiKey).trim());
    } catch (err) {
      const message = err instanceof CredentialStoreError ? err.message : 'Could not save the key.';
      return c.json({ error: message, code: 'store_unavailable' }, 503);
    }
    return c.json(snapshot());
  });

  app.delete('/api/settings/credentials/anthropic', (c) => {
    deps.store().delete(ANTHROPIC_KEY_ACCOUNT);
    return c.json(snapshot());
  });

  app.delete('/api/settings/consent/:runner', (c) => {
    const runner = c.req.param('runner');
    if (!TESTABLE.includes(runner as RunnerId)) return c.json({ error: 'Unknown runner', code: 'invalid_runner' }, 400);
    revokeRunnerConsent(deps.workspaceDir, runner);
    return c.json(snapshot());
  });

  app.post('/api/settings/runners/:id/test', async (c) => {
    const id = c.req.param('id') as RunnerId;
    if (!TESTABLE.includes(id)) return c.json({ error: 'Unknown runner', code: 'invalid_runner' }, 400);
    const runner = deps.runnerFactory(id, loadTailoringConfig(deps.workspaceDir).runner);
    if (!runner) return c.json({ available: false, detail: 'Runner unavailable' });
    return c.json(await runner.detect());
  });

  app.get('/api/settings/ollama/models', async (c) => {
    const url = (c.req.query('url') || loadTailoringConfig(deps.workspaceDir).runner.ollama.url).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) return c.json({ error: 'Invalid URL', code: 'invalid_url' }, 400);
    try {
      const res = await (deps.fetchImpl ?? fetch)(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return c.json({ reachable: false, models: [], detail: `Ollama responded ${res.status}` });
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return c.json({ reachable: true, models: (data.models ?? []).map((m) => m.name).sort(), detail: `Ollama at ${url}` });
    } catch {
      return c.json({ reachable: false, models: [], detail: `Ollama is not running at ${url}.` });
    }
  });

  app.get('/api/settings/claude-code/auth', (c) =>
    c.json({ status: deps.claudeAuth.status(), login: deps.claudeAuth.loginJob })
  );

  app.post('/api/settings/claude-code/login', async (c) => {
    const { mode } = await body(c);
    const loginMode: LoginMode = mode === 'console' ? 'console' : 'claudeai';
    return c.json({ login: deps.claudeAuth.startLogin(loginMode) }, 202);
  });

  app.post('/api/settings/claude-code/login/cancel', (c) => c.json({ login: deps.claudeAuth.cancelLogin() }));

  app.post('/api/settings/claude-code/logout', (c) => {
    const result = deps.claudeAuth.logout();
    return c.json({ ...result, status: deps.claudeAuth.status() }, result.ok ? 200 : 500);
  });

  app.get('/api/settings/codex/auth', (c) => c.json({ status: deps.codexAuth.status(), login: deps.codexAuth.loginJob }));

  app.post('/api/settings/codex/login', async (c) => {
    const { mode } = await body(c);
    return c.json({ login: deps.codexAuth.startLogin(mode === 'device' ? 'device' : 'chatgpt') }, 202);
  });

  app.post('/api/settings/codex/login/cancel', (c) => c.json({ login: deps.codexAuth.cancelLogin() }));

  app.post('/api/settings/codex/api-key', async (c) => {
    const { apiKey } = await body(c);
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || /\s/.test(apiKey.trim())) {
      return c.json({ error: 'That does not look like a complete OpenAI API key.', code: 'invalid_key' }, 400);
    }
    const result = deps.codexAuth.loginWithApiKey(apiKey.trim());
    return c.json({ ...result, status: deps.codexAuth.status() }, result.ok ? 200 : 502);
  });

  app.post('/api/settings/codex/logout', (c) => {
    const result = deps.codexAuth.logout();
    return c.json({ ...result, status: deps.codexAuth.status() }, result.ok ? 200 : 500);
  });
}
