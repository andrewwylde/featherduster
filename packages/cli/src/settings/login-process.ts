import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export interface LoginJob {
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  mode: string;
  startedAt: string;
  finishedAt: string | null;
  /** Last lines of CLI output (may include a device code or sign-in URL). Key-like tokens are masked. */
  output: string;
  /** First https URL printed by the CLI, if any. */
  url: string | null;
}

const OUTPUT_LIMIT = 4000;
const KEY_LIKE = /\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_*-]{8,}/g;

/** Masks anything shaped like an API key before it reaches logs or the UI. */
export function maskSecrets(text: string): string {
  return text.replace(KEY_LIKE, '$1…');
}

export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

/** Returns a copy of env without the named variables. */
export function withoutEnv(base: NodeJS.ProcessEnv, names: string[]): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of names) delete env[name];
  return env;
}

/**
 * Tracks one interactive CLI sign-in at a time (browser or device-code flows):
 * captures output and the first URL, enforces a timeout, and supports cancel.
 */
export class LoginProcess {
  private job: LoginJob | null = null;
  private child: ChildProcess | null = null;

  constructor(private readonly timeoutMs: number) {}

  get current(): LoginJob | null {
    return this.job;
  }

  start(command: string, args: string[], mode: string, env: NodeJS.ProcessEnv): LoginJob {
    if (this.job?.state === 'running') return this.job;
    const job: LoginJob = { state: 'running', mode, startedAt: new Date().toISOString(), finishedAt: null, output: '', url: null };
    this.job = job;

    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    this.child = child;
    const timer = setTimeout(() => {
      if (job.state === 'running') {
        this.finish(job, 'failed', '\nTimed out waiting for sign-in.');
        killTree(child);
      }
    }, this.timeoutMs);

    const onData = (chunk: Buffer | string) => {
      job.output = maskSecrets(job.output + chunk.toString()).slice(-OUTPUT_LIMIT);
      if (!job.url) {
        const match = job.output.match(/https:\/\/[^\s"'<>)]+/);
        if (match) job.url = match[0];
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      clearTimeout(timer);
      if (job.state === 'running') this.finish(job, 'failed', `\n${err.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (job.state !== 'running') return;
      this.finish(job, code === 0 ? 'succeeded' : 'failed', code === 0 ? '' : `\nExited with code ${code}.`);
    });
    return job;
  }

  cancel(): LoginJob | null {
    const child = this.child;
    if (this.job?.state === 'running' && child) {
      this.finish(this.job, 'cancelled', '');
      killTree(child);
    }
    return this.job;
  }

  private finish(job: LoginJob, state: LoginJob['state'], note: string): void {
    job.state = state;
    job.finishedAt = new Date().toISOString();
    if (note) job.output = (job.output + note).slice(-OUTPUT_LIMIT);
    this.child = null;
  }
}
