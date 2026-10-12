import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { JobSchema } from '@featherduster/core';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { previewPrototypeImport, commitPrototypeImport } from '../src/jobs/importer.js';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanups.splice(0).forEach(fn => fn()); });
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'prototype-'));
  let db = openJobsDatabase(dir); let repo = new JobsRepository(db);
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const source_path = path.join(dir, 'source.json');
  const request = { source_path, format: 'json' as const, source_namespace: 'tracker' };
  return { dir, get repo() { return repo; }, request,
    write(value: unknown) { writeFileSync(source_path, JSON.stringify(value)); },
    reopen() { db.close(); db = openJobsDatabase(dir); repo = new JobsRepository(db); },
  };
}
function dump(repo: JobsRepository) {
  return repo.database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => {
    const name = (row as { name: string }).name;
    return [name, repo.database.db.prepare(`SELECT * FROM ${name}`).all()];
  });
}
const legacy = { id: 0, url: 'https://example.com/job?utm_source=old#apply', canonical_url: 'https://example.com/job', company: ' Acme ', role: ' Engineer ', status: 'applied', resume_path: '../never-read.pdf', tex_path: '/never-read.tex', notes: '  historical\nnotes ', events: [{ job_id: 0, timestamp: '2000-01-01', detail: 'sent' }] };

