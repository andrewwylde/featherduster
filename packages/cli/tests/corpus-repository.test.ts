import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { previewPrototypeImport, commitPrototypeImport } from '../src/jobs/importer.js';
import type { CorpusChange, FeedbackEvent } from '@featherduster/core';
import { openJobsDatabase, type JobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { CorpusRepository } from '../src/corpus/repository.js';
import { loadCorpusSnapshot } from '../src/corpus/load.js';
const dirs: string[] = [];
const handles: JobsDatabase[] = [];
function open(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-repo-'))) {
  if (!dirs.includes(dir)) dirs.push(dir);
  const db = openJobsDatabase(dir); handles.push(db);
  return { dir, db, repo: new CorpusRepository(new JobsRepository(db)) };
}
const change: CorpusChange = { kind: 'skill_support', value: { skill: 'backend', facet: 'APIs', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'workspace' }, explanation: 'APIs implement backend', sources: [{ evidence_id: 'api', evidence_fingerprint: 'a'.repeat(64), quote: 'Built APIs' }] } };
function feedback(workspace: string): FeedbackEvent { return { schema_version: 1, id: randomUUID(), workspace_id: workspace, job_id: null, proposal_id: null, review_revision: null, kind: 'grounding', before: '', after: '', explanation: 'Explicit choice', scope: { kind: 'workspace' }, recorded_by: 'local-human', recorded_at: new Date().toISOString() }; }
afterEach(() => { for (const h of handles.splice(0)) if (h.db.open) h.close(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
describe('corpus persistence', () => {
  it('initializes, persists, reopens, deduplicates while retaining feedback, and withdraws immutably', () => {
    const { dir, repo, db } = open();
    expect(repo.snapshot().revision).toBe(0);
    const u = repo.apply(feedback(db.workspaceId), change, 0);
    expect(repo.apply(feedback(db.workspaceId), change, 1)).toEqual(u);
    expect(db.db.prepare('SELECT * FROM corpus_feedback').all()).toHaveLength(2);
    expect(db.db.prepare('SELECT * FROM corpus_feedback_updates').all()).toHaveLength(2);
    const reopened = open(dir).repo;
    expect(reopened.snapshot().updates).toEqual([u]);
    reopened.withdraw(feedback(db.workspaceId), u.id, 'Withdraw', 1);
    expect(repo.snapshot().revision).toBe(2);
    expect(repo.snapshot().updates[0]).toEqual(u);
    expect(() => db.db.prepare('DELETE FROM corpus_updates').run()).toThrow(/immutable/);
    expect(loadCorpusSnapshot(dir)).toEqual(repo.snapshot());
  });
  it('enforces two-connection CAS, receipt replay before stale checks and changed-payload conflicts', () => {
    const { dir, repo, db } = open(); const other = open(dir).repo;
    const request = { expected: 0, change };
    const save = () => repo.jobs.withReceipt('corpus', 'key', request, () => repo.apply(feedback(db.workspaceId), change, 0));
    const first = save();
    expect(() => other.apply(feedback(db.workspaceId), change, 0)).toThrow(/Stale/);
    other.withdraw(feedback(db.workspaceId), first.result.id, 'Undo', 1);
    expect(save()).toEqual({ result: first.result, replayed: true });
    expect(() => repo.jobs.withReceipt('corpus', 'key', { different: true }, () => null)).toThrow(/different request/);
  });
  it('rolls back feedback, head, updates and receipts together and requires explicit supersession', () => {
    const { repo, db } = open();
    expect(() => repo.jobs.withReceipt('corpus', 'rollback', {}, () => { repo.apply(feedback(db.workspaceId), change, 0); throw new Error('rollback'); })).toThrow('rollback');
    expect(repo.snapshot().revision).toBe(0);
    expect(db.db.prepare('SELECT * FROM corpus_feedback').all()).toHaveLength(0);
    const u = repo.apply(feedback(db.workspaceId), change, 0);
    const negative: CorpusChange = { kind: 'skill_support', value: { ...(change as Extract<CorpusChange, {kind: 'skill_support'}>).value, support: 'unsupported' } };
    expect(() => repo.apply(feedback(db.workspaceId), negative, 1)).toThrow(/supersession/);
    expect(db.db.prepare('SELECT * FROM corpus_feedback').all()).toHaveLength(1);
    expect(repo.apply(feedback(db.workspaceId), negative, 1, u.id).revision).toBe(2);
  });
  it('migrates populated v1 without modifying jobs, aliases, receipts, events or Stop', () => {
    const { dir, db, repo } = open();
    const source_path = path.join(dir, 'legacy.json');
    fs.writeFileSync(source_path, JSON.stringify([{ id: 'submitted', url: 'https://example.com/job?utm_source=old', company: 'Acme', role: 'Engineer', status: 'applied', notes: 'original notes', resume_path: '../never-read.pdf', events: [{ detail: 'sent' }] }, { id: 'unknown', company: 'Other', role: 'Engineer', status: 'unclear' }]));
    const request = { source_path, format: 'json' as const, source_namespace: 'legacy' };
    commitPrototypeImport(repo.jobs, previewPrototypeImport(repo.jobs, request));
    expect(repo.jobs.listJobs()).toHaveLength(2);
    expect(repo.jobs.listJobs().every(j => j.preparation_state !== 'queued')).toBe(true);
    repo.jobs.stopProcessing('stop');
    const control = repo.jobs.getControl();
    // Preserve all v1 tables byte-for-byte in the migration fixture.
    const baseline = ['jobs', 'url_aliases', 'events', 'mutation_receipts', 'worker_control'].map(table => [table, db.db.prepare(`SELECT * FROM ${table}`).all()] as const);
    db.db.exec('DROP TABLE semantic_evaluations; DROP TABLE semantic_receipts; DROP TABLE semantic_leases; DROP TABLE semantic_call_results; DROP TABLE semantic_calls; DROP TABLE semantic_operations; DROP TABLE semantic_clarifications; DROP TABLE semantic_records; DROP TABLE semantic_heads; DELETE FROM schema_migrations WHERE version=5');
    db.db.exec('DROP TABLE material_heads; DROP TABLE material_revisions; DELETE FROM schema_migrations WHERE version=4; DROP TABLE attempt_proposal_reviews; DROP TABLE job_proposal_reviews; DROP TABLE proposal_review_revisions; DROP TABLE proposal_generations; DELETE FROM schema_migrations WHERE version=3; DROP TABLE corpus_feedback_updates; DROP TABLE corpus_updates; DROP TABLE corpus_feedback; DROP TABLE corpus_heads; DELETE FROM schema_migrations WHERE version=2');
    db.close();
    expect(loadCorpusSnapshot(dir).updates).toEqual([]);
    const migrated = open(dir);
    for (const [table, rows] of baseline) expect(migrated.db.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
    expect(migrated.repo.jobs.getControl()).toEqual(control);
    expect(migrated.repo.snapshot().revision).toBe(0);
  });
  it('does not create storage on absent reads and rejects corrupt or future schemas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-absent-')); dirs.push(dir);
    expect(loadCorpusSnapshot(dir).revision).toBe(0);
    expect(fs.existsSync(path.join(dir, '.featherduster'))).toBe(false);
    const { db } = open(dir);
    db.db.prepare('INSERT INTO schema_migrations VALUES (99,?)').run('now');
    expect(() => loadCorpusSnapshot(dir)).toThrow(/schema/);
    db.db.prepare('DELETE FROM schema_migrations WHERE version=99').run();
    db.db.exec('DROP TABLE corpus_heads');
    expect(() => loadCorpusSnapshot(dir)).toThrow();
  });
});

it('reconciles committed corpus notifications across connections without worker admissions', async () => {
  const { dir, repo, db } = open();
  const { createJobsRuntime } = await import('../src/jobs/runtime.js');
  const { EvidenceStore } = await import('@featherduster/core');
  const runtime = createJobsRuntime(dir, { loadEvidence: () => new EvidenceStore(), loadResumes: () => [], loadPrivacyRules: () => ({ strip_patterns: [], replacements: [], banned_keywords: [] }), automaticDrain: false, runnerFactory: () => { throw new Error('must not instantiate runner'); } });
  try {
    const notifications: unknown[] = [];
    const unsubscribe = runtime.subscribeCorpus(e => notifications.push(e));
    const update = repo.apply(feedback(db.workspaceId), change, 0);
    runtime.flushEvents(); runtime.flushEvents();
    expect(notifications).toEqual([{ revision: 1, update_ids: [update.id] }]);
    expect(repo.jobs.listJobs()).toEqual([]);
    expect(db.db.prepare('SELECT * FROM events').all()).toEqual([]);
    unsubscribe();
  } finally { await runtime.dispose(); }
});
