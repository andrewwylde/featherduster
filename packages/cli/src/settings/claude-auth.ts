import { spawnSync } from 'node:child_process';
import { LoginProcess, withoutEnv, type LoginJob } from './login-process.js';

export type { LoginJob } from './login-process.js';

export interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  detail: string;
}

export type LoginMode = 'claudeai' | 'console';

export interface ClaudeAuthOptions {
  command?: string;
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
  loginTimeoutMs?: number;
}

/** API key env vars would make the CLI report API-key auth instead of the account. */
const HIDDEN_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/** Wraps `claude auth status|login|logout` for the settings UI. One login at a time. */
export class ClaudeAuthManager {
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly login: LoginProcess;

  constructor(options: ClaudeAuthOptions = {}) {
    this.command = options.command ?? 'claude';
    this.prefixArgs = options.prefixArgs ?? [];
    this.env = options.env ?? process.env;
    this.login = new LoginProcess(options.loginTimeoutMs ?? 10 * 60 * 1000);
  }

  get loginJob(): LoginJob | null {
    return this.login.current;
  }

  status(): ClaudeAuthStatus {
    const result = spawnSync(this.command, [...this.prefixArgs, 'auth', 'status', '--json'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: withoutEnv(this.env, HIDDEN_ENV),
    });
    const empty = { loggedIn: false, authMethod: null, apiProvider: null, email: null, orgName: null, subscriptionType: null };
    if (result.error) {
      return { installed: false, ...empty, detail: 'Claude Code CLI not found. Install it from https://claude.com/claude-code.' };
    }
    try {
      const parsed = JSON.parse(result.stdout);
      return {
        installed: true,
        loggedIn: parsed.loggedIn === true,
        authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : null,
        apiProvider: typeof parsed.apiProvider === 'string' ? parsed.apiProvider : null,
        email: typeof parsed.email === 'string' ? parsed.email : null,
        orgName: typeof parsed.orgName === 'string' ? parsed.orgName : null,
        subscriptionType: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null,
        detail: parsed.loggedIn ? 'Logged in' : 'Not logged in',
      };
    } catch {
      return {
        installed: true,
        ...empty,
        detail: (result.stderr || result.stdout || 'Could not read auth status').trim().slice(0, 300),
      };
    }
  }

  startLogin(mode: LoginMode): LoginJob {
    const args = [...this.prefixArgs, 'auth', 'login', mode === 'console' ? '--console' : '--claudeai'];
    return this.login.start(this.command, args, mode, withoutEnv(this.env, HIDDEN_ENV));
  }

  cancelLogin(): LoginJob | null {
    return this.login.cancel();
  }

  logout(): { ok: boolean; detail: string } {
    const result = spawnSync(this.command, [...this.prefixArgs, 'auth', 'logout'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: withoutEnv(this.env, HIDDEN_ENV),
    });
    if (result.error) return { ok: false, detail: result.error.message };
    return { ok: result.status === 0, detail: (result.stdout || result.stderr || '').trim().slice(0, 300) };
  }
}
