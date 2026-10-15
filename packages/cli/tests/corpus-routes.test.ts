import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp, loadEvidenceStore, loadSourceEvidenceStore } from '../src/server.js';
import { sourceFingerprint } from '../src/corpus/load.js';
import { WorkspaceWatcher } from '../src/watcher.js';

let ws: string;
let app: ReturnType<typeof createApp>;
let ledger: string;
const bytes = `entries:\n  - id: api\n    date: '2026-01-01'\n    company: Acme\n    title: APIs\n    summary: Built APIs and BFF authentication.\n    impact: Reliability\n    themes: [platform]\n    confidence: verified\n    in_flight: false\n    metrics: []\n    internal_references: []\n`;
async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { 'content-type': 'application/json', host: '127.0.0.1:4173' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}
async function request() {
  const view = await call('GET', '/api/corpus');
  const record = loadSourceEvidenceStore(ws).get('api')!;
  return { workspace_id: view.body.workspace_id, expected_revision: view.body.snapshot.revision, idempotency_key: 'learn', explanation: 'API work is backend application development', supersedes: null,
    change: { kind: 'skill_support', value: { skill: 'backend', facet: 'application development', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'workspace' }, sources: [{ evidence_id: 'api', quote: 'Built APIs', evidence_fingerprint: sourceFingerprint(record) }], explanation: 'BFF and API implementation' } } };
}
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-api-'));
  fs.mkdirSync(path.join(ws, 'evidence'));
  ledger = path.join(ws, 'evidence', 'evidence-ledger.yaml'); fs.writeFileSync(ledger, bytes);
  app = createApp(ws, { watcher: new WorkspaceWatcher(ws), runnerFactory: () => { throw new Error('No models permitted'); }, jobsDependencies: { automaticDrain: false } });
});
afterEach(async () => { await app.disposeJobs(); fs.rmSync(ws, { recursive: true, force: true }); });
describe('corpus API', () => {
  it('previews and remembers source-bound support, searches without fabricated evidence, withdraws and retains history', async () => {
    const body = await request();
    expect((await call('GET', '/api/evidence?search=backend')).body).toEqual([]);
    const preview = await call('POST', '/api/corpus/preview', body);
    expect(preview.status).toBe(200); expect(preview.body.conflicts).toEqual([]);
    expect((await call('GET', '/api/corpus')).body.snapshot.revision).toBe(0);
    const saved = await call('POST', '/api/corpus/updates', body);
    expect(saved.status).toBe(200);
    expect(saved.body.result.change).toEqual(preview.body.update.change);
    expect((await call('GET', '/api/evidence?search=backend')).body.map((r: any) => r.id)).toEqual(['api']);
    expect((await call('POST', '/api/corpus/updates', body)).body.replayed).toBe(true);
    expect((await call('POST', '/api/corpus/updates', { ...body, expected_revision: 1, idempotency_key: 'duplicate' })).body.result.id).toBe(saved.body.result.id);
    const id = saved.body.result.id;
    expect((await call('POST', `/api/corpus/updates/${id}/withdraw`, { ...body, expected_revision: 1, idempotency_key: 'withdraw', change: { kind: 'withdrawal', update_id: id, reason: 'Undo' } })).status).toBe(200);
    expect((await call('GET', '/api/evidence?search=backend')).body).toEqual([]);
    expect((await call('GET', '/api/corpus')).body.snapshot.updates).toHaveLength(2);
    expect(fs.readFileSync(ledger, 'utf8')).toBe(bytes);
  });
  it('amends consolidated ledger only through companion state, enforces provisional facts and metric status', async () => {
    const body = await request(); const original = loadSourceEvidenceStore(ws).get('api')!;
    const amendment = { ...body, change: { kind: 'evidence_amendment', value: { evidence_id: 'api', base_fingerprint: sourceFingerprint(original), entry: { ...original.entry, summary: 'Built API gateway', confidence: 'provisional', metrics: [{ name: 'latency', value: '20%', status: 'unverified' }] }, narrative: 'Correction', confirmation_basis: 'user_confirmed', explanation: 'Specific detail' } } };
    expect((await call('POST', '/api/corpus/updates', amendment)).status).toBe(200);
    expect(loadEvidenceStore(ws).get('api')).toMatchObject({ summary: 'Built API gateway', confidence: 'provisional' });
    expect(fs.readFileSync(ledger, 'utf8')).toBe(bytes);
    const invalid = structuredClone(amendment); invalid.expected_revision = 1; invalid.idempotency_key = 'upgrade'; invalid.change.value.entry.metrics[0].status = 'verified';
    expect((await call('POST', '/api/corpus/updates', invalid)).status).toBe(400);
    const view = (await call('GET', '/api/corpus')).body;
    expect(view.records[0].storage_kind).toBe('ledger');
    expect(view.records[0].source.summary).toBe(original.summary);
  });
  it('rejects forged provenance, stale versions, foreign workspace, invalid quotes and retracted sources', async () => {
    const body = await request();
    for (const patch of [{ recorded_by: 'model' }, { ready: true }, { expected_revision: 99 }, { workspace_id: '11111111-1111-4111-8111-111111111111' }]) {
      expect((await call('POST', '/api/corpus/updates', { ...body, ...patch })).status).toBeGreaterThanOrEqual(400);
    }
    const forged = structuredClone(body); (forged.change.value.sources[0] as any).source_status = { confidence: 'verified', in_flight: false };
    expect((await call('POST', '/api/corpus/updates', forged)).status).toBe(400);
    const invalid = structuredClone(body); invalid.change.value.sources[0].quote = 'Kafka';
    expect((await call('POST', '/api/corpus/updates', invalid)).status).toBe(400);
    fs.writeFileSync(ledger, bytes.replace('confidence: verified', 'confidence: retracted'));
    expect((await call('POST', '/api/corpus/updates', body)).status).toBe(400);
    expect((await call('GET', '/api/corpus')).body.snapshot.revision).toBe(0);
  });
  it('removes future applicability on changed passages and limits restricted scopes', async () => {
    const body = await request(); (body.change.value.scope as any) = { kind: 'role', key: 'Backend Engineer' };
    expect((await call('POST', '/api/corpus/updates', body)).status).toBe(200);
    expect((await call('GET', '/api/evidence?search=backend')).body).toEqual([]);
    expect((await call('GET', '/api/corpus?role=Backend%20Engineer')).body.support).toHaveLength(1);
    fs.writeFileSync(ledger, bytes.replace('Built APIs and BFF authentication.', 'Built user interfaces.'));
    const view = (await call('GET', '/api/corpus?role=Backend%20Engineer')).body;
    expect(view.support).toEqual([]); expect(view.issues[0].code).toBe('quote_missing');
  });
});
