import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTemplateResume, type ResumeSpec } from '@featherduster/core';
import { LatexRenderer } from '../src/render/latex-renderer.js';
import { PdfVerifier } from '../src/render/pdf-verifier.js';
import { getLatexTemplate } from '../src/jobs/templates.js';
import { runTool } from '../src/render/tool-process.js';
const fixture = fileURLToPath(new URL('./fixtures/fake-latex-tools.mjs', import.meta.url));
const spec: ResumeSpec = { profile: { name: 'Alex', title: 'Engineer', email: 'alex@example.com' }, summary: 'Improved by 3%', experiences: [], education: [], skills: [] };
const text = compileTemplateResume(getLatexTemplate('default'), spec).expectedText.join('\n');
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'latex test ')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
function setup(env: Record<string, string> = {}, limits = {}) {
  const tool = (name: string) => ({ command: process.execPath, prefixArgs: [fixture, name], env: { TEXT: text, TRACE: path.join(root, 'trace'), ...env } });
  const verifier = new PdfVerifier({ tools: { pdfinfo: tool('pdfinfo'), pdftotext: tool('pdftotext'), pdftoppm: tool('pdftoppm') }, ...limits });
  return { verifier, renderer: new LatexRenderer({ ...tool('pdflatex'), verifier, ...limits }) };
}
async function trace() { return (await fs.readFile(path.join(root, 'trace'), 'utf8')).trim().split('\n').map(s => JSON.parse(s)); }
describe('LaTeX independent PDF gate', () => {
  it('returns durable artifacts from isolated concurrent compilations', async () => {
    const { renderer } = setup();
    const results = await Promise.all([1, 2].map(() => renderer.renderPdf({ templateId: 'default', spec })));
    for (const result of results) { expect(result.status).toBe('passed'); expect(result.pdf?.length).toBeGreaterThan(0); expect(result.previews).toHaveLength(1); }
    const compiles = (await trace()).filter(t => t.args.includes('resume.tex'));
    expect(new Set(compiles.map(t => t.cwd)).size).toBe(2);
    for (const t of compiles) { expect(t.args).toContain('-no-shell-escape'); await expect(fs.stat(t.cwd)).rejects.toThrow(); }
  });
  it.each(['pdflatex', 'pdfinfo', 'pdftotext', 'pdftoppm'])('blocks when %s is unavailable', async tool => {
    const { renderer } = setup({ MISSING: tool });
    const result = await renderer.renderPdf({ templateId: 'default', spec });
    expect(result.status).toBe('blocked'); expect(result.diagnostics[0].message).toContain('PATH');
    expect((await trace()).some(t => t.args.includes('resume.tex'))).toBe(false);
  });
  it('rejects unknown profiles and nonexistent executables', async () => {
    expect((await setup().renderer.preflight('unknown')).available).toBe(false);
    await expect(runTool('missing', { command: path.join(root, 'nonexistent') }, [])).rejects.toMatchObject({ code: 'spawn' });
  });
  it.each(['compile-error', 'absent', 'empty', 'bad-info', 'preview-error', 'missing-preview', 'bad-png'])('fails closed and cleans up: %s', async MODE => {
    const result = await setup({ MODE }).renderer.renderPdf({ templateId: 'default', spec });
    expect(result.status).toBe('failed'); expect(result.source).toContain('Alex');
    const compile = (await trace()).find(t => t.args.includes('resume.tex'));
    await expect(fs.stat(compile.cwd)).rejects.toThrow();
  });
  it('uses written page counts, never compiler logs', async () => {
    const result = await setup({ PAGES: '2' }).renderer.renderPdf({ templateId: 'default', spec });
    expect(result.report?.pageCount).toBe(2); expect(result.status).toBe('failed');
  });
  it.each(['', text.replace('3%', '33%'), text.replace('Engineer', '')])('rejects missing or changed text: %s', async TEXT => {
    const result = await setup({ TEXT }).renderer.renderPdf({ templateId: 'default', spec });
    expect(result.status).toBe('failed'); expect(result.report?.coverage).toBeLessThan(1);
  });
  it('verifies standalone PDFs, normalizes text and orders ten previews', async () => {
    const pdf = path.join(root, 'written file.pdf');
    await fs.writeFile(pdf, JSON.stringify({ pages: 10, text: 'ofﬁce\n  increased 3%' }));
    const result = await setup().verifier.verify(pdf, { pageBudget: 10, expectedText: ['office increased 3%'] });
    expect(result.report.passed).toBe(true); expect(result.previews.map(p => p.page)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect((await fs.stat(pdf)).size).toBeGreaterThan(0);
  });
  it('honors an explicitly selected two-page trusted profile', async () => {
    const { verifier } = setup();
    const renderer = new LatexRenderer({ command: process.execPath, prefixArgs: [fixture, 'pdflatex'], env: { TEXT: text, PAGES: '2' }, verifier,
      profiles: [{ ...getLatexTemplate('default'), id: 'two', page_budget: 2 }],
    });
    const result = await renderer.renderPdf({ templateId: 'two', spec });
    expect(result.status).toBe('passed'); expect(result.previews).toHaveLength(2);
  });
  it('rejects malformed, empty, oversized PDFs and empty expectations', async () => {
    const pdf = path.join(root, 'input.pdf');
    const { verifier } = setup();
    for (const content of ['', '%PDF-1.7']) {
      await fs.writeFile(pdf, content);
      expect((await verifier.verify(pdf, { expectedText: ['Alex'] })).report.passed).toBe(false);
    }
    await fs.truncate(pdf, 21 * 1024 * 1024);
    expect((await verifier.verify(pdf, { expectedText: ['Alex'] })).report.diagnostics[0].code).toBe('pdf-size');
    expect((await verifier.verify(pdf, { expectedText: [] })).report.passed).toBe(false);
  });
  it('bounds preview bytes', async () => {
    const result = await setup({}, { previewLimit: 8 }).renderer.renderPdf({ templateId: 'default', spec });
    expect(result.status).toBe('failed');
  });
  it('bounds output including oversized chunks, time and cancellation', async () => {
    await expect(runTool('node', { command: process.execPath }, ['-e', 'process.stdout.write("x".repeat(100000))'], { outputLimit: 20 })).rejects.toMatchObject({ code: 'output-limit' });
    await expect(runTool('node', { command: process.execPath }, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController();
    const promise = runTool('node', { command: process.execPath }, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('blocks hung probes', async () => {
    expect((await setup({ MODE: 'probe-hang' }, { probeTimeoutMs: 100 }).renderer.preflight('default')).available).toBe(false);
  });
});
