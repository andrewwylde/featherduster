import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { DEFAULT_STARTER_RESUME } from '@featherduster/core';
import type { JobDraft, Job, InputSnapshot, PostingSnapshot, Checkpoint, ArtifactVersion, ScopedAnswer } from '@featherduster/core';
import { openJobsDatabase, runMigrations, type JobsDatabase } from '../src/jobs/database.js';
import { JobFiles, fingerprint } from '../src/jobs/files.js';
import { JobsRepository } from '../src/jobs/repository.js';

const directories: string[] = [];
const handles: JobsDatabase[] = [];
const time = '2026-01-01T00:00:00.000Z';
function directory() { const dir = mkdtempSync(path.join(tmpdir(), 'jobs-test-')); directories.push(dir); return dir; }
function open(dir = directory(), now = () => time) { const handle = openJobsDatabase(dir); handles.push(handle); return { handle, repo: new JobsRepository(handle, { now }), dir }; }
afterEach(() => { for (const h of handles.splice(0)) if (h.db.open) h.close(); for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });
function job(workspace_id: string, overrides: Partial<Job> = {}): Job {
  return { schema_version: 1, id: randomUUID(), workspace_id, revision: 0, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: time, updated_at: time, ...overrides };
}
function seed(repo: JobsRepository, overrides: Partial<Job> = {}) {
  const j = repo.createJob(job(repo.database.workspaceId, overrides), randomUUID()).result;
  const posting: PostingSnapshot = { schema_version: 1, id: randomUUID(), workspace_id: j.workspace_id, job_id: j.id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Job posting', content_fingerprint: 'posting' };
  repo.savePostingSnapshot(posting);
  const ref = { id: 'reference', fingerprint: 'fingerprint' };
  const input: InputSnapshot = { schema_version: 1, id: randomUUID(), workspace_id: j.workspace_id, job_id: j.id, created_at: time, fingerprint: 'input', posting: { id: posting.id, fingerprint: posting.content_fingerprint }, base_resume: ref, selected_evidence: [], privacy_rules: ref, template: ref, runner_configuration: ref, policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 5, timeout_ms: 1000, max_repair_attempts: 1, model_retry_count: 0 }, policy_fingerprint: 'policy' };
  repo.saveInputSnapshot(input); return { j, posting, input };
}
function claim(repo: JobsRepository, data: ReturnType<typeof seed>, mode: 'manual' | 'automatic' = 'manual', key = randomUUID()) {
  return repo.claimJob({ job_id: data.j.id, input_snapshot_id: data.input.id, mode, stop_generation: repo.getControl().stop_generation, lease_ms: 1000, idempotency_key: key });
}
function checkpoint(repo: JobsRepository, attempt: NonNullable<ReturnType<typeof claim>['result']>): Checkpoint {
  return { schema_version: 1, id: randomUUID(), workspace_id: repo.database.workspaceId, job_id: attempt.job_id, attempt_id: attempt.id, completed_stage: 'preflight', input_fingerprint: 'input', output_fingerprint: 'output', output_references: [], completed_at: time };
}
function fence(a: NonNullable<ReturnType<typeof claim>['result']>) { return { attempt_id: a.id, owner_token: a.owner_token, stop_generation: a.stop_generation }; }
function artifact(repo: JobsRepository, a: NonNullable<ReturnType<typeof claim>['result']>): ArtifactVersion {
  const id = randomUUID(); const write = (name: string) => repo.database.files.writeArtifact(a.job_id, id, name, name);
  return { schema_version: 1, id, workspace_id: repo.database.workspaceId, job_id: a.job_id, attempt_id: a.id, input_snapshot_id: a.input_snapshot_id, input_fingerprint: 'input', version_fingerprint: 'version', parent_version_id: null, created_at: time, source: write('source.tex'), pdf: write('resume.pdf'), preview: write('preview.png'), validation_report: write('validation.json'), validation_result: 'passed' };
}

