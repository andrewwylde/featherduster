import { execFile } from 'node:child_process';

/** Bounded discovery without starving HTTP requests or PDF process completion. */
export function discoveryProcess(command: string, args: string[], options: { timeout: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ stdout: string; stderr: string; status: number | null; error?: Error }>(resolve => {
    execFile(command, args, { ...options, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        error: error && typeof error.code !== 'number' ? error : undefined });
    });
  });
}
