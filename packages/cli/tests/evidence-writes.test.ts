import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { WorkspaceWatcher } from '../src/watcher.js';
import { serializeEvidenceMarkdown, type EvidenceEntry } from '@featherduster/core';

const entry = (overrides: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  id: 'ev-100',
  date: '2026-01-01',
  company: 'acme',
  title: 'Gateway rewrite',
  summary: 'Rewrote the gateway.',
  impact: 'Cut CPU by [METRIC NEEDED].',
  themes: ['performance'],
  confidence: 'provisional',
  in_flight: false,
  metrics: [],
  internal_references: [],
  ...overrides,
});

const LEDGER = `# Ledger

\`\`\`yaml
entries:
  - id: ev-200
    date: '2026-02-01'
    company: acme
    title: Ledger entry one
    summary: One.
    impact: One impact.
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
  - id: ev-201
    date: '2026-02-02'
    company: acme
    title: Ledger entry two
    summary: Two.
    impact: Two impact.
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
\`\`\`
`;

describe('evidence write safety', () => {
  let ws: string;
  let app: ReturnType<typeof createApp>;

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4173' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-evwrite-'));
    fs.mkdirSync(path.join(ws, 'evidence', 'acme'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'companies', 'acme', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'evidence', 'acme', 'ev-100.md'), serializeEvidenceMarkdown(entry(), 'Narrative.'));
    fs.writeFileSync(path.join(ws, 'companies', 'acme', 'evidence', 'evidence-ledger.md'), LEDGER);
    app = createApp(ws, { watcher: new WorkspaceWatcher(ws) });
  });

  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it('rejects creating evidence with an ID that already exists', async () => {
    const res = await call('POST', '/api/evidence', { entry: entry({ title: 'Different' }), narrative: '' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('duplicate_id');
    expect(fs.readFileSync(path.join(ws, 'evidence', 'acme', 'ev-100.md'), 'utf-8')).toContain('Gateway rewrite');
  });

  it('rejects creating evidence that collides with a ledger entry ID', async () => {
    const res = await call('POST', '/api/evidence', { entry: entry({ id: 'ev-200' }) });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('duplicate_id');
  });

  it('refuses to write a single entry over a consolidated ledger file', async () => {
    const res = await call('POST', '/api/evidence', {
      entry: entry({ id: 'ev-999' }),
      filePath: 'companies/acme/evidence/evidence-ledger.md',
    });
    expect([403, 409]).toContain(res.status);
    expect(fs.readFileSync(path.join(ws, 'companies', 'acme', 'evidence', 'evidence-ledger.md'), 'utf-8')).toBe(LEDGER);
  });

  it('still creates new evidence with a fresh ID', async () => {
    const res = await call('POST', '/api/evidence', { entry: entry({ id: 'ev-101' }) });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(ws, 'evidence', 'acme', 'ev-101.md'))).toBe(true);
  });

  it('updates a single-entry evidence file in place via PUT', async () => {
    const res = await call('PUT', '/api/evidence/ev-100', {
      entry: entry({ impact: 'Cut CPU by 30%.', metrics: [{ name: 'cpu', value: '30%', status: 'verified' }] }),
      narrative: 'Updated narrative.',
    });
    expect(res.status).toBe(200);
    expect(res.json.filePath).toBe('evidence/acme/ev-100.md');
    const text = fs.readFileSync(path.join(ws, 'evidence', 'acme', 'ev-100.md'), 'utf-8');
    expect(text).toContain('Cut CPU by 30%.');
    expect(text).toContain('Updated narrative.');
  });

  it('refuses PUT for ledger-backed entries and reports the ledger path', async () => {
    const res = await call('PUT', '/api/evidence/ev-200', { entry: entry({ id: 'ev-200' }) });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('ledger_entry');
    expect(res.json.filePath).toBe('companies/acme/evidence/evidence-ledger.md');
  });

  it('rejects PUT with mismatched IDs and unknown IDs', async () => {
    expect((await call('PUT', '/api/evidence/ev-100', { entry: entry({ id: 'ev-555' }) })).status).toBe(400);
    expect((await call('PUT', '/api/evidence/ev-404', { entry: entry({ id: 'ev-404' }) })).status).toBe(404);
  });
});
