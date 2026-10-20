import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkAbort, detectTool, diagnostic, positiveLimit, runTool, ToolError, type ToolLimits, type ToolOptions } from './tool-process.js';

export const PDF_LIMIT = 20 * 1024 * 1024;
export async function readPdf(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > PDF_LIMIT) throw new ToolError('pdf-size', 'PDF must be a nonempty regular file no larger than 20 MiB');
  return fs.readFile(file);
}
export interface PdfPreview { page: number; mimeType: 'image/png'; bytes: Buffer }
export interface PdfValidationReport {
  passed: boolean; pageCount: number | null; pageBudget: number; coverage: number;
  missingFragments: string[]; diagnostics: { code: string; message: string }[];
}
export interface PdfVerifierOptions extends ToolLimits {
  tools?: Partial<Record<'pdfinfo' | 'pdftotext' | 'pdftoppm', ToolOptions>>;
  previewLimit?: number;
}
// TeX renders straight quotes typographically; compare their textual equivalents.
const normalize = (s: string) => s.normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
function contains(text: string, fragment: string) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(text);
}
export class PdfVerifier {
  constructor(private readonly options: PdfVerifierOptions = {}) {
    positiveLimit(options.timeoutMs, 30000); positiveLimit(options.probeTimeoutMs, 5000);
    positiveLimit(options.outputLimit, 1024 * 1024); positiveLimit(options.previewLimit, 32 * 1024 * 1024);
  }
  async detect(signal?: AbortSignal) {
    const tools = [];
    for (const name of ['pdfinfo', 'pdftotext', 'pdftoppm'] as const) {
      tools.push(await detectTool(name, this.options.tools?.[name] ?? {}, this.options, signal));
    }
    return { available: tools.every(t => t.available), tools };
  }
  async verify(pdfPath: string, input: { expectedText: string[]; pageBudget?: number; signal?: AbortSignal }) {
    const report: PdfValidationReport = { passed: false, pageCount: null, pageBudget: input.pageBudget ?? 1, coverage: 0, missingFragments: [], diagnostics: [] };
    const previews: PdfPreview[] = [];
    let dir: string | undefined;
    const run = (name: 'pdfinfo' | 'pdftotext' | 'pdftoppm', args: string[]) => runTool(name, this.options.tools?.[name] ?? {}, args, { ...this.options, signal: input.signal, stdoutOnly: true });
    try {
      checkAbort(input.signal);
      positiveLimit(report.pageBudget, 1);
      const expected = input.expectedText.map(normalize);
      if (!expected.length || expected.some(s => !s)) throw new ToolError('expectations', 'Nonempty expected text is required');
      pdfPath = path.resolve(pdfPath);
      await readPdf(pdfPath);
      const info = await run('pdfinfo', [pdfPath]);
      const match = info.match(/^Pages:\s*([1-9]\d*)\s*$/m);
      if (!match || !Number.isSafeInteger(Number(match[1]))) throw new ToolError('page-count', 'pdfinfo returned no valid page count');
      report.pageCount = Number(match[1]);
      if (report.pageCount !== report.pageBudget) throw new ToolError('page-budget', `Expected ${report.pageBudget} pages, found ${report.pageCount}`);
      const text = normalize(await run('pdftotext', ['-enc', 'UTF-8', '-layout', pdfPath, '-']));
      report.missingFragments = expected.filter(fragment => !contains(text, fragment));
      report.coverage = (expected.length - report.missingFragments.length) / expected.length;
      if (!text || report.missingFragments.length) throw new ToolError('text-coverage', 'PDF text does not cover all expected content');
      checkAbort(input.signal);
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'featherduster-pdf-'));
      await run('pdftoppm', ['-png', '-r', '100', '-f', '1', '-l', String(report.pageCount), pdfPath, path.join(dir, 'page')]);
      const files = (await fs.readdir(dir)).filter(f => /^page-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      if (files.length !== report.pageCount) throw new ToolError('preview', 'Missing preview pages');
      let total = 0;
      for (const [index, file] of files.entries()) {
        checkAbort(input.signal);
        if (Number(file.match(/\d+/)![0]) !== index + 1) throw new ToolError('preview', 'Invalid preview page sequence');
        const filename = path.join(dir, file);
        const stat = await fs.lstat(filename);
        total += stat.size;
        if (!stat.isFile() || total > (this.options.previewLimit ?? 32 * 1024 * 1024)) throw new ToolError('preview', 'Preview byte limit exceeded');
        const bytes = await fs.readFile(filename);
        if (bytes.length <= 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ToolError('preview', 'Invalid PNG preview');
        previews.push({ page: index + 1, mimeType: 'image/png', bytes });
      }
      report.passed = true;
    } catch (error) { report.diagnostics.push(diagnostic(error)); }
    finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); }
    return { report, previews: report.passed ? previews : [] };
  }
}
