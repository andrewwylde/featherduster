import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { DraftRecord, RevisionToken } from '@featherduster/core';
import { DraftRepository } from '../src/tailoring/drafts/repository.js';

let dir: string;
let repo: DraftRepository;
let date: Date;
const initial = (): DraftRecord => ({ schemaVersion: 1, id: randomUUID(), kind: 'setup', lifecycle: 'draft', revision: 99, createdAt: '2000-01-01T00:00:00.000Z', editedAt: '2000-01-01T00:00:00.000Z', savedAt: '2000-01-01T00:00:00.000Z', context: {}, appliedContent: {}, base: null, payload: { posting: '', label: '', runner: '', baseResumeId: '' } });
const filename = (id: string) => path.join(dir, 'tailoring-drafts', `${id}.json`);
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-store-')); date = new Date('2026-01-01T00:00:00Z'); repo = new DraftRepository(dir, { now: () => date }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('DraftRepository', () => {
  it.each([null, undefined, {}, { revision: -1, fingerprint: 'x' }, { revision: 1, fingerprint: '' }, { revision: 1, fingerprint: 'x', unexpected: true }])('rejects malformed revision token %j at mutation boundaries', (invalid) => {
    const a = repo.create(initial(), 'create'); const bytes = fs.readFileSync(filename(a.record.id));
    const expected = invalid as RevisionToken;
    const operations = [
      () => repo.discard(a.record.id, expected, 'discard'),
      () => repo.trustedTransition(a.record.id, { expected, mutationId: 'transition', input: {} }, () => { throw new Error('Callback must not run'); }),
      () => repo.update(a.record.id, { expected, mutationId: 'update', change: 'context', context: {} }),
    ];
    for (const operation of operations) {
      try { operation(); throw new Error('Expected invalid token rejection'); }
      catch (error) { expect(error).toMatchObject({ status: 400 }); }
    }
    expect(fs.readFileSync(filename(a.record.id))).toEqual(bytes);
    expect(fs.existsSync(filename(a.record.id) + '.lock')).toBe(false);
  });
  it('returns typed replacement errors', () => {
    const a = repo.create(initial(), 'create');
    const broken = new DraftRepository(dir, { replace: () => { throw new Error('injected'); } });
    try { broken.discard(a.record.id, a.token, 'discard'); throw new Error('should fail'); }
    catch (error) { expect(error).toMatchObject({ status: 500, code: 'storage_error', detail: 'injected' }); }
  });
  it('rechecks external edits immediately before replacing the record', () => {
    const a = repo.create(initial(), 'create');
    const racing = new DraftRepository(dir, { now: () => {
      const disk = JSON.parse(fs.readFileSync(filename(a.record.id), 'utf8')); disk.record.payload.label = 'external'; fs.writeFileSync(filename(a.record.id), JSON.stringify(disk)); return date;
    } });
    expect(() => racing.discard(a.record.id, a.token, 'discard')).toThrow(/conflict/i);
    expect(repo.read(a.record.id).record.payload).toMatchObject({ label: 'external' });
  });
  it('rejects completed creation and malformed persisted receipts', () => {
    expect(() => repo.create({ ...initial(), lifecycle: 'completed' }, 'create')).toThrow(/draft record/i);
    const a = repo.create(initial(), 'create'); const disk = JSON.parse(fs.readFileSync(filename(a.record.id), 'utf8')); disk.receipts[0].acknowledgement.token.fingerprint = 'fake'; fs.writeFileSync(filename(a.record.id), JSON.stringify(disk));
    expect(() => repo.read(a.record.id)).toThrow(/receipt/i);
  });
  it('bounds receipt snapshots and safely conflicts on an expired retry', () => {
    const record = initial(); let a = repo.create(record, 'create');
    const expired = { expected: a.token, mutationId: 'old', change: 'context' as const, context: {} };
    a = repo.update(record.id, expired);
    for (let i = 0; i < 35; i++) a = repo.update(record.id, { expected: a.token, mutationId: `edit-${i}`, change: 'context', context: {} });
    expect(JSON.parse(fs.readFileSync(filename(record.id), 'utf8')).receipts).toHaveLength(32);
    expect(() => repo.update(record.id, expired)).toThrow(/conflict/i);
    expect(() => repo.create(record, 'create')).toThrow(/exists/i);
  });
  it('runs trusted transitions once and keeps identity and server metadata', () => {
    const a = repo.create(initial(), 'create'); let calls = 0;
    const options = { expected: a.token, mutationId: 'transition', input: { operation: 'finish' } };
    const change = (record: DraftRecord): DraftRecord => { calls++; return { ...record, id: randomUUID(), revision: 1000, lifecycle: 'completed' }; };
    const b = repo.trustedTransition(a.record.id, options, change);
    expect(b.record.id).toBe(a.record.id); expect(b.record.revision).toBe(2);
    expect(repo.trustedTransition(a.record.id, options, change)).toEqual(b); expect(calls).toBe(1);
    expect(() => repo.update(a.record.id, { expected: b.token, mutationId: 'edit', change: 'context', context: {} })).toThrow(/cannot be changed/i);
  });
  it('rejects malformed lock ownership without deleting it', () => {
    const a = repo.create(initial(), 'create'); const lock = filename(a.record.id) + '.lock';
    fs.writeFileSync(lock, '{');
    expect(() => repo.discard(a.record.id, a.token, 'discard')).toThrow(/locked/i);
    expect(fs.readFileSync(lock, 'utf8')).toBe('{');
  });
  it('rejects a payload for another kind and preserves immutable content metadata', () => {
    const a = repo.create(initial(), 'create');
    expect(() => repo.update(a.record.id, { expected: a.token, mutationId: 'bad', change: 'content', payload: { proposalTextById: {}, artifactTokens: {} } })).toThrow(/kind/i);
    expect(repo.read(a.record.id).record).toEqual(a.record);
  });
  it('creates server metadata and reads identical envelopes after restart', () => {
    const ack = repo.create(initial(), 'create');
    expect(ack.record.revision).toBe(1);
    expect(ack.record.createdAt).toBe(date.toISOString());
    expect(new DraftRepository(dir).read(ack.record.id)).toEqual({ record: ack.record, token: ack.token });
    expect(repo.list().records).toHaveLength(1);
  });
  it('distinguishes content and context edit timestamps', () => {
    const a = repo.create(initial(), 'create'); date = new Date('2026-01-02T00:00:00Z');
    const b = repo.update(a.record.id, { expected: a.token, mutationId: 'context', change: 'context', context: { activeStep: 'analysis' } });
    expect(b.record.editedAt).toBe(a.record.editedAt); expect(b.record.savedAt).toBe(date.toISOString());
    const c = repo.update(a.record.id, { expected: b.token, mutationId: 'content', change: 'content', payload: { ...a.record.payload, label: 'new' } });
    expect(c.record.editedAt).toBe(date.toISOString()); expect(c.record.revision).toBe(3);
  });
  it('rejects stale revisions and same-revision external edits', () => {
    const a = repo.create(initial(), 'create');
    repo.update(a.record.id, { expected: a.token, mutationId: 'one', change: 'context', context: {} });
    expect(() => repo.update(a.record.id, { expected: a.token, mutationId: 'two', change: 'context', context: {} })).toThrow(/conflict/i);
    const b = repo.read(a.record.id); const disk = JSON.parse(fs.readFileSync(filename(a.record.id), 'utf8')); disk.record.payload.label = 'external'; fs.writeFileSync(filename(a.record.id), JSON.stringify(disk));
    expect(() => repo.discard(a.record.id, b.token, 'discard')).toThrow(/conflict/i);
  });
  it('reports corrupt records without overwriting them or hiding healthy records', () => {
    repo.create(initial(), 'create'); const id = randomUUID(); fs.writeFileSync(filename(id), '{broken');
    expect(repo.list().records).toHaveLength(1); expect(repo.list().recoveryErrors[0].id).toBe(id);
    expect(() => repo.create({ ...initial(), id }, 'again')).toThrow(); expect(fs.readFileSync(filename(id), 'utf8')).toBe('{broken');
  });
  it('keeps discarded tombstones and cannot resurrect a delayed create or update', () => {
    const record = initial(); const a = repo.create(record, 'create'); const b = repo.discard(record.id, a.token, 'discard');
    expect(b.record.lifecycle).toBe('discarded'); expect(repo.list().records).toEqual([]);
    expect(() => repo.create(record, 'later')).toThrow();
    expect(() => repo.update(record.id, { expected: b.token, mutationId: 'later', change: 'context', context: {} })).toThrow();
    expect(repo.discard(record.id, a.token, 'discard')).toEqual(b);
  });
  it('persists exact mutation receipts and rejects conflicting reuse', () => {
    const record = initial(); const a = repo.create(record, 'create'); expect(new DraftRepository(dir).create(record, 'create')).toEqual(a);
    const update = { expected: a.token, mutationId: 'edit', change: 'context' as const, context: { activeStep: 'analysis' as const } };
    const b = repo.update(record.id, update); expect(new DraftRepository(dir).update(record.id, update)).toEqual(b);
    expect(() => repo.update(record.id, { ...update, context: {} })).toThrow(/mutation/i);
  });
  it('preserves old bytes and cleans temporary files and locks when replacement fails', () => {
    const a = repo.create(initial(), 'create'); const bytes = fs.readFileSync(filename(a.record.id));
    const broken = new DraftRepository(dir, { replace: () => { throw new Error('injected'); } });
    expect(() => broken.discard(a.record.id, a.token, 'discard')).toThrow('injected');
    expect(fs.readFileSync(filename(a.record.id))).toEqual(bytes); expect(fs.readdirSync(path.dirname(filename(a.record.id))).filter(name => name.endsWith('.json'))).toEqual([`${a.record.id}.json`]);
  });
  it('rejects live locks and recovers only verified dead owner locks', () => {
    const a = repo.create(initial(), 'create'); const lock = filename(a.record.id) + '.lock';
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: 'live' }));
    expect(() => repo.discard(a.record.id, a.token, 'discard')).toThrow(/locked/i);
    fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, nonce: 'dead' }));
    expect(repo.discard(a.record.id, a.token, 'discard').record.lifecycle).toBe('discarded'); expect(fs.existsSync(lock)).toBe(true);
  });
  it('rejects invalid ids and directory or record symlinks', () => {
    expect(() => repo.read('../escape')).toThrow();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-outside-'));
    try {
      const id = randomUUID(); fs.mkdirSync(path.join(dir, 'tailoring-drafts'), { recursive: true });
      fs.symlinkSync(external, filename(id), 'junction'); expect(() => repo.read(id)).toThrow(/symlink/i);
      fs.unlinkSync(filename(id)); fs.rmdirSync(path.join(dir, 'tailoring-drafts'));
      fs.symlinkSync(external, path.join(dir, 'tailoring-drafts'), 'junction'); expect(() => repo.list()).toThrow(/symlink/i);
    } finally { fs.rmSync(external, { recursive: true, force: true }); }
  });
});

 it('publishes complete lock ownership and keeps only a bounded generation fence', () => {
   let a = repo.create(initial(), 'create');
   for (let i=0;i<10;i++) a=repo.update(a.record.id,{expected:a.token,mutationId:`fence-${i}`,change:'context',context:{}});
   const locks=path.join(dir,'tailoring-drafts',`${a.record.id}.json.locks`);
   const generations=fs.readdirSync(locks).filter(name=>name.endsWith('.owner'));
   expect(generations).toHaveLength(1);
   expect(JSON.parse(fs.readFileSync(path.join(locks,generations[0]),'utf8'))).toMatchObject({pid:process.pid});
 });
 it('returns parsed receipt defaults after recovery', () => {
   const record=initial(); const a=repo.create(record,'create');
   const disk=JSON.parse(fs.readFileSync(filename(a.record.id),'utf8'));
   delete disk.receipts[0].acknowledgement.record.context;
   delete disk.receipts[0].acknowledgement.record.appliedContent;
   fs.writeFileSync(filename(a.record.id),JSON.stringify(disk));
   expect(repo.create(record,'create')).toEqual(a);
 });
