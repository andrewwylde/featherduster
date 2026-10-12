import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileTemplateResume, LatexTemplateProfileSchema, type LatexTemplateProfile, type PrivacyRulesConfig, type ResumeSpec } from '@featherduster/core';
import { listLatexTemplates } from '../jobs/templates.js';
import { PdfVerifier, readPdf, type PdfPreview, type PdfValidationReport } from './pdf-verifier.js';
import { checkAbort, detectTool, diagnostic, positiveLimit, runTool, type ToolLimits, type ToolOptions } from './tool-process.js';

export interface LatexRendererOptions extends ToolLimits, ToolOptions {
  /** Application-owned executable profiles only; never accept model/request templates. */
  profiles?: readonly LatexTemplateProfile[];
  verifier?: PdfVerifier;
  /** Native MiKTeX requires --disable-installer; TeX Live never installs packages. */
  distribution?: 'texlive' | 'miktex';
}
export interface LatexRenderResult {
  status: 'passed' | 'blocked' | 'failed'; source?: string; pdf?: Buffer;
  previews: PdfPreview[]; report?: PdfValidationReport;
  diagnostics: { code: string; message: string }[];
}
export class LatexRenderer {
  private readonly profiles: LatexTemplateProfile[];
  private readonly verifier: PdfVerifier;
  constructor(private readonly options: LatexRendererOptions = {}) {
    this.profiles = (options.profiles ?? listLatexTemplates()).map(p => LatexTemplateProfileSchema.parse(p));
    if (new Set(this.profiles.map(p => p.id)).size !== this.profiles.length) throw new Error('Duplicate template IDs');
    this.verifier = options.verifier ?? new PdfVerifier(options);
    positiveLimit(options.timeoutMs, 30000); positiveLimit(options.probeTimeoutMs, 5000); positiveLimit(options.outputLimit, 1024 * 1024);
  }
  async preflight(templateId: string, signal?: AbortSignal) {
    const profile = this.profiles.find(p => p.id === templateId);
    if (!profile) return { available: false, tools: [], diagnostics: [{ code: 'template', message: `Unknown LaTeX template: ${templateId}` }] };
    const compiler = await detectTool('pdflatex', this.options, this.options, signal);
    const inspection = await this.verifier.detect(signal);
    const tools = [compiler, ...inspection.tools];
    return { available: tools.every(t => t.available), tools, diagnostics: tools.filter(t => !t.available).map(t => ({ code: 'tool-unavailable', message: t.detail })) };
  }
  async renderPdf(input: { templateId: string; spec: ResumeSpec; rules?: PrivacyRulesConfig; signal?: AbortSignal }): Promise<LatexRenderResult> {
    const detection = await this.preflight(input.templateId, input.signal);
    if (!detection.available) return { status: 'blocked', previews: [], diagnostics: detection.diagnostics };
    const result: LatexRenderResult = { status: 'failed', previews: [], diagnostics: [] };
    let dir: string | undefined;
    try {
      checkAbort(input.signal);
      const profile = this.profiles.find(p => p.id === input.templateId)!;
      const compiled = compileTemplateResume(profile, input.spec, input.rules);
      result.source = compiled.source;
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'featherduster-latex-'));
      await fs.writeFile(path.join(dir, 'resume.tex'), compiled.source);
      // MiKTeX also advertises itself in its version banner, so default invocation is safe.
      const miktex = this.options.distribution === 'miktex' || /miktex/i.test(detection.tools[0]?.detail ?? '');
      await runTool('pdflatex', this.options, [
        ...(miktex ? ['--disable-installer'] : []), '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-output-directory', dir, 'resume.tex',
      ], { ...this.options, cwd: dir, signal: input.signal });
      const pdfPath = path.join(dir, 'resume.pdf');
      result.pdf = await readPdf(pdfPath);
      const validation = await this.verifier.verify(pdfPath, { expectedText: compiled.expectedText, pageBudget: profile.page_budget, signal: input.signal });
      result.report = validation.report;
      result.previews = validation.previews;
      result.diagnostics = validation.report.diagnostics;
      if (validation.report.passed) result.status = 'passed';
    } catch (error) { result.diagnostics.push(diagnostic(error)); }
    finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); }
    return result;
  }
}
