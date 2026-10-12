import { spawn } from 'node:child_process';

export interface ToolOptions { command?: string; prefixArgs?: string[]; env?: NodeJS.ProcessEnv }
export interface ToolLimits { timeoutMs?: number; probeTimeoutMs?: number; outputLimit?: number }
export class ToolError extends Error {
  constructor(public readonly code: string, message: string) { super(message.slice(0, 8192)); }
}
export function positiveLimit(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Limits must be positive integers');
  return result;
}
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new ToolError('cancelled', 'Operation cancelled');
}
export function diagnostic(error: unknown) {
  return { code: error instanceof ToolError ? error.code : 'invalid-artifact', message: (error instanceof Error ? error.message : String(error)).slice(0, 8192) };
}
export async function runTool(name: string, options: ToolOptions, args: string[], config: { cwd?: string; timeoutMs?: number; outputLimit?: number; signal?: AbortSignal; stdoutOnly?: boolean } = {}): Promise<string> {
  checkAbort(config.signal);
  const timeout = positiveLimit(config.timeoutMs, 30_000);
  const cap = positiveLimit(config.outputLimit, 1024 * 1024);
  return new Promise((resolve, reject) => {
    const child = spawn(options.command ?? name, [...(options.prefixArgs ?? []), ...args], {
      cwd: config.cwd, env: { ...process.env, ...options.env, LC_ALL: 'C', LANG: 'C' },
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let done = false;
    let failure: ToolError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      config.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(Buffer.concat(output).toString('utf8'));
    };
    const stop = (code: string, message: string) => {
      if (failure || done) return;
      failure = new ToolError(code, `${name}: ${message}`);
      child.kill();
      killTimer = setTimeout(() => { child.kill('SIGKILL'); finish(failure); }, 250);
    };
    const abort = () => stop('cancelled', 'Operation cancelled');
    const timer = setTimeout(() => stop('timeout', `timed out after ${timeout}ms`), timeout);
    config.signal?.addEventListener('abort', abort, { once: true });
    if (config.signal?.aborted) abort();
    const capture = (chunk: Buffer, stderr = false) => {
      if (failure || done) return;
      bytes += chunk.length;
      if (bytes > cap) { stop('output-limit', `output exceeds ${cap} bytes`); return; }
      if (!stderr || !config.stdoutOnly) output.push(chunk);
    };
    child.stdout.on('data', chunk => capture(chunk));
    child.stderr.on('data', chunk => capture(chunk, true));
    child.on('error', error => finish(new ToolError('spawn', `${name}: ${error.message}`)));
    child.on('close', code => finish(failure ?? (code === 0 ? undefined : new ToolError('exit', `${name} exited ${code}: ${Buffer.concat(output).toString('utf8').slice(0, 8000)}`))));
  });
}

export async function detectTool(name: string, options: ToolOptions, limits: ToolLimits, signal?: AbortSignal) {
  try {
    const detail = await runTool(name, options, [name === 'pdflatex' ? '--version' : '-v'], { signal, timeoutMs: limits.probeTimeoutMs ?? 5000, outputLimit: limits.outputLimit });
    return { tool: name, available: true, detail: detail.slice(0, 8192) };
  } catch (error) {
    return { tool: name, available: false, detail: `${diagnostic(error).message}. Install ${name === 'pdflatex' ? 'MiKTeX or TeX Live' : 'Poppler utilities'} and put ${name} on PATH or configure its executable.` };
  }
}
