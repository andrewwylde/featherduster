import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEX_HIDDEN_ENV, parseCodexLoginStatus } from '../settings/codex-auth.js';
import { killTree, maskSecrets, withoutEnv } from '../settings/login-process.js';
import { abortError, RunnerError, type ModelRunner, type RunnerDetection, type RunnerRequest } from './types.js';

export interface CodexRunnerOptions {
  command?: string;
  model?: string;
  /** Extra leading args (tests run a fake CLI through `node`). */
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
}

/** Codex features that give the agent tools; all are disabled so it can only answer from the prompt. */
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'browser_use',
  'computer_use',
  'view_image',
  'image_generation',
  'hooks',
  'code_mode_host',
];

export function buildCodexArgs(opts: { schemaFile: string; lastMessageFile: string; cwd: string; model?: string }): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-C',
    opts.cwd,
    '--output-schema',
    opts.schemaFile,
    '-o',
    opts.lastMessageFile,
    '--json',
    '--color',
    'never',
  ];
  for (const feature of CODEX_DISABLED_FEATURES) args.push('--disable', feature);
  if (opts.model) args.push('-m', opts.model);
  args.push('-');
  return args;
}

/**
 * Runs the local Codex CLI headlessly with every tool disabled, in an empty temp
 * directory, using the Codex sign-in (API key env vars are stripped). Codex has no
 * separate system prompt flag, so instructions and gate input share stdin.
 */
export class CodexRunner implements ModelRunner {
  readonly id = 'codex' as const;
  readonly label = 'Codex';
  readonly locality = 'cloud' as const;
  readonly model: string;
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: CodexRunnerOptions = {}) {
    this.command = options.command ?? 'codex';
    this.model = options.model ?? '';
    this.prefixArgs = options.prefixArgs ?? [];
    this.env = options.env ?? process.env;
  }

  private childEnv(): NodeJS.ProcessEnv {
    return withoutEnv(this.env, CODEX_HIDDEN_ENV);
  }

  async detect(): Promise<RunnerDetection> {
    const version = spawnSync(this.command, [...this.prefixArgs, '--version'], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true,
      env: this.childEnv(),
    });
    if (version.error || version.status !== 0) {
      return { available: false, detail: 'Codex CLI not found. Install it, then sign in from Settings.' };
    }
    const status = spawnSync(this.command, [...this.prefixArgs, 'login', 'status'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: this.childEnv(),
    });
    const parsed = parseCodexLoginStatus(`${status.stdout ?? ''}\n${status.stderr ?? ''}`, status.status);
    if (!parsed.loggedIn) {
      return { available: false, detail: `${version.stdout.trim()} installed but not signed in. Sign in from Settings.` };
    }
    return { available: true, detail: `${version.stdout.trim()} · ${parsed.detail}${this.model ? ` (${this.model})` : ''}` };
  }

  async run(req: RunnerRequest): Promise<unknown> {
    if (req.signal.aborted) throw abortError();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-codex-'));
    const cwd = path.join(workDir, 'cwd');
    fs.mkdirSync(cwd);
    const schemaFile = path.join(workDir, 'schema.json');
    const lastMessageFile = path.join(workDir, 'last-message.json');
    fs.writeFileSync(schemaFile, JSON.stringify(req.schema), 'utf-8');
    const input = `${req.system}\n\n=== INPUT ===\n\n${req.prompt}\n`;

    try {
      return await new Promise<unknown>((resolve, reject) => {
        const args = [...this.prefixArgs, ...buildCodexArgs({ schemaFile, lastMessageFile, cwd, model: this.model || undefined })];
        const child = spawn(this.command, args, { cwd, env: this.childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
        let settled = false;
        let buffer = '';
        let stderr = '';

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          req.signal.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = () => {
          killTree(child);
          finish(() => reject(abortError()));
        };
        req.signal.addEventListener('abort', onAbort);

        const handleLine = (line: string) => {
          if (!line.trim()) return;
          try {
            const evt = JSON.parse(line);
            const type = String(evt.type ?? evt.msg?.type ?? '');
            if (/task_started|turn\.started|session/i.test(type)) req.onProgress({ kind: 'status', text: 'Codex session started' });
            const text = evt.msg?.message ?? evt.item?.text ?? evt.delta ?? null;
            if (typeof text === 'string' && text) req.onProgress({ kind: 'token', text });
          } catch {
            // non-JSON log line
          }
        };

        child.stdout!.setEncoding('utf-8');
        child.stdout!.on('data', (chunk: string) => {
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            handleLine(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 1);
          }
        });
        child.stderr!.setEncoding('utf-8');
        child.stderr!.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-8000);
        });
        child.on('error', (err: NodeJS.ErrnoException) =>
          finish(() =>
            reject(
              err.code === 'ENOENT'
                ? new RunnerError('unavailable', 'Codex CLI not found on PATH.', err.message)
                : new RunnerError('spawn_failed', `Failed to start Codex: ${err.message}`)
            )
          )
        );
        child.on('close', (code) =>
          finish(() => {
            const last = fs.existsSync(lastMessageFile) ? fs.readFileSync(lastMessageFile, 'utf-8').trim() : '';
            if (code !== 0 || !last) {
              const detail = maskSecrets(stderr).slice(-4000);
              if (/not\s+logged\s+in|login|unauthorized|401/i.test(detail)) {
                reject(new RunnerError('auth', 'Codex is not signed in. Sign in from Settings.', detail));
              } else {
                reject(new RunnerError('runner_failed', `Codex exited ${code === null ? 'unexpectedly' : `with code ${code}`}.`, detail));
              }
              return;
            }
            try {
              resolve(JSON.parse(last));
            } catch {
              reject(new RunnerError('invalid_output', 'Codex did not return JSON.', last.slice(0, 4000)));
            }
          })
        );

        child.stdin!.on('error', () => undefined);
        child.stdin!.end(input, 'utf-8');
      });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
