// packages/cli/src/jobs/checked-render.ts
import type { DraftIssue } from '@featherduster/core';
import type { LatexRenderer } from '../render/latex-renderer.js';
export interface CheckedPdf {
  source: string; pdf: string; previews: string[];
  report: { passed: true; pageCount: number; pageBudget: number; coverage: number;
    missingFragments: string[]; diagnostics: { code: string; message: string }[] };
}
export async function checkedRender(renderer: Pick<LatexRenderer, 'renderPdf'>,
  request: Parameters<LatexRenderer['renderPdf']>[0], budget: number): Promise<{
    status: 'ready' | 'blocked' | 'unavailable'; issues: DraftIssue[]; output?: CheckedPdf; failure?: unknown;
  }> {
  try {
    const r = await renderer.renderPdf(request);
    if (request.signal?.aborted) throw request.signal.reason;
    const report = r.report;
    if (r.status === 'passed' && report?.passed && typeof report.pageCount === 'number' && report.pageCount > 0 && report.pageCount <= budget && report.pageBudget === budget
      && r.source && r.pdf?.length && r.previews.length && r.previews.every(p => p.bytes.length)) {
      return { status: 'ready', issues: [], output: { source: r.source, pdf: r.pdf.toString('base64'),
        previews: r.previews.map(p => p.bytes.toString('base64')), report: { ...report, pageCount: report.pageCount, passed: true } } };
    }
    const status: 'blocked' | 'unavailable' = report ? 'blocked' : 'unavailable';
    const diagnostics = r.diagnostics.length ? r.diagnostics : [{ code: 'pdf_layout', message: 'The PDF did not pass its required layout checks.' }];
    return { status, failure: { ...r, pdf: r.pdf?.toString('base64'), previews: r.previews.map(p => ({ ...p, bytes: p.bytes.toString('base64') })) }, issues: diagnostics.map(d => ({ path: '', severity: 'block', ...d })) };
  } catch (error) {
    return { status: 'unavailable', failure: { diagnostics: [{ code: 'renderer_exception', message: String(error) }] }, issues: [{ path: '', code: 'renderer_unavailable', severity: 'block', message: error instanceof Error ? error.message : 'PDF checks unavailable.' }] };
  }
}