describe('private job files', () => {
  it('writes immutable nested files with checked fingerprints and private modes', () => {
    const root = directory(); const files = new JobFiles(root); const j = randomUUID(); const v = randomUUID();
    const ref = files.writeArtifact(j, v, 'resume.pdf', 'pdf');
    expect(ref.fingerprint).toBe(fingerprint('pdf')); expect(files.readArtifact(ref).toString()).toBe('pdf');
    expect(() => files.writeArtifact(j, v, 'resume.pdf', 'replacement')).toThrow();
    expect(() => files.readArtifact({ ...ref, fingerprint: 'wrong' })).toThrow();
    expect(readFileSync(path.join(root, '.featherduster/jobs/.gitignore'), 'utf8')).toBe('*\n');
    if (process.platform !== 'win32') { expect(statSync(path.join(root, ref.id)).mode & 0o777).toBe(0o600); expect(statSync(path.dirname(path.join(root, ref.id))).mode & 0o777).toBe(0o700); }
  });
  it.each(['../outside', '/absolute', 'C:\\outside', '..\\outside', '\\server\\share', 'bad\0name', 'a/b'])('rejects unsafe artifact names %s', name => {
    const files = new JobFiles(directory()); expect(() => files.writeArtifact(randomUUID(), randomUUID(), name, 'bad')).toThrow();
  });
  it('rejects external, dangling and database links without changing external files', () => {
    const outside = directory(); writeFileSync(path.join(outside, 'sentinel'), 'safe');
    for (const target of ['.featherduster', '.featherduster/jobs', '.featherduster/jobs/artifacts']) {
      const root = directory(); mkdirSync(path.dirname(path.join(root, target)), { recursive: true }); symlinkSync(outside, path.join(root, target), 'junction');
      expect(() => { const f = new JobFiles(root); f.writeArtifact(randomUUID(), randomUUID(), 'x', 'bad'); }).toThrow();
    }
    expect(readFileSync(path.join(outside, 'sentinel'), 'utf8')).toBe('safe');

  });
  it('rejects file symlinks, dangling links, database and WAL/SHM links (requires file-link permission)', context => {
    const outside = directory(); const sentinel = path.join(outside, 'sentinel'); writeFileSync(sentinel, 'safe');
    const probe = path.join(outside, 'probe');
    try { symlinkSync(sentinel, probe, 'file'); }
    catch (error) {
      // Windows without Developer Mode/elevation does not permit file symlinks.
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { context.skip(); return; }
      throw error;
    }
    for (const name of ['jobs.sqlite3', 'jobs.sqlite3-wal', 'jobs.sqlite3-shm']) {
      const root = directory(); new JobFiles(root); const target = path.join(root, '.featherduster/jobs', name);
      rmSync(target, { force: true }); symlinkSync(sentinel, target, 'file'); expect(() => openJobsDatabase(root)).toThrow();
    }
    const root = directory(); const files = new JobFiles(root); const ref = files.writeArtifact(randomUUID(), randomUUID(), 'a', 'safe');
    rmSync(path.join(root, ref.id)); symlinkSync(sentinel, path.join(root, ref.id), 'file'); expect(() => files.readArtifact(ref)).toThrow();
    const dangling = directory(); symlinkSync(path.join(outside, 'missing'), path.join(dangling, '.featherduster'), 'file'); expect(() => new JobFiles(dangling)).toThrow();
    expect(readFileSync(sentinel, 'utf8')).toBe('safe');
  });
  it('rejects a symlinked artifact version parent and leaves no metadata after a failed write', () => {
    const { repo, handle } = open(); const a = claim(repo, seed(repo)).result!; const outside = directory(); const version = randomUUID();
    const parent = path.join(handle.files.workspace, '.featherduster/jobs/artifacts', a.job_id); mkdirSync(parent, { recursive: true }); symlinkSync(outside, path.join(parent, version), 'junction');
    expect(() => handle.files.writeArtifact(a.job_id, version, 'resume.pdf', 'bad')).toThrow(); expect(existsSync(path.join(outside, 'resume.pdf'))).toBe(false); expect(handle.db.prepare('SELECT * FROM artifacts').all()).toEqual([]);
  });
  it('accepts canonical workspace aliases and rejects sibling-prefix escapes', () => {
    const root = directory(); const aliasParent = directory(); const alias = path.join(aliasParent, 'alias'); symlinkSync(root, alias, 'junction');
    const files = new JobFiles(alias); const j = randomUUID(); const v = randomUUID(); const ref = files.writeArtifact(j, v, 'a', 'safe');
    expect(files.readArtifact(ref).toString()).toBe('safe');
    expect(() => files.readArtifact({ id: `${root}-sibling/a`, fingerprint: 'x' })).toThrow();
  });
});

