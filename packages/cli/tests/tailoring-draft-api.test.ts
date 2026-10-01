import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DraftRepository } from '../src/tailoring/drafts/repository.js';
import { WorkspaceWatcher } from '../src/watcher.js';
import { ApiClient } from '../../ui/src/api/client.js';
import { vi } from 'vitest';
import { createApp } from '../src/server.js';

describe('draft HTTP API', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-api-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = () => ({ id: randomUUID(), kind: 'setup', payload: { posting: '', label: '', baseResumeId: '', runner: '' }, context: {} });
  const body = (value: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  it('roundtrips incomplete setup, context and empty text; conflicts never overwrite', async () => {
    const app = createApp(root); const record = seed();
    const response = await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }));
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(created.record.base).toBeNull();
    const saved = await (await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: created.token, mutationId: 'save', change: 'content', payload: { ...record.payload, posting: 'text' } }, 'PUT'))).json();
    expect(saved.record.payload.posting).toBe('text');
    const stale = await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: created.token, mutationId: 'stale', change: 'content', payload: record.payload }, 'PUT'));
    expect(stale.status).toBe(409); expect((await stale.json()).code).toBe('revision_conflict');
    const context = await (await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: saved.token, mutationId: 'context', change: 'context', context: { mobilePane: 'work' } }, 'PUT'))).json();
    expect(context.record.payload.posting).toBe('text');
    expect(context.record.editedAt).toBe(saved.record.editedAt);
    const cleared = await (await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: context.token, mutationId: 'clear', change: 'content', payload: record.payload }, 'PUT'))).json();
    expect(cleared.record.payload.posting).toBe('');
    expect((await (await app.request('/api/tailoring-drafts')).json()).records).toHaveLength(1);
    expect((await (await app.request(`/api/tailoring-drafts/${record.id}`)).json()).token).toEqual(cleared.token);
    expect((await app.request(`/api/tailoring-drafts/${record.id}/discard`, body({ expected: cleared.token, operationId: randomUUID() }))).status).toBe(200);
    expect((await app.request(`/api/tailoring-drafts/${record.id}`)).status).toBe(410);
  });
  it('rejects malformed JSON, oversized bodies, invalid ids and forged metadata', async () => {
    const app = createApp(root);
    expect((await app.request('/api/tailoring-drafts', { method: 'POST', body: '{' })).status).toBe(400);
    expect((await app.request('/api/tailoring-drafts', { method: 'POST', body: ' '.repeat(2 * 1024 * 1024 + 1) })).status).toBe(413);
    expect((await app.request('/api/tailoring-drafts/nope')).status).toBe(400);
    expect((await app.request(`/api/tailoring-drafts/${randomUUID()}`)).status).toBe(404);
    for (const forged of [{ lifecycle: 'completed' }, { runSlug: 'x' }, { revision: 5 }, { appliedContent: {} }, { base: {} }, { savedAt: new Date().toISOString() }]) {
      expect((await app.request('/api/tailoring-drafts', body({ record: { ...seed(), ...forged }, mutationId: 'bad' }))).status).toBe(400);
    }
    expect((await app.request('/api/tailoring-drafts', { ...body({ record: seed(), mutationId: 'origin' }), headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });
  it('uses stable distinct workspace identity and isolates corrupt records and pending intents', async () => {
    const app = createApp(root);
    const health = await (await app.request('/api/health')).json();
    expect(health.workspaceId).toMatch(/^[a-f0-9]{64}$/);
    const other = createApp(path.join(root, 'other'));
    expect((await (await other.request('/api/health')).json()).workspaceId).not.toBe(health.workspaceId);
    const record = seed();
    await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }));
    fs.writeFileSync(path.join(root, 'tailoring-drafts', `${randomUUID()}.json`), '{');
    const intents = path.join(root, 'tailoring-drafts', 'operations', record.id);
    fs.mkdirSync(intents, { recursive: true }); fs.writeFileSync(path.join(intents, `${randomUUID()}.json`), '{');
    const restarted = createApp(root);
    const list = await (await restarted.request('/api/tailoring-drafts')).json();
    expect(list.workspaceId).toBe(health.workspaceId); expect(list.records).toHaveLength(1); expect(list.recoveryErrors).toHaveLength(2);
  });
  it('captures selected bases on setup selection and preserves snapshots on subsequent edits', async () => {
    const app = createApp(root); const record = seed();
    const created = await (await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }))).json();
    const payload = { ...record.payload, baseResumeId: 'template-starter' };
    const selected = await (await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: created.token, mutationId: 'select', change: 'content', payload }, 'PUT'))).json();
    expect(selected.record.base.resumeId).toBe('template-starter');
    const retried = await (await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: created.token, mutationId: 'select', change: 'content', payload }, 'PUT'))).json();
    expect(retried.token).toEqual(selected.token);
    const edited = await (await app.request(`/api/tailoring-drafts/${record.id}`, body({ expected: selected.token, mutationId: 'edit', change: 'content', payload: { ...payload, posting: 'different' } }, 'PUT'))).json();
    expect(edited.record.base).toEqual(selected.record.base);
  });
  it('typed client persists drafts through the API', async () => {
    const app = createApp(root);
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => app.request(url, init));
    try {
      const client = new ApiClient();
      const record = seed();
      const created = await client.createTailoringDraft({ record: { ...record, kind: 'setup' }, mutationId: 'client' });
      expect((await client.getTailoringDraft(record.id)).token).toEqual(created.token);
      expect((await client.listTailoringDrafts()).records).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('watches only top-level draft records, ignoring operation and generation files', async () => {
    const directory = path.join(root, 'tailoring-drafts'); fs.mkdirSync(directory);
    const watcher = new WorkspaceWatcher(root, { debounceMs: 10 });
    const events: string[] = []; watcher.subscribe((event) => events.push(event.relativePath));
    watcher.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const id = randomUUID();
      fs.mkdirSync(path.join(directory, 'operations', id), { recursive: true });
      fs.mkdirSync(path.join(directory, `${id}.json.lock.generations`), { recursive: true });
      fs.writeFileSync(path.join(directory, 'operations', id, `${randomUUID()}.json`), '{}');
      fs.writeFileSync(path.join(directory, `${id}.json.lock.generations`, 'owner.json'), '{}');
      fs.writeFileSync(path.join(directory, `${id}.json.tmp`), '{}');
      fs.writeFileSync(path.join(directory, `${id}.json`), '{}');
      await vi.waitFor(() => expect(events).toEqual([`tailoring-drafts/${id}.json`]), { timeout: 2000 });
    } finally { await watcher.close(); }
  });

  it('replays successful create after the source resume disappears and rejects reused mutation identity', async () => {
    const app = createApp(root); const record = seed(); record.payload.baseResumeId = 'template-starter';
    const created = await (await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }))).json();
    const templates = path.join(root, 'resumes', 'templates'); fs.mkdirSync(templates, { recursive: true });
    fs.writeFileSync(path.join(templates, 'replacement.json'), JSON.stringify(created.record.base.spec));
    const retried = await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }));
    expect(retried.status).toBe(200); expect(await retried.json()).toEqual(created);
    expect((await app.request('/api/tailoring-drafts', body({ record: { ...record, payload: { ...record.payload, label: 'changed' } }, mutationId: 'create' }))).status).toBe(409);
  });
  it('replays exact discard retries but returns gone for a new discard on a tombstone', async () => {
    const app = createApp(root); const record = seed();
    const created = await (await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }))).json();
    const command = { expected: created.token, operationId: randomUUID() };
    const discarded = await (await app.request(`/api/tailoring-drafts/${record.id}/discard`, body(command))).json();
    expect((await app.request(`/api/tailoring-drafts/${record.id}/discard`, body(command))).status).toBe(200);
    expect((await app.request(`/api/tailoring-drafts/${record.id}/discard`, body({ expected: discarded.token, operationId: randomUUID() }))).status).toBe(410);
  });

  it.each(['content', 'context'] as const)('replays an acknowledged %s save after discard without reviving the draft', async (change) => {
    const app = createApp(root); const record = seed();
    const created = await (await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }))).json();
    const update = { expected: created.token, mutationId: 'lost-response', change, ...(change === 'content' ? { payload: { ...record.payload, posting: 'saved' } } : { context: { mobilePane: 'work' } }) };
    const saved = await (await app.request(`/api/tailoring-drafts/${record.id}`, body(update, 'PUT'))).json();
    const discarded = await (await app.request(`/api/tailoring-drafts/${record.id}/discard`, body({ expected: saved.token, operationId: randomUUID() }))).json();
    const replay = await app.request(`/api/tailoring-drafts/${record.id}`, body(update, 'PUT'));
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual(saved);
    expect(new DraftRepository(root).read(record.id)).toEqual(discarded);
    expect((await app.request(`/api/tailoring-drafts/${record.id}`, body({ ...update, expected: discarded.token, mutationId: 'new-save' }, 'PUT'))).status).toBe(410);
  });
  it('replays the original setup save after a trusted setup-to-run transition', async () => {
    const app = createApp(root); const record = seed(); record.payload.baseResumeId = 'template-starter';
    const created = await (await app.request('/api/tailoring-drafts', body({ record, mutationId: 'create' }))).json();
    const update = { expected: created.token, mutationId: 'lost-response', change: 'content', payload: { ...record.payload, posting: 'saved' } };
    const saved = await (await app.request(`/api/tailoring-drafts/${record.id}`, body(update, 'PUT'))).json();
    const repository = new DraftRepository(root);
    repository.trustedTransition(record.id, { expected: saved.token, mutationId: 'create-run-fixture', input: { operation: 'create-run-fixture' } }, (current) => {
      if (!current.base) throw new Error('Fixture requires a base');
      return { ...current, kind: 'run', base: current.base, runSlug: 'fixture-run', payload: { proposalTextById: {}, artifactTokens: {} } };
    });
    const transitioned = repository.read(record.id);
    const replay = await app.request(`/api/tailoring-drafts/${record.id}`, body(update, 'PUT'));
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual(saved);
    expect(repository.read(record.id)).toEqual(transitioned);
    expect((await app.request(`/api/tailoring-drafts/${record.id}`, body({ ...update, expected: transitioned.token, mutationId: 'new-setup-save' }, 'PUT'))).status).toBe(400);
  });

});
