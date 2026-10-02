import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LatexRendererOptions {
  command?: string;
  env?: NodeJS.ProcessEnv;
  detectCacheMs?: number;
  timeoutMs?: number;
}

export interface LatexPdfRender {
  available: boolean;
  detail: string;
  pdf: Buffer | null;
  error: string | null;
}

const INSTALL_HINT = 'LaTeX compiler not found on PATH. Install MiKTeX or TeX Live to enable PDF export.';
const OUTPUT_CAP = 16 * 1024 * 1024;

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error: any) {
      resolve({ status: null, stdout: '', stderr: '', error });
      return;
    }
    let stdout = '', stderr = '', settled = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout?.on('data', (data) => { if (stdout.length < OUTPUT_CAP) stdout += data; });
    child.stderr?.on('data', (data) => { if (stderr.length < OUTPUT_CAP) stderr += data; });
    const finish = (result: { status: number | null; stdout: string; stderr: string; error: Error | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.on('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.on('close', (status) => finish({ status, stdout, stderr, error: timedOut ? new Error(`LaTeX timed out after ${timeoutMs}ms`) : null }));
  });
}

export class LatexRenderer {
  private readonly command: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly detectCacheMs: number;
  private readonly timeoutMs: number;
  private cached: { at: number; available: boolean; detail: string } | null = null;

  constructor(options: LatexRendererOptions = {}) {
    // pdflatex is the broadly available engine and does not require Perl
    // (unlike latexmk on a default MiKTeX installation).
    this.command = options.command ?? 'pdflatex';
    this.env = options.env ?? process.env;
    this.detectCacheMs = options.detectCacheMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async detect(): Promise<{ available: boolean; detail: string }> {
    if (this.cached && Date.now() - this.cached.at < this.detectCacheMs) return this.cached;
    const probe = await run(this.command, ['--version'], this.env, 15_000);
    const result = probe.error || probe.status !== 0
      ? { available: false, detail: INSTALL_HINT }
      : { available: true, detail: (probe.stdout || probe.stderr).trim() || 'pdflatex' };
    this.cached = { ...result, at: Date.now() };
    return result;
  }

  async renderPdf(source: string): Promise<LatexPdfRender> {
    const detection = await this.detect();
    if (!detection.available) return { ...detection, pdf: null, error: null };
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'featherduster-latex-'));
    try {
      const input = path.join(dir, 'resume.tex');
      await fs.promises.writeFile(input, source, 'utf8');
      const result = await run(this.command, ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-output-directory', dir, input], this.env, this.timeoutMs);
      if (result.error || result.status !== 0) {
        return { ...detection, pdf: null, error: `${result.stdout}\n${result.stderr}`.trim() || result.error?.message || `latexmk exited with code ${result.status}` };
      }
      const pdfPath = path.join(dir, 'resume.pdf');
      return { ...detection, pdf: await fs.promises.readFile(pdfPath), error: null };
    } catch (error: any) {
      return { ...detection, pdf: null, error: error?.message || 'LaTeX export failed' };
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
}
