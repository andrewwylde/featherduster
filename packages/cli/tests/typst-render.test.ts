import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { TypstRenderer, TYPST_INSTALL_HINT } from '../src/render/typst-renderer.js';
import { createApp } from '../src/server.js';
import type { ResumeSpec } from '@featherduster/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeTypst = path.join(here, 'fixtures', 'fake-typst.mjs');

const renderer = (env: NodeJS.ProcessEnv = {}) =>
  new TypstRenderer({
    command: process.execPath,
    prefixArgs: [fakeTypst],
    env: { ...process.env, ...env },
    // Detection caching would leak state between tests.
    detectCacheMs: 0,
  });

const sampleResumeSpec: ResumeSpec = {
  profile: {
    name: 'Alex Mercer',
    title: 'Staff Software Engineer',
    email: 'alex@example.com',
    location: 'Austin, TX',
  },
  summary: 'Builds resilient distributed systems.',
  experiences: [
    {
      company: 'cloudmatrix',
      role: 'Senior Engineer',
      startDate: '2022',
      endDate: 'Present',
      bullets: [{ text: 'Cut re-auth events by 99.4% across 140k daily sessions.' }],
    },
  ],
  education: [],
  skills: [],
};

describe('TypstRenderer', () => {
  it('reports the installed version when the binary answers --version', async () => {
    const detection = await renderer().detect();
    expect(detection.available).toBe(true);
    expect(detection.detail).toContain('typst 0.13.1');
  });

  it('reports an install hint instead of throwing when the binary is absent', async () => {
    const detection = await renderer({ FAKE_TYPST_MODE: 'missing' }).detect();
    expect(detection.available).toBe(false);
    expect(detection.detail).toBe(TYPST_INSTALL_HINT);
  });

  it('caches detection so a keystroke-driven preview does not spawn a probe per render', async () => {
    const vanishFlag = path.join(os.tmpdir(), `fd-typst-vanish-${Date.now()}.flag`);
    const env = { ...process.env, FAKE_TYPST_VANISH_WHEN: vanishFlag };
    const cached = new TypstRenderer({
      command: process.execPath,
      prefixArgs: [fakeTypst],
      env,
      detectCacheMs: 60_000,
    });
    const uncached = new TypstRenderer({
      command: process.execPath,
      prefixArgs: [fakeTypst],
      env,
      detectCacheMs: 0,
    });

    expect((await cached.detect()).available).toBe(true);
    try {
      fs.writeFileSync(vanishFlag, '');
      // The binary is gone, but the cached probe still stands...
      expect((await cached.detect()).available).toBe(true);
      // ...while an uncached probe sees the truth.
      expect((await uncached.detect()).available).toBe(false);
    } finally {
      fs.rmSync(vanishFlag, { force: true });
    }
  });

  it('renders one SVG document per page, in page order', async () => {
    // Real typst zero-pads these filenames (page-01.svg ... page-11.svg).
    const result = await renderer({ FAKE_TYPST_PAGES: '11' }).renderSvg('= Hello');
    expect(result.available).toBe(true);
    expect(result.error).toBeNull();
    expect(result.pages).toHaveLength(11);
    const order = result.pages.map((p) => Number(p.match(/data-page="(\d+)"/)![1]));
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('orders pages numerically even when the filenames are not zero-padded', async () => {
    const result = await renderer({ FAKE_TYPST_PAGES: '11', FAKE_TYPST_PAD: 'off' }).renderSvg('= Hello');
    const order = result.pages.map((p) => Number(p.match(/data-page="(\d+)"/)![1]));
    // A lexical sort would put page 10 and 11 ahead of page 2.
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('surfaces typst diagnostics when compilation fails', async () => {
    const result = await renderer({ FAKE_TYPST_MODE: 'fail' }).renderSvg('= Broken');
    expect(result.available).toBe(true);
    expect(result.pages).toEqual([]);
    expect(result.error).toContain('unknown variable: wobble');
  });

  it('returns no pages and no error when the binary is missing', async () => {
    const result = await renderer({ FAKE_TYPST_MODE: 'missing' }).renderSvg('= Hello');
    expect(result.available).toBe(false);
    expect(result.pages).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('typesets PDF bytes', async () => {
    const result = await renderer().renderPdf('= Hello');
    expect(result.error).toBeNull();
    expect(result.pdf?.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
  });

  it('cleans up its temp directories', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('featherduster-typst-'));
    await renderer({ FAKE_TYPST_PAGES: '3' }).renderSvg('= Hello');
    await renderer({ FAKE_TYPST_MODE: 'fail' }).renderSvg('= Hello');
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('featherduster-typst-'));
    expect(after.length).toBe(before.length);
  });
});

describe('Typst render endpoints', () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-typst-server-'));
    fs.mkdirSync(path.join(tmpWorkspace, '.featherduster'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, '.featherduster', 'privacy-rules.yaml'),
      yaml.dump({ replacements: [{ search: 'cloudmatrix', replace: 'Acme Health Systems' }] })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  const appWith = (env: NodeJS.ProcessEnv = {}) =>
    createApp(tmpWorkspace, { typstRenderer: renderer(env) });

  const post = (app: ReturnType<typeof createApp>, url: string, spec: unknown) =>
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec }),
    });

  it('returns rendered pages alongside the redacted source', async () => {
    const res = await post(appWith({ FAKE_TYPST_PAGES: '2' }), '/api/resumes/render', sampleResumeSpec);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.pages).toHaveLength(2);
    expect(body.error).toBeNull();
    expect(body.source).toContain('Alex Mercer');
    // Privacy rules apply to the rendered source, same as /compile.
    expect(body.source).toContain('Acme Health Systems');
    expect(body.source).not.toContain('cloudmatrix');
  });

  it('reports a missing binary as a 200 with an install hint, not an error', async () => {
    const res = await post(appWith({ FAKE_TYPST_MODE: 'missing' }), '/api/resumes/render', sampleResumeSpec);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.detail).toBe(TYPST_INSTALL_HINT);
    // The source still comes back so the UI can fall back to showing it.
    expect(body.source).toContain('Alex Mercer');
  });

  it('renders without blocking the event loop', async () => {
    // A spawnSync-based renderer serializes these and freezes every other route
    // for the duration — which is what made the whole app hang mid-load.
    const app = appWith({ FAKE_TYPST_DELAY_MS: '400' });
    const started = Date.now();
    const [a, b, c, health] = await Promise.all([
      post(app, '/api/resumes/render', sampleResumeSpec),
      post(app, '/api/resumes/render', sampleResumeSpec),
      post(app, '/api/resumes/render', sampleResumeSpec),
      app.request('/api/health'),
    ]);
    const elapsed = Date.now() - started;

    expect([a.status, b.status, c.status, health.status]).toEqual([200, 200, 200, 200]);
    // Serialized, three 400ms renders would take 1.2s+; overlapped, ~400ms.
    expect(elapsed).toBeLessThan(1000);
  });

  it('rejects a request with no spec', async () => {
    const res = await post(appWith(), '/api/resumes/render', undefined);
    expect(res.status).toBe(400);
  });

  it('serves a PDF download', async () => {
    const res = await post(appWith(), '/api/resumes/render/pdf', sampleResumeSpec);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('resume.pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString('utf-8')).toBe('%PDF-');
  });

  it('answers 503 for a PDF export with no typst installed', async () => {
    const res = await post(appWith({ FAKE_TYPST_MODE: 'missing' }), '/api/resumes/render/pdf', sampleResumeSpec);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('typst_not_installed');
  });

  it('answers 422 with diagnostics when typst cannot compile the resume', async () => {
    const res = await post(appWith({ FAKE_TYPST_MODE: 'fail' }), '/api/resumes/render/pdf', sampleResumeSpec);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('typst_compile_failed');
    expect(body.error).toContain('unknown variable: wobble');
  });
});