describe('durable SQLite repository', () => {
  it('initializes WAL/FKs/migrations and persists disabled identity across connections', () => {
    const { handle, repo, dir } = open(); const second = open(dir);
    expect(handle.files.databasePath).toBe(path.join(dir, '.featherduster/jobs/jobs.sqlite3'));
    expect(second.handle.workspaceId).toBe(handle.workspaceId); expect(second.repo.getControl().automatic_preparation_enabled).toBe(false);
    expect(handle.db.pragma('journal_mode', { simple: true })).toBe('wal'); expect(handle.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(6);
    for (const table of ['jobs', 'url_aliases', 'posting_snapshots', 'profiles', 'scoped_answers', 'input_snapshots', 'attempts', 'checkpoints', 'events', 'artifacts', 'draft_revisions', 'mutation_receipts']) expect(handle.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeTruthy();
    expect(() => handle.db.prepare('INSERT INTO posting_snapshots VALUES (?,?,?,?)').run(randomUUID(), randomUUID(), 'fingerprint', '{}')).toThrow();
    expect(repo.listJobs()).toEqual([]);
  });
  it('rolls back failed migrations and rejects future/gapped versions without deleting data', () => {
    const db = new Database(':memory:');
    try {
      expect(() => runMigrations(db, [{ version: 1, sql: 'CREATE TABLE sentinel (id); INSERT INTO nonexistent VALUES (1);' }])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='sentinel'").get()).toBeUndefined();
    } finally { db.close(); }
    const { handle, dir } = open(); handle.db.prepare('INSERT INTO schema_migrations VALUES (99,?)').run(time); handle.close();
    expect(() => openJobsDatabase(dir)).toThrow(/migration/);
    const raw = new Database(path.join(dir, '.featherduster/jobs/jobs.sqlite3')); expect(raw.prepare('SELECT * FROM workspace_metadata').all()).toHaveLength(1); raw.close();
  });
  it('round trips jobs/snapshots, deduplicates aliases and checks revisions across connections', () => {
    const { repo, dir, handle } = open(); const data = seed(repo, { original_url: 'https://example.com/original', canonical_url: 'https://example.com/job' });
    expect(repo.createJob(job(handle.workspaceId, { canonical_url: data.j.original_url }), 'duplicate').result.id).toBe(data.j.id);
    expect(repo.listEvents(data.j.id)).toEqual([]);
    const other = open(dir).repo; const next = repo.updateJob({ ...data.j, company: 'New' }, 0); expect(next.revision).toBe(1);
    expect(() => other.updateJob({ ...data.j, company: 'Stale' }, 0)).toThrow(/Stale/);
    expect(() => repo.updateJob({ ...next, preparation_state: 'resume_ready' }, 1)).toThrow();
    expect(other.getInputSnapshot(data.input.id)).toEqual(data.input); expect(other.getPostingSnapshot(data.posting.id)).toEqual(data.posting);
    expect(() => repo.createJob(job('other'), 'wrong')).toThrow();
    const second = seed(repo); expect(() => repo.saveInputSnapshot({ ...data.input, id: randomUUID(), job_id: second.j.id })).toThrow(/Cross-job/);
    handle.close(); expect(open(dir).repo.getJob(data.j.id).company).toBe('New');
  });
  it('validates stored JSON and versions without deleting the original row', () => {
    const { repo, handle } = open(); const data = seed(repo);
    for (const payload of ['{', JSON.stringify({ ...data.j, schema_version: 2 })]) { handle.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(payload, data.j.id); expect(() => repo.getJob(data.j.id)).toThrow(/unsupported/); expect(handle.db.prepare('SELECT payload FROM jobs WHERE id=?').get(data.j.id)).toEqual({ payload }); }
  });
  it('stores profiles and isolates candidate/employer/job answers without starting work', () => {
    const { repo, handle, dir } = open(); const { j } = seed(repo);
    const provenance = { source_type: 'user' as const, reference: 'user', quote: null, recorded_at: time };
    const base: ScopedAnswer = { schema_version: 1, id: randomUUID(), workspace_id: handle.workspaceId, key: 'salary', question: 'Salary?', scope: { kind: 'candidate' }, status: 'confirmed', value: 100, provenance, confirmed_at: time, updated_at: time };
    repo.saveAnswer(base); repo.saveAnswer({ ...base, id: randomUUID(), scope: { kind: 'employer', employer_id: 'Acme' }, value: 200 }); repo.saveAnswer({ ...base, id: randomUUID(), scope: { kind: 'job', job_id: j.id }, value: 300 });
    expect(repo.listAnswers({ kind: 'candidate' })[0]?.value).toBe(100); expect(repo.listAnswers({ kind: 'employer', employer_id: 'Other' })).toEqual([]);
    const p = repo.saveProfile({ schema_version: 1, id: randomUUID(), workspace_id: handle.workspaceId, revision: 0, facts: [base], preferences: [], created_at: time, updated_at: time }, null);
    expect(repo.saveProfile({ ...p, facts: [] }, 0).revision).toBe(1); expect(() => repo.saveProfile(p, 0)).toThrow();
    expect(open(dir).repo.getProfile(p.id).facts).toEqual([]); expect(repo.getControl().automatic_preparation_enabled).toBe(false);
  });
  it('receipts replay once, conflict on changed requests, and roll back unsuccessful mutations', () => {
    const { repo, handle } = open(); const j = job(handle.workspaceId);
    expect(repo.createJob(j, 'create').replayed).toBe(false); expect(repo.createJob(j, 'create').replayed).toBe(true); expect(repo.createJob({ ...j, id: randomUUID(), created_at: '2026-01-02T00:00:00.000Z' }, 'create').result.id).toBe(j.id);
    expect(() => repo.createJob({ ...j, role: 'Other' }, 'create')).toThrow(/different request/);
    const result = repo.transitionApplication(j.id, 'submitted', 0, 'submit'); expect(result.result.preparation_state).toBe('queued');
    expect(repo.transitionApplication(j.id, 'submitted', 0, 'submit').replayed).toBe(true); expect(repo.listEvents(j.id)).toHaveLength(1);
    expect(() => repo.transitionPreparation(j.id, 'complete', 1, 'bad')).toThrow(); expect(handle.db.prepare("SELECT * FROM mutation_receipts WHERE idempotency_key='bad'").get()).toBeUndefined(); expect(repo.getJob(j.id).revision).toBe(1);
  });
});

describe('workspace claims, fences and durable stop', () => {
  it('permits only one active attempt per workspace and gives replay no fresh permission', () => {
    const { repo, dir } = open(); const second = open(dir).repo; const a = seed(repo); const b = seed(repo);
    const first = claim(repo, a, 'manual', 'claim'); expect(first.result).not.toBeNull(); expect(claim(second, a).result).toBeNull(); expect(claim(second, b).result).toBeNull();
    expect(claim(second, a, 'manual', 'claim').replayed).toBe(true);
    const separate = open().repo; expect(claim(separate, seed(separate)).result).not.toBeNull();
    expect(repo.getControl().automatic_preparation_enabled).toBe(false);
  });
  it('fences wrong owner/generation, renews owner leases, and checkpoints once', () => {
    const { repo } = open(); const a = claim(repo, seed(repo)).result!; const f = fence(a); const cp = checkpoint(repo, a);
    expect(() => repo.renewLease({ ...f, owner_token: 'wrong' }, 1000)).toThrow(); expect(() => repo.saveCheckpoint(cp, { ...f, stop_generation: 1 })).toThrow();
    expect(repo.renewLease(f, 2000).lease_expires_at).toBe('2026-01-01T00:00:02.000Z');
    repo.saveCheckpoint(cp, f); expect(repo.saveCheckpoint({ ...cp, id: randomUUID() }, f)).toEqual(cp);
    expect(() => repo.saveCheckpoint({ ...cp, output_fingerprint: 'changed' }, f)).toThrow(); expect(repo.getAttempt(a.id).checkpoint_ids).toEqual([cp.id]);
  });
  it('stop persists and rejects late publication/checkpoint/completion even after restart', () => {
    const { repo, dir } = open(); const data = seed(repo); const a = claim(repo, data).result!; const f = fence(a); const art = artifact(repo, a); repo.saveCheckpoint(checkpoint(repo, a), f);
    const stopped = repo.stopProcessing('stop'); expect(stopped.result.cancelled_attempt_ids).toEqual([a.id]); expect(repo.stopProcessing('stop').replayed).toBe(true); expect(repo.getControl().stop_generation).toBe(1);
    const other = open(dir).repo; expect(other.getControl().automatic_preparation_enabled).toBe(false); seed(other);
    expect(() => other.publishArtifact(art, f)).toThrow(); expect(() => other.saveCheckpoint(checkpoint(repo, a), f)).toThrow();
    expect(() => other.transitionPreparation(data.j.id, 'complete', other.getJob(data.j.id).revision, 'complete', f)).toThrow();
    expect(other.listCheckpoints(a.id)).toHaveLength(1); expect(existsSync(path.join(dir, art.source.id))).toBe(true);
    other.startAutomaticPreparation('start'); expect(other.isAttemptCurrent(f)).toBe(false);
    const queued = seed(other); expect(() => other.claimJob({ job_id: queued.j.id, input_snapshot_id: queued.input.id, mode: 'manual', stop_generation: 0, lease_ms: 1000, idempotency_key: 'stale' })).toThrow();
    expect(other.getJob(data.j.id).preparation_state).toBe('cancelled');
  });
  it('recovers expiry once, retains completed checkpoints, requires explicit retry and new token', () => {
    let now = time; const { repo, dir } = open(undefined, () => now); const data = seed(repo); const a = claim(repo, data).result!; const f = fence(a); repo.saveCheckpoint(checkpoint(repo, a), f);
    expect(open(dir).repo.getAttempt(a.id).status).toBe('active'); now = '2026-01-01T00:00:02.000Z'; expect(repo.isAttemptCurrent(f)).toBe(false); expect(() => repo.renewLease(f, 1000)).toThrow();
    expect(repo.recoverExpiredAttempts()).toEqual([a.id]); expect(repo.recoverExpiredAttempts()).toEqual([]); expect(claim(repo, data).result).toBeNull(); expect(repo.listCheckpoints(a.id)).toHaveLength(1);
    repo.transitionPreparation(data.j.id, 'retry', repo.getJob(data.j.id).revision, 'retry'); const next = claim(repo, data).result!; expect(next.id).not.toBe(a.id); expect(next.owner_token).not.toBe(a.owner_token); expect(repo.getControl().automatic_preparation_enabled).toBe(false);
  });
  it('pause blocks next automatic claim but permits completion; application history is excluded', () => {
    const { repo } = open(); const data = seed(repo); expect(claim(repo, data, 'automatic').result).toBeNull(); repo.startAutomaticPreparation('start'); const a = claim(repo, data, 'automatic').result!; repo.pauseAfterCurrent('pause'); const art = artifact(repo, a); repo.publishArtifact(art, fence(a));
    expect(repo.getJob(data.j.id).preparation_state).toBe('preparing'); repo.transitionPreparation(data.j.id, 'complete', repo.getJob(data.j.id).revision, 'complete', fence(a)); expect(repo.getAttempt(a.id).status).toBe('completed');
    expect(claim(repo, seed(repo), 'automatic').result).toBeNull(); repo.startAutomaticPreparation('restart'); expect(claim(repo, seed(repo, { application_lifecycle: 'submitted' }), 'automatic').result).toBeNull();
  });
  it('waits for another process BEGIN IMMEDIATE and rechecks committed stop state', async () => {
    const { repo, handle } = open(); const data = seed(repo); const driver = createRequire(import.meta.url).resolve('better-sqlite3');
    const script = `const DB=require(process.argv[1]); const db=new DB(process.argv[2]); db.exec('BEGIN IMMEDIATE'); const row=db.prepare('SELECT payload FROM worker_control').get(); const c=JSON.parse(row.payload); c.stop_generation++; db.prepare('UPDATE worker_control SET payload=?').run(JSON.stringify(c)); console.log('locked'); setTimeout(()=>{db.exec('COMMIT');db.close()},250);`;
    const child = spawn(process.execPath, ['-e', script, driver, handle.files.databasePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`Child exited ${code}`)); }); });
    expect(() => repo.claimJob({ job_id: data.j.id, input_snapshot_id: data.input.id, mode: 'manual', stop_generation: 0, lease_ms: 1000, idempotency_key: 'race' })).toThrow(/generation/);
    expect(await exited).toBe(0); expect(repo.getJob(data.j.id).preparation_state).toBe('queued');
  }, 10000);
});

