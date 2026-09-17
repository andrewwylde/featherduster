import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

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

export interface LoginJob {
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  mode: LoginMode;
  startedAt: string;
  finishedAt: string | null;
  /** Last lines of CLI output; may contain a sign-in URL if no browser opened. */
  output: string;
  /** First https URL printed by the CLI, if any. */
  url: string | null;
}

export interface ClaudeAuthOptions {
  command?: string;
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
  loginTimeoutMs?: number;
}

const OUTPUT_LIMIT = 4000;

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

/** Env for auth commands: API key env vars would make the CLI report API-key auth instead of the account. */
function authEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/** Wraps `claude auth status|login|logout` for the settings UI. One login at a time. */
export class ClaudeAuthManager {
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly loginTimeoutMs: number;
  private job: LoginJob | null = null;
  private child: ChildProcess | null = null;

  constructor(options: ClaudeAuthOptions = {}) {
    this.command = options.command ?? 'claude';
    this.prefixArgs = options.prefixArgs ?? [];
    this.env = options.env ?? process.env;
    this.loginTimeoutMs = options.loginTimeoutMs ?? 10 * 60 * 1000;
  }

  get loginJob(): LoginJob | null {
    return this.job;
  }

  status(): ClaudeAuthStatus {
    const result = spawnSync(this.command, [...this.prefixArgs, 'auth', 'status', '--json'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: authEnv(this.env),
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
    if (this.job?.state === 'running') return this.job;
    const args = [...this.prefixArgs, 'auth', 'login', ...(mode === 'console' ? ['--console'] : ['--claudeai'])];
    const job: LoginJob = { state: 'running', mode, startedAt: new Date().toISOString(), finishedAt: null, output: '', url: null };
    this.job = job;

    const child = spawn(this.command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: authEnv(this.env) });
    this.child = child;
    const timer = setTimeout(() => {
      if (job.state === 'running') {
        this.finish(job, 'failed', '\nTimed out waiting for sign-in.');
        killTree(child);
      }
    }, this.loginTimeoutMs);

    const onData = (chunk: Buffer | string) => {
      job.output = (job.output + chunk.toString()).slice(-OUTPUT_LIMIT);
      if (!job.url) {
        const match = job.output.match(/https:\/\/[^\s"'<>]+/);
        if (match) job.url = match[0];
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      clearTimeout(timer);
      this.finish(job, 'failed', `\n${err.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (job.state !== 'running') return;
      this.finish(job, code === 0 ? 'succeeded' : 'failed', code === 0 ? '' : `\nExited with code ${code}.`);
    });
    return job;
  }

  cancelLogin(): LoginJob | null {
    const child = this.child;
    if (this.job?.state === 'running' && child) {
      this.finish(this.job, 'cancelled', '');
      killTree(child);
    }
    return this.job;
  }

  logout(): { ok: boolean; detail: string } {
    const result = spawnSync(this.command, [...this.prefixArgs, 'auth', 'logout'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: authEnv(this.env),
    });
    if (result.error) return { ok: false, detail: result.error.message };
    return { ok: result.status === 0, detail: (result.stdout || result.stderr || '').trim().slice(0, 300) };
  }

  private finish(job: LoginJob, state: LoginJob['state'], note: string): void {
    job.state = state;
    job.finishedAt = new Date().toISOString();
    if (note) job.output = (job.output + note).slice(-OUTPUT_LIMIT);
    this.child = null;
  }
}
