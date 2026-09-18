import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TypstRendererOptions {
  /** Executable to spawn. Defaults to `typst` resolved from PATH. */
  command?: string;
  /** Extra leading args (tests run a fake CLI through `node`). */
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
  /** How long a detection result stays cached, in ms. */
  detectCacheMs?: number;
}

export interface TypstDetection {
  available: boolean;
  /** Version banner when installed, install hint when not. */
  detail: string;
}

export interface TypstSvgRender extends TypstDetection {
  /** One SVG document per page, in page order. Empty when the render failed. */
  pages: string[];
  /** Typst diagnostics when compilation failed, else null. */
  error: string | null;
}

export interface TypstPdfRender extends TypstDetection {
  pdf: Buffer | null;
  error: string | null;
}

export const TYPST_INSTALL_HINT =
  'Typst CLI not found on PATH. Install it (winget install Typst.Typst, brew install typst, or cargo install typst-cli) to enable the rendered preview.';

/** Caps captured output so a runaway diagnostic dump cannot exhaust memory. */
const OUTPUT_CAP = 16 * 1024 * 1024;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

/**
 * Runs a child process without blocking the event loop. `spawnSync` would freeze
 * the whole server for the length of every render, stalling unrelated API calls.
 */
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      resolve({ status: null, stdout: '', stderr: '', error: err });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      if (stdout.length < OUTPUT_CAP) stdout += d;
    });
    child.stderr?.on('data', (d) => {
      if (stderr.length < OUTPUT_CAP) stderr += d;
    });

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.on('close', (status) =>
      finish({
        status,
        stdout,
        stderr,
        error: timedOut ? new Error(`typst timed out after ${timeoutMs}ms`) : null,
      })
    );
  });
}

/** Orders `page-2.svg` before `page-10.svg`, which a lexical sort would not. */
function byPageNumber(a: string, b: string): number {
  const num = (f: string) => Number(f.match(/(\d+)\.svg$/i)?.[1] ?? 0);
  return num(a) - num(b);
}

/**
 * Renders Typst source by shelling out to the local `typst` binary. The CLI is
 * optional: when it is missing the caller gets `available: false` and a hint
 * rather than an error, so the UI can fall back to showing the source.
 */
export class TypstRenderer {
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly detectCacheMs: number;
  private cached: { at: number; result: TypstDetection } | null = null;
  private inFlightDetect: Promise<TypstDetection> | null = null;

  constructor(options: TypstRendererOptions = {}) {
    this.command = options.command ?? 'typst';
    this.prefixArgs = options.prefixArgs ?? [];
    this.env = options.env ?? process.env;
    this.detectCacheMs = options.detectCacheMs ?? 10_000;
  }

  /**
   * Probes the binary. Cached briefly because the preview re-renders on every
   * keystroke, while still picking up a fresh install without a server restart.
   * Concurrent callers share one probe.
   */
  async detect(): Promise<TypstDetection> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < this.detectCacheMs) {
      return this.cached.result;
    }
    if (this.inFlightDetect) return this.inFlightDetect;

    this.inFlightDetect = (async () => {
      const probe = await run(this.command, [...this.prefixArgs, '--version'], this.env, 15_000);
      const result: TypstDetection =
        probe.error || probe.status !== 0
          ? { available: false, detail: TYPST_INSTALL_HINT }
          : { available: true, detail: probe.stdout.trim() || 'typst' };
      this.cached = { at: Date.now(), result };
      return result;
    })();

    try {
      return await this.inFlightDetect;
    } finally {
      this.inFlightDetect = null;
    }
  }

  private async compile(
    source: string,
    target: 'svg' | 'pdf'
  ): Promise<{ dir: string; error: string | null }> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'featherduster-typst-'));
    const input = path.join(dir, 'resume.typ');
    await fs.promises.writeFile(input, source, 'utf-8');

    // `{n}` is required for SVG so multi-page resumes emit one file per page.
    const output = target === 'svg' ? path.join(dir, 'page-{n}.svg') : path.join(dir, 'resume.pdf');
    const result = await run(
      this.command,
      [...this.prefixArgs, 'compile', '--format', target, '--root', dir, input, output],
      this.env,
      30_000
    );

    if (result.error || result.status !== 0) {
      const diagnostics = `${result.stderr}${result.stdout}`.trim();
      return {
        dir,
        error: diagnostics || result.error?.message || `typst exited with code ${result.status}`,
      };
    }
    return { dir, error: null };
  }

  /** Renders every page to SVG markup. */
  async renderSvg(source: string): Promise<TypstSvgRender> {
    const detection = await this.detect();
    if (!detection.available) {
      return { ...detection, pages: [], error: null };
    }

    let dir: string | null = null;
    try {
      const compiled = await this.compile(source, 'svg');
      dir = compiled.dir;
      if (compiled.error) {
        return { ...detection, pages: [], error: compiled.error };
      }
      const files = (await fs.promises.readdir(dir))
        .filter((f) => f.toLowerCase().endsWith('.svg'))
        .sort(byPageNumber);
      const pages = await Promise.all(
        files.map((f) => fs.promises.readFile(path.join(dir!, f), 'utf-8'))
      );
      if (pages.length === 0) {
        return { ...detection, pages: [], error: 'typst produced no pages' };
      }
      return { ...detection, pages, error: null };
    } catch (err: any) {
      return { ...detection, pages: [], error: err?.message || 'Typst render failed' };
    } finally {
      if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }

  /** Typesets to PDF and returns the bytes. */
  async renderPdf(source: string): Promise<TypstPdfRender> {
    const detection = await this.detect();
    if (!detection.available) {
      return { ...detection, pdf: null, error: null };
    }

    let dir: string | null = null;
    try {
      const compiled = await this.compile(source, 'pdf');
      dir = compiled.dir;
      if (compiled.error) {
        return { ...detection, pdf: null, error: compiled.error };
      }
      const pdfPath = path.join(dir, 'resume.pdf');
      try {
        return { ...detection, pdf: await fs.promises.readFile(pdfPath), error: null };
      } catch {
        return { ...detection, pdf: null, error: 'typst produced no PDF' };
      }
    } catch (err: any) {
      return { ...detection, pdf: null, error: err?.message || 'Typst render failed' };
    } finally {
      if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
}
