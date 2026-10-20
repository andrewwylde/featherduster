import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as C from '@featherduster/core';
import { ProposalRepository } from '../src/jobs/proposal-repository.js';
import { CorpusRepository } from '../src/corpus/repository.js';
import { DEFAULT_STARTER_RESUME, type Job } from '@featherduster/core';
import { openJobsDatabase, type JobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { JobArtifactsService } from '../src/jobs/artifacts.js';
import { JobDraftRepository } from '../src/tailoring/drafts/repository.js';
import { fingerprint } from '../src/jobs/files.js';
import { getLatexTemplate } from '../src/jobs/templates.js';

const time = '2026-01-01T00:00:00.000Z';
const roots: string[] = []; const handles: JobsDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const h of handles.splice(0)) if (h.db.open) h.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function open(root: string) { const db = openJobsDatabase(root); handles.push(db); return new JobsRepository(db, { now: () => time }); }
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'job-artifacts-')); roots.push(root);
  const repo = open(root); const service = new JobArtifactsService(repo, { now: () => time }); const drafts = new JobDraftRepository(repo);
  const job: Job = { schema_version: 1, id: randomUUID(), workspace_id: repo.database.workspaceId, revision: 0, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: time, updated_at: time };
  repo.createJob(job, randomUUID());
  const posting = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: job.workspace_id, job_id: job.id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Build things', content_fingerprint: fingerprint('Build things') });
  const capture = { job_id: job.id, posting_id: posting.id, base_resume: 'original resume', selected_evidence: [{ source_id: 'evidence/original.md', bytes: 'original evidence' }], privacy_rules: { exclude: ['address'] }, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'test' }, policy: { schema_version: 1 as const, mode: 'manual' as const, output_format: 'latex' as const, page_budget: 1, max_model_calls: 5, timeout_ms: 1000, max_repair_attempts: 1, model_retry_count: 0 } };
  const input = service.captureInputs(capture);
  const draft = drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: job.workspace_id, job_id: job.id, revision: 0, input_snapshot_id: input.id, parent_artifact_version_id: null, candidate: DEFAULT_STARTER_RESUME, proposals: { proposals: [] }, created_at: time, updated_at: time });
  const attempt = repo.claimJob({ job_id: job.id, input_snapshot_id: input.id, mode: 'manual', stop_generation: 0, lease_ms: 10000, idempotency_key: randomUUID() }).result!;
  const fence = { attempt_id: attempt.id, owner_token: attempt.owner_token, stop_generation: 0 };
  const publish = { draft_id: draft.id, expected_draft_revision: 0, fence, source: 'latex source', pdf: 'pdf bytes', previews: ['page one', 'page two'], validation_report: '{}', validation_result: 'passed' as const };
  const approval = (a: ReturnType<typeof service.publishCandidate>) => ({ job_id: job.id, expected_job_revision: repo.getJob(job.id).revision, artifact_version_id: a.id, artifact_fingerprint: a.version_fingerprint, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, reviewer_id: 'human', idempotency_key: randomUUID() });
  const proposals = new ProposalRepository(repo);
  const raw = JSON.stringify({ proposals: [{ id: '', type: 'summary.rewrite', target: {}, after: 'Engineer' }] });
  const id = randomUUID();
  const generation: C.ProposalGeneration = { schema_version: 1, id, workspace_id: job.workspace_id, job_id: job.id, attempt_id: attempt.id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, raw_output: { id: `${repo.database.files.bundlePath('artifacts', job.id, id)}/raw-output.json`, fingerprint: fingerprint(raw) }, proposals: { proposals: C.normalizeGenerationProposals(JSON.parse(raw).proposals) }, created_at: time };
  const reviewId = randomUUID();
  const review: C.ProposalReviewRevision = { schema_version: 1, id: reviewId, workspace_id: job.workspace_id, job_id: job.id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, generation_id: id, revision: 0, patches: [], groundings: [], feedback_ids: [], corpus_update_ids: [], candidate_preview: DEFAULT_STARTER_RESUME, validation: { authority: 'server', version: '1', fingerprint: 'validation', input_fingerprint: input.fingerprint, generation_id: id, review_revision: 0, status: 'ready', issues: [] }, created_at: time };
  const save = () => proposals.saveGeneration(generation, fence, raw);
  const stop = () => repo.transitionPreparation(job.id, 'block', repo.getJob(job.id).revision, randomUUID(), fence);
  return { root, repo, proposals, generation, raw, review, fence, input, job, save, stop };
}

