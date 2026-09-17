import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abortError, RunnerError, type ModelRunner, type RunnerDetection, type RunnerRequest } from './types.js';

export interface ClaudeCodeRunnerOptions {
  /** Executable to spawn. Defaults to `claude` resolved from PATH. */
  command?: string;
  /** Model alias or id passed via --model; empty = CLI default. */
  model?: string;
  /** Extra leading args (used by tests to run a fake CLI through `node`). */
  prefixArgs?: string[];
}

const AUTH_HINT = /not logged in|please run .*login|invalid api key|authentication|unauthorized|oauth/i;

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

/** Builds the argv for a headless, tool-less, settings-isolated structured-output call. */
export function buildClaudeArgs(opts: { schema: Record<string, unknown>; systemPromptFile: string; model?: string }): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--json-schema',
    JSON.stringify(opts.schema),
    '--tools',
    '',
    '--system-prompt-file',
    opts.systemPromptFile,
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (opts.model) args.push('--model', opts.model);
  return args;
}

/**
 * Runs the local Claude Code CLI headlessly. The prompt goes over stdin and the
 * system prompt via a temp file so large ledgers never hit OS argv limits. The
 * process runs in an empty temp directory with every tool disabled and user/project
 * settings, hooks, and MCP servers excluded, so it cannot read the workspace.
 */
export class ClaudeCodeRunner implements ModelRunner {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  readonly locality = 'cloud' as const;
  readonly model: string;
  private readonly command: string;
  private readonly prefixArgs: string[];

  constructor(options: ClaudeCodeRunnerOptions = {}) {
    this.command = options.command ?? 'claude';
    this.model = options.model ?? '';
    this.prefixArgs = options.prefixArgs ?? [];
  }

  async detect(): Promise<RunnerDetection> {
    const result = spawnSync(this.command, [...this.prefixArgs, '--version'], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      return {
        available: false,
        detail: 'Claude Code CLI not found. Install it from https://claude.com/claude-code and run `claude` once to log in.',
      };
    }
    return { available: true, detail: result.stdout.trim() || 'Claude Code detected' };
  }

  async run(req: RunnerRequest): Promise<unknown> {
    if (req.signal.aborted) throw abortError();

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-claude-'));
    const systemPromptFile = path.join(workDir, 'system.md');
    fs.writeFileSync(systemPromptFile, req.system, 'utf-8');
    const runDir = path.join(workDir, 'cwd');
    fs.mkdirSync(runDir);

    try {
      return await new Promise<unknown>((resolve, reject) => {
        const args = [
          ...this.prefixArgs,
          ...buildClaudeArgs({ schema: req.schema, systemPromptFile, model: this.model || undefined }),
        ];
        const child = spawn(this.command, args, {
          cwd: runDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });

        let settled = false;
        let stdoutBuffer = '';
        let stderr = '';
        let finalEvent: any = null;

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
          const trimmed = line.trim();
          if (!trimmed) return;
          let evt: any;
          try {
            evt = JSON.parse(trimmed);
          } catch {
            return;
          }
          if (evt.type === 'system' && evt.subtype === 'init') {
            req.onProgress({ kind: 'status', text: `Claude Code session started${evt.model ? ` (${evt.model})` : ''}` });
          } else if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
            for (const block of evt.message.content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                req.onProgress({ kind: 'token', text: block.text });
              } else if (block?.type === 'tool_use') {
                req.onProgress({ kind: 'status', text: 'Emitting structured output…' });
              }
            }
          } else if (evt.type === 'result') {
            finalEvent = evt;
          }
        };

        child.stdout!.setEncoding('utf-8');
        child.stdout!.on('data', (chunk: string) => {
          stdoutBuffer += chunk;
          let idx: number;
          while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
            handleLine(stdoutBuffer.slice(0, idx));
            stdoutBuffer = stdoutBuffer.slice(idx + 1);
          }
        });
        child.stderr!.setEncoding('utf-8');
        child.stderr!.on('data', (chunk: string) => {
          stderr += chunk;
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
          finish(() =>
            reject(
              err.code === 'ENOENT'
                ? new RunnerError('unavailable', 'Claude Code CLI not found on PATH.', err.message)
                : new RunnerError('spawn_failed', `Failed to start Claude Code: ${err.message}`)
            )
          );
        });

        child.on('close', (code) => {
          if (stdoutBuffer) handleLine(stdoutBuffer);
          finish(() => {
            const errorText = [finalEvent?.result, stderr].filter((s) => typeof s === 'string' && s).join('\n');
            if (!finalEvent || finalEvent.is_error || code !== 0) {
              if (AUTH_HINT.test(errorText)) {
                reject(new RunnerError('auth', 'Claude Code is not logged in. Run `claude` once to log in.', errorText));
                return;
              }
              reject(
                new RunnerError(
                  'runner_failed',
                  `Claude Code exited ${code === null ? 'unexpectedly' : `with code ${code}`}.`,
                  errorText.slice(0, 4000)
                )
              );
              return;
            }
            if (finalEvent.structured_output !== undefined && finalEvent.structured_output !== null) {
              resolve(finalEvent.structured_output);
              return;
            }
            try {
              resolve(JSON.parse(String(finalEvent.result ?? '')));
            } catch {
              reject(new RunnerError('invalid_output', 'Claude Code did not return JSON.', String(finalEvent.result ?? '').slice(0, 4000)));
            }
          });
        });

        child.stdin!.on('error', () => {
          // Process may exit before consuming stdin; the close handler reports the failure.
        });
        child.stdin!.end(req.prompt, 'utf-8');
      });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
