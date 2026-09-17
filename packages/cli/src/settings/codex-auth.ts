import { spawnSync } from 'node:child_process';
import { LoginProcess, maskSecrets, withoutEnv, type LoginJob } from './login-process.js';

export interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  /** 'chatgpt' | 'api-key' | null */
  method: 'chatgpt' | 'api-key' | null;
  detail: string;
}

export type CodexLoginMode = 'chatgpt' | 'device';

export interface CodexAuthOptions {
  command?: string;
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
  loginTimeoutMs?: number;
}

/** Env API keys would override the stored Codex sign-in. */
export const CODEX_HIDDEN_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY'];

export function parseCodexLoginStatus(text: string, exitCode: number | null): Omit<CodexAuthStatus, 'installed'> {
  const clean = maskSecrets(text.trim());
  const notLoggedIn = /not\s+logged\s+in/i.test(clean) || (exitCode !== 0 && !/logged\s+in/i.test(clean));
  if (notLoggedIn) return { loggedIn: false, method: null, detail: clean.split('\n')[0] || 'Not logged in' };
  const loggedIn = /logged\s+in/i.test(clean);
  return {
    loggedIn,
    method: /chatgpt/i.test(clean) ? 'chatgpt' : /api\s*key/i.test(clean) ? 'api-key' : null,
    detail: clean.split('\n')[0] || (loggedIn ? 'Logged in' : 'Unknown'),
  };
}

/** Wraps `codex login status|login|logout` for the settings UI. Codex owns credential storage. */
export class CodexAuthManager {
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly login: LoginProcess;

  constructor(options: CodexAuthOptions = {}) {
    this.command = options.command ?? 'codex';
    this.prefixArgs = options.prefixArgs ?? [];
    this.env = options.env ?? process.env;
    this.login = new LoginProcess(options.loginTimeoutMs ?? 15 * 60 * 1000);
  }

  get loginJob(): LoginJob | null {
    return this.login.current;
  }

  private childEnv(): NodeJS.ProcessEnv {
    return withoutEnv(this.env, CODEX_HIDDEN_ENV);
  }

  status(): CodexAuthStatus {
    const result = spawnSync(this.command, [...this.prefixArgs, 'login', 'status'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: this.childEnv(),
    });
    if (result.error) {
      return { installed: false, loggedIn: false, method: null, detail: 'Codex CLI not found. Install it from https://developers.openai.com/codex.' };
    }
    return { installed: true, ...parseCodexLoginStatus(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, result.status) };
  }

  startLogin(mode: CodexLoginMode): LoginJob {
    const args = [...this.prefixArgs, 'login', ...(mode === 'device' ? ['--device-auth'] : [])];
    return this.login.start(this.command, args, mode, this.childEnv());
  }

  cancelLogin(): LoginJob | null {
    return this.login.cancel();
  }

  /** Hands the key to Codex over stdin; Featherduster never stores it. */
  loginWithApiKey(apiKey: string): { ok: boolean; detail: string } {
    const result = spawnSync(this.command, [...this.prefixArgs, 'login', '--with-api-key'], {
      input: `${apiKey}\n`,
      encoding: 'utf-8',
      timeout: 30000,
      windowsHide: true,
      env: this.childEnv(),
    });
    if (result.error) return { ok: false, detail: result.error.message };
    const detail = maskSecrets(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()).slice(0, 300);
    return { ok: result.status === 0, detail: detail || (result.status === 0 ? 'Logged in with API key' : 'Login failed') };
  }

  logout(): { ok: boolean; detail: string } {
    const result = spawnSync(this.command, [...this.prefixArgs, 'logout'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: this.childEnv(),
    });
    if (result.error) return { ok: false, detail: result.error.message };
    return { ok: result.status === 0, detail: maskSecrets(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()).slice(0, 300) };
  }
}