describe('artifact publication', () => {
  it('publishes verified immutable files, reopens, and reports corruption without deleting metadata', () => {
    const { repo, dir, handle } = open(); const a = claim(repo, seed(repo)).result!; const art = artifact(repo, a); repo.publishArtifact(art, fence(a)); expect(open(dir).repo.getArtifact(art.id)).toEqual(art);
    expect(repo.getJob(a.job_id).artifact_version_ids).toEqual([art.id]); expect(repo.getJob(a.job_id).preparation_state).toBe('preparing');
    writeFileSync(path.join(dir, art.pdf!.id), 'changed'); expect(() => repo.getArtifact(art.id)).toThrow(/recover/); expect(handle.db.prepare('SELECT id FROM artifacts WHERE id=?').get(art.id)).toBeTruthy();
    rmSync(path.join(dir, art.source.id)); expect(() => repo.getArtifact(art.id)).toThrow();
  });
  it('retains draft history and rejects stale draft publication without changing prior artifacts', () => {
    const { repo, handle, dir } = open(); const data = seed(repo); const a = claim(repo, data).result!;
    const draft: JobDraft = { schema_version: 1, id: randomUUID(), workspace_id: handle.workspaceId, job_id: a.job_id, revision: 0, input_snapshot_id: a.input_snapshot_id, parent_artifact_version_id: null, candidate: DEFAULT_STARTER_RESUME, proposals: { proposals: [] }, created_at: time, updated_at: time };
    repo.saveDraft(draft, null); const first = artifact(repo, a); repo.publishArtifact(first, fence(a), { id: draft.id, revision: 0 });
    const revised = repo.saveDraft(draft, 0); expect(revised.revision).toBe(1); expect(() => repo.saveDraft(draft, 0)).toThrow(/Stale/);
    expect(handle.db.prepare('SELECT * FROM draft_revisions WHERE id=?').all(draft.id)).toHaveLength(2);
    expect(open(dir).repo.getLatestDraft(draft.id)).toEqual(revised);
    const next = artifact(repo, a); expect(() => repo.publishArtifact(next, fence(a), { id: draft.id, revision: 0 })).toThrow(/Stale/);
    expect(repo.getJob(a.job_id).artifact_version_ids).toEqual([first.id]); expect(repo.getArtifact(first.id)).toEqual(first);
  });
  it('rejects missing files, wrong inputs, stale ownership and completion without validated artifacts', () => {
    const { repo, handle } = open(); const data = seed(repo); const a = claim(repo, data).result!; const f = fence(a); const art = artifact(repo, a);
    expect(() => repo.transitionPreparation(data.j.id, 'complete', 1, 'early', f)).toThrow(); expect(repo.getAttempt(a.id).status).toBe('active');
    expect(() => repo.publishArtifact({ ...art, input_fingerprint: 'wrong' }, f)).toThrow();
    rmSync(path.join(handle.files.workspace, art.source.id)); expect(() => repo.publishArtifact(art, f)).toThrow(); expect(repo.getJob(a.job_id).artifact_version_ids).toEqual([]); expect(handle.db.prepare('SELECT * FROM artifacts').all()).toEqual([]);
  });
});

it('reserves bounded usage atomically, persists diagnostics, and rejects manual claims after stop', () => {
  const { repo } = open(); const data = seed(repo); const a = claim(repo, data).result!;
  expect(repo.recordAttemptProgress(fence(a), { stage: 'analysis', model_calls: 1 }).resource_usage.model_calls).toBe(1);
  expect(repo.getJob(data.j.id).preparation_stage).toBe('analysis');
  expect(() => repo.recordAttemptProgress(fence(a), { model_calls: -1 })).toThrow();
  expect(() => repo.recordAttemptProgress(fence(a), { model_calls: 5 })).toThrow();
  repo.transitionPreparation(data.j.id, 'block', repo.getJob(data.j.id).revision, 'block', fence(a), { reason: 'Consent required', error: { code: 'consent', message: 'Consent required' }, elapsed_ms: 42 });
  expect(repo.getAttempt(a.id)).toMatchObject({ status: 'failed', error: { code: 'consent' }, resource_usage: { model_calls: 1, elapsed_ms: 42 } });
  expect(() => repo.recordAttemptProgress(fence(a), { model_calls: 1 })).toThrow();
  repo.stopProcessing('stop'); expect(claim(repo, seed(repo)).result).toBeNull();
});