describe('prototype history import', () => {
  it.each(['json', 'sqlite'] as const)('previews %s without mutations and archives inert history', format => {
    const s = setup(); let source_path = s.request.source_path;
    if (format === 'json') s.write({ jobs: [legacy], events: legacy.events });
    else {
      source_path = path.join(s.dir, 'prototype.sqlite'); const db = new Database(source_path);
      db.exec('CREATE TABLE applications (id, url, canonical_url, company, role, status, resume_path, tex_path, notes, events); CREATE TABLE events (job_id, timestamp, detail)');
      db.prepare('INSERT INTO applications VALUES (?,?,?,?,?,?,?,?,?,?)').run(...Object.values({ ...legacy, events: JSON.stringify(legacy.events) }));
      db.prepare('INSERT INTO events VALUES (?,?,?)').run(0, '2000-01-01', 'sent'); db.close();
    }
    const request = { ...s.request, source_path, format }; const before = dump(s.repo); const bytes = readFileSync(source_path); const control = s.repo.getControl();
    const preview = previewPrototypeImport(s.repo, request);
    expect(preview.errors).toEqual([]); expect(preview.items[0]!.error).toBeNull(); expect(dump(s.repo)).toEqual(before); expect(readFileSync(source_path)).toEqual(bytes);
    const result = commitPrototypeImport(s.repo, preview)[0]!;
    expect(result.disposition).toBe('imported'); expect(JobSchema.safeParse(result.job).success).toBe(true);
    expect(result.job).toMatchObject({ company: 'Acme', role: 'Engineer', preparation_state: 'skipped', application_lifecycle: 'submitted', artifact_version_ids: [], confirmation_provenance: [], current_attempt_id: null, external_job_id: '["tracker","0"]' });
    const payload = s.repo.listEvents(result.job_id!)[0]!.payload;
    expect(payload).toMatchObject({ kind: 'import_history', notes: legacy.notes, resume_path: legacy.resume_path, tex_path: legacy.tex_path, original_status: 'applied' });
    if (payload.kind === 'import_history') expect(JSON.parse(payload.events_json)).toEqual(legacy.events);
    const committed = dump(s.repo);
    expect(commitPrototypeImport(s.repo, preview)[0]).toMatchObject({ replayed: true, job_id: result.job_id });
    expect(commitPrototypeImport(s.repo, previewPrototypeImport(s.repo, request))[0]!.job_id).toBe(result.job_id);
    expect(dump(s.repo)).toEqual(committed); expect(s.repo.getControl()).toEqual(control); expect(readFileSync(source_path)).toEqual(bytes);
  });

  it('replays moved, reordered, URL-less exports after reopening and isolates namespaces', () => {
    const s = setup(); s.repo.stopProcessing('stop'); const control = s.repo.getControl();
    s.write([{ id: 'a' }, { id: 'b' }]); const first = commitPrototypeImport(s.repo, previewPrototypeImport(s.repo, s.request));
    s.write([{ id: 'b' }, { id: 'a' }]); const moved = path.join(s.dir, 'moved.json'); copyFileSync(s.request.source_path, moved); s.reopen();
    const next = commitPrototypeImport(s.repo, previewPrototypeImport(s.repo, { ...s.request, source_path: moved }));
    expect(next.map(i => i.job_id)).toEqual(first.map(i => i.job_id).reverse()); expect(next.every(i => i.replayed)).toBe(true);
    commitPrototypeImport(s.repo, previewPrototypeImport(s.repo, { ...s.request, source_namespace: 'other' }));
    expect(s.repo.listJobs()).toHaveLength(4); expect(s.repo.getControl()).toEqual(control);
  });

  it('deduplicates same-batch canonical variants and racing previews without overwriting a live job', () => {
    const s = setup(); s.write([{ ...legacy, id: 'a' }]);
    const seed = previewPrototypeImport(s.repo, s.request).items[0]!.job!;
    const live = s.repo.createJob({ ...seed, preparation_state: 'queued', application_lifecycle: 'not_started', external_job_id: null }, 'live').result;
    s.write([{ ...legacy, id: 'a' }, { ...legacy, id: 'b', url: 'https://example.com/job#other' }]);
    const a = previewPrototypeImport(s.repo, s.request); const b = previewPrototypeImport(s.repo, s.request);
    expect(a.counts.duplicates).toBe(2);
    for (const p of [a, b]) expect(commitPrototypeImport(s.repo, p).map(i => i.job_id)).toEqual([live.id, live.id]);
    expect(s.repo.getJob(live.id)).toEqual(live); expect(s.repo.listJobs()).toHaveLength(1); expect(s.repo.listEvents(live.id)).toHaveLength(2);
    const t = setup(); t.write([{ ...legacy, id: 1 }, { ...legacy, id: 2 }]);
    const p = previewPrototypeImport(t.repo, t.request); expect(p.counts.duplicates).toBe(1);
    expect(new Set(commitPrototypeImport(t.repo, p).map(i => i.job_id)).size).toBe(1);
  });

  it('rolls back changed history and failed event writes, then retries exactly once', () => {
    const s = setup(); s.write([legacy]); const p = previewPrototypeImport(s.repo, s.request); const before = dump(s.repo);
    vi.spyOn(s.repo, 'appendEvent').mockImplementationOnce(() => { throw new Error('injected'); });
    expect(commitPrototypeImport(s.repo, p)[0]!.disposition).toBe('error'); expect(dump(s.repo)).toEqual(before);
    expect(commitPrototypeImport(s.repo, p)[0]!.disposition).toBe('imported'); const committed = dump(s.repo);
    for (const change of [{ notes: 'changed' }, { company: 'Different' }]) {
      s.write([{ ...legacy, ...change }]); expect(commitPrototypeImport(s.repo, previewPrototypeImport(s.repo, s.request))[0]!.disposition).toBe('error'); expect(dump(s.repo)).toEqual(committed);
    }
  });

  it('keeps malformed rows visible and preserves valid neighbors without trusting URLs', () => {
    const s = setup(); s.write({ jobs: [{ id: 'ok', url: 'bad', status: 'email_sent' }, {}, { id: 'events', events: {} }, { id: 'repeat', notes: 'a' }, { id: 'repeat', notes: 'b' }], events: [{ job_id: 'missing' }, {}] });
    const p = previewPrototypeImport(s.repo, s.request); expect(p.errors).toHaveLength(2); expect(p.items[0]!.warnings).toHaveLength(1);
    expect(commitPrototypeImport(s.repo, p).map(i => i.disposition)).toEqual(['imported', 'error', 'error', 'error', 'error']);
    expect(s.repo.listJobs()[0]).toMatchObject({ original_url: null, canonical_url: null, application_lifecycle: 'unknown' });
  });

  it('reports missing and malformed sources without creating or changing them', () => {
    const s = setup(); const absent = path.join(s.dir, 'absent.sqlite');
    expect(previewPrototypeImport(s.repo, { ...s.request, source_path: absent, format: 'sqlite' }).errors).toHaveLength(1); expect(existsSync(absent)).toBe(false);
    writeFileSync(s.request.source_path, '{'); expect(previewPrototypeImport(s.repo, s.request).errors).toHaveLength(1);
    for (const sql of ['CREATE TABLE unrelated(id)', 'CREATE TABLE jobs(id); CREATE TABLE applications(id)']) {
      const file = path.join(s.dir, `${Math.random()}.sqlite`); const db = new Database(file); db.exec(sql); db.close(); const before = readFileSync(file);
      expect(previewPrototypeImport(s.repo, { ...s.request, source_path: file, format: 'sqlite' }).errors).toHaveLength(1); expect(readFileSync(file)).toEqual(before); rmSync(file);
    }
  });

  it('rejects forged, edited and foreign previews and commits captured rather than reread data', () => {
    const s = setup(); s.write([legacy]); const p = previewPrototypeImport(s.repo, s.request);
    expect(() => commitPrototypeImport(s.repo, structuredClone(p))).toThrow(); expect(() => commitPrototypeImport(setup().repo, p)).toThrow();
    s.write([]); expect(commitPrototypeImport(s.repo, p)[0]!.disposition).toBe('imported');
    p.items[0]!.job!.preparation_state = 'queued'; expect(() => commitPrototypeImport(s.repo, p)).toThrow();
  });

  it('never enables work or queues imported jobs even with enabled controls', () => {
    const s = setup(); s.repo.startAutomaticPreparation('start'); const control = s.repo.getControl();
    s.write(['queued', 'preparing', 'resume_ready'].map((status, id) => ({ id, status })));
    commitPrototypeImport(s.repo, previewPrototypeImport(s.repo, s.request)); expect(s.repo.getControl()).toEqual(control);
    expect(s.repo.listJobs().every(j => j.preparation_state === 'skipped' && j.application_lifecycle === 'unknown')).toBe(true);
    for (const table of ['attempts', 'checkpoints', 'artifacts']) expect(s.repo.database.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  });
});