const next = (r: C.ProposalReviewRevision) => ({ ...r, revision: r.revision + 1, validation: { ...r.validation, review_revision: r.revision + 1, fingerprint: `v${r.revision + 1}` } });
describe('durable proposal generations and revisions', () => {
  it('persists without a proposals checkpoint and reopens exact reviews', () => {
    const f = fixture(); f.save(); f.stop();
    expect(f.repo.listCheckpoints(f.generation.attempt_id)).toEqual([]);
    f.proposals.appendReview(f.review, null);
    const reopened = new ProposalRepository(open(f.root));
    expect(reopened.getGeneration(f.generation.id)).toEqual(f.generation);
    expect(reopened.getActive(f.job.id)).toEqual(f.review);
    expect(() => f.repo.database.db.exec('DELETE FROM proposal_review_revisions')).toThrow(/immutable/);
  });
  it('enforces CAS, active-generation isolation and immutable lineage', () => {
    const f = fixture(); f.save();
    expect(() => f.proposals.appendReview(f.review, null)).toThrow(/active/);
    f.proposals.appendReview(f.review, null, f.fence);
    const otherId = randomUUID();
    const other = { ...f.generation, id: otherId, raw_output: { ...f.generation.raw_output, id: `${f.repo.database.files.bundlePath('artifacts', f.job.id, otherId)}/raw-output.json` } };
    f.proposals.saveGeneration(other, f.fence, f.raw);
    expect(f.proposals.getActive(f.job.id)).toEqual(f.review);
    f.stop();
    const second = new ProposalRepository(open(f.root));
    f.proposals.appendReview(next(f.review), 0);
    expect(() => second.appendReview(next(f.review), 0)).toThrow(/Stale/);
    expect(() => second.appendReview({ ...next(next(f.review)), generation_id: otherId, validation: { ...next(next(f.review)).validation, generation_id: otherId } }, 1)).toThrow(/lineage/);
    expect(second.getRevision(f.review.id, 0)).toEqual(f.review);
    const fork = { ...f.review, id: randomUUID(), generation_id: otherId, validation: { ...f.review.validation, generation_id: otherId } };
    second.appendReview(fork, null, undefined, { id: f.review.id, revision: 1 });
    expect(second.getActive(f.job.id)).toEqual(fork);
    expect(() => f.proposals.appendReview(next(next(f.review)), 1)).toThrow(/active/);
  });
  it('requires ownership and correct raw and input bindings', () => {
    const f = fixture();
    expect(() => f.proposals.saveGeneration({ ...f.generation, workspace_id: randomUUID() }, f.fence, f.raw)).toThrow(/mismatch/);
    expect(() => f.proposals.saveGeneration(f.generation, f.fence, '{}')).toThrow(/binding/);
    expect(() => f.proposals.saveGeneration(f.generation, { ...f.fence, owner_token: 'lost' }, f.raw)).toThrow(/current/);
    f.save(); f.stop(); expect(() => f.save()).toThrow(/current/);
    expect(() => f.proposals.appendReview(f.review, null, f.fence)).toThrow(/current/);
  });
  it('reuses a complete orphan after metadata rollback and rejects changed or missing bytes', () => {
    const f = fixture();
    expect(() => f.repo.database.db.transaction(() => { f.save(); throw new Error('metadata failed'); })()).toThrow('metadata failed');
    expect(f.repo.database.db.prepare('SELECT * FROM proposal_generations').all()).toEqual([]);
    expect(f.save()).toEqual(f.generation);
    expect(f.save()).toEqual(f.generation);
    fs.writeFileSync(path.join(f.root, f.generation.raw_output.id), 'changed');
    expect(() => f.proposals.getGeneration(f.generation.id)).toThrow(/missing or changed/);
    fs.rmSync(path.join(f.root, f.generation.raw_output.id));
    expect(() => f.save()).toThrow(/missing or changed/);
  });
  it('does not publish metadata after a file write failure', () => {
    const f = fixture();
    const write = vi.spyOn(f.repo.database.files, 'writeBundle').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => f.save()).toThrow();
    expect(f.repo.database.db.prepare('SELECT * FROM proposal_generations').all()).toEqual([]);
    write.mockRestore(); expect(f.save()).toEqual(f.generation);
  });
  it('binds an exact ready revision once, never newer edits or another generation', () => {
    const f = fixture(); f.save(); f.proposals.appendReview(f.review, null, f.fence);
    expect(f.proposals.bindAttempt(f.fence.attempt_id, f.review.id, 0, 'validation', f.fence)).toEqual(f.review);
    expect(() => f.proposals.appendReview(next(f.review), 0, f.fence)).toThrow(/active/);
    expect(() => f.proposals.bindAttempt(f.fence.attempt_id, f.review.id, 0, 'wrong', f.fence)).toThrow(/exact ready/);
    f.stop(); f.proposals.appendReview(next(f.review), 0);
    expect(f.proposals.getAttemptReview(f.fence.attempt_id)).toEqual(f.review);
    expect(() => f.proposals.bindAttempt(f.fence.attempt_id, f.review.id, 1, 'v1', f.fence)).toThrow(/current/);
  });
  it('rolls back review, feedback, corpus head, links and receipt on the shared connection', () => {
    const f = fixture(); f.save(); f.stop();
    const corpus = new CorpusRepository(f.repo);
    const feedback: C.FeedbackEvent = { schema_version: 1, id: randomUUID(), workspace_id: f.job.workspace_id, job_id: f.job.id, proposal_id: null, review_revision: 0, kind: 'grounding', before: '', after: '', explanation: 'test', scope: { kind: 'workspace' }, recorded_by: 'human', recorded_at: time };
    expect(() => f.repo.withReceipt('review', 'save', {}, () => {
      const update = corpus.apply(feedback, { kind: 'skill_support', value: { skill: 'backend', facet: 'API', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'workspace' }, sources: [{ evidence_id: 'ev-001', evidence_fingerprint: 'a'.repeat(64), quote: 'API' }], explanation: 'API' } }, 0);
      f.proposals.appendReview({ ...f.review, feedback_ids: [feedback.id], corpus_update_ids: [update.id] }, null);
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(f.proposals.getActive(f.job.id)).toBeNull(); expect(corpus.snapshot().revision).toBe(0);
    expect(f.repo.database.db.prepare('SELECT * FROM corpus_feedback').all()).toEqual([]);
    expect(f.repo.database.db.prepare("SELECT * FROM mutation_receipts WHERE operation='review'").all()).toEqual([]);
  });
});

it('migration 3 preserves populated v2 imports, corpus, receipts and Stop byte-for-byte', async () => {
  const f = fixture(); f.stop();
  const { commitPrototypeImport, previewPrototypeImport } = await import('../src/jobs/importer.js');
  const source_path = path.join(f.root, 'legacy.json');
  fs.writeFileSync(source_path, JSON.stringify([{ id: 'submitted', url: 'https://example.com/job?utm_source=old', company: 'Acme', role: 'Engineer', status: 'applied', notes: 'original notes', resume_path: '../never-read.pdf', events: [{ detail: 'sent' }] }, { id: 'unknown', company: 'Other', role: 'Engineer', status: 'unclear' }]));
  commitPrototypeImport(f.repo, previewPrototypeImport(f.repo, { source_path, format: 'json', source_namespace: 'legacy' }));
  f.repo.stopProcessing('stop');
  new CorpusRepository(f.repo).saveFeedback({ schema_version: 1, id: randomUUID(), workspace_id: f.job.workspace_id, job_id: null, proposal_id: null, review_revision: null, kind: 'wording', before: 'before', after: 'after', explanation: '', scope: { kind: 'workspace' }, recorded_by: 'human', recorded_at: time });
  const baseline = ['jobs', 'url_aliases', 'events', 'mutation_receipts', 'worker_control', 'corpus_heads', 'corpus_feedback', 'corpus_updates', 'corpus_feedback_updates', 'input_snapshots', 'attempts'].map(table => [table, f.repo.database.db.prepare(`SELECT * FROM ${table}`).all()] as const);
  f.repo.database.db.exec('DROP TABLE semantic_leases; DROP TABLE semantic_call_results; DROP TABLE semantic_calls; DROP TABLE semantic_operations; DROP TABLE semantic_receipts; DROP TABLE semantic_clarifications; DROP TABLE semantic_records; DROP TABLE semantic_heads; DROP TABLE semantic_evaluations; DELETE FROM schema_migrations WHERE version=5; DROP TABLE material_heads; DROP TABLE material_revisions; DELETE FROM schema_migrations WHERE version=4; DROP TABLE attempt_proposal_reviews; DROP TABLE job_proposal_reviews; DROP TABLE proposal_review_revisions; DROP TABLE proposal_generations; DELETE FROM schema_migrations WHERE version=3');
  f.repo.database.close();
  const reopened = open(f.root);
  for (const [table, rows] of baseline) expect(reopened.database.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
  expect(new ProposalRepository(reopened).getActive(f.job.id)).toBeNull();
  expect(reopened.listJobs().every(j => j.preparation_state !== 'queued')).toBe(true);
  expect(reopened.getControl().stopped_at).not.toBeNull();
});
