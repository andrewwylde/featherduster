import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  return { root, repo, service, drafts, job, input, draft, capture, publish, approval };
}

describe('immutable job inputs and revisioned drafts', () => {
  it.each(['codex', 'claude-code'])('captures the %s CLI default without requiring a model override', runner => {
    const f = fixture();
    const input = f.service.captureInputs({ ...f.capture, runner_configuration: { runner, model: '' } });
    expect(f.service.getInputSnapshot(input.id)).toEqual(input);
    const saved = f.repo.database.files.readSnapshot(input.runner_configuration, f.job.id, input.id);
    expect(JSON.parse(saved.toString())).toEqual({ runner, model: '' });
  });
  it.each(['ollama', 'anthropic-api', 'test'])('rejects an empty model for %s in an immutable bundle', runner => {
    const f = fixture();
    expect(() => f.service.captureInputs({ ...f.capture, runner_configuration: { runner, model: '' } })).toThrow();
  });
  it('captures every input, persists across connections and isolates live changes', () => {
    const f = fixture(); f.capture.base_resume = 'edited live resume'; f.capture.selected_evidence[0]!.bytes = 'edited evidence';
    const reopened = new JobArtifactsService(open(f.root));
    expect(reopened.getInputSnapshot(f.input.id)).toEqual(f.input);
    expect(f.repo.database.files.readSnapshot(f.input.base_resume, f.job.id, f.input.id).toString()).toBe('original resume');
    expect(f.repo.database.files.readSnapshot(f.input.selected_evidence[0]!, f.job.id, f.input.id).toString()).toBe('original evidence');
    expect(f.service.captureInputs(f.capture).fingerprint).not.toBe(f.input.fingerprint);
    expect(() => f.service.captureInputs({ ...f.capture, runner_configuration: { ...f.capture.runner_configuration, api_key: 'secret' } as typeof f.capture.runner_configuration })).toThrow();
  });
  it('detects snapshot tampering, missing files and cross-job references', () => {
    const f = fixture(); const files = f.repo.database.files;
    expect(() => files.readSnapshot(f.input.base_resume, randomUUID(), f.input.id)).toThrow();
    fs.writeFileSync(path.join(f.root, f.input.base_resume.id), 'changed');
    expect(() => f.service.getInputSnapshot(f.input.id)).toThrow(expect.objectContaining({ code: 'corrupt_data' }));
    fs.rmSync(path.join(f.root, f.input.base_resume.id));
    expect(() => f.service.getInputSnapshot(f.input.id)).toThrow();
  });
  it('uses cross-connection revision CAS and immutable lineage', () => {
    const f = fixture(); const second = new JobDraftRepository(open(f.root));
    const next = f.drafts.save(f.draft, 0); expect(next.revision).toBe(1);
    expect(() => second.save(f.draft, 0)).toThrow(expect.objectContaining({ code: 'revision_conflict' }));
    expect(second.getRevision(f.draft.id, 0)).toEqual(f.draft); expect(second.getLatest(f.draft.id)).toEqual(next);
    const input = f.service.captureInputs(f.capture);
    expect(() => second.save({ ...next, input_snapshot_id: input.id }, 1)).toThrow(expect.objectContaining({ code: 'invalid_relationship' }));
    expect(second.getLatest(f.draft.id)).toEqual(next);
  });
  it('rejects unsafe bundles and symlink parents without touching external files', () => {
    const f = fixture(); const files = f.repo.database.files;
    expect(() => files.writeBundle('snapshots', f.job.id, randomUUID(), { '../outside': 'bad' })).toThrow();
    const other = fs.mkdtempSync(path.join(tmpdir(), 'outside-')); roots.push(other); fs.writeFileSync(path.join(other, 'sentinel'), 'safe');
    const jobId = randomUUID(); fs.symlinkSync(other, path.join(f.root, 'tailoring/jobs', jobId), 'junction');
    expect(() => files.writeBundle('snapshots', jobId, randomUUID(), { 'sentinel': 'bad' })).toThrow();
    expect(fs.readFileSync(path.join(other, 'sentinel'), 'utf8')).toBe('safe');
  });
});

describe('artifact publication and immutable human review', () => {
  it('publishes complete bundles without approving or changing application state', () => {
    const f = fixture(); const a = f.service.publishCandidate(f.publish);
    expect(new JobArtifactsService(open(f.root)).getArtifact(a.id)).toEqual(a);
    expect(f.repo.listEvents(f.job.id).some(e => e.payload.kind === 'resume_review')).toBe(false);
    expect(f.repo.getJob(f.job.id).application_lifecycle).toBe('not_started');
    expect(() => f.repo.database.files.writeBundle('artifacts', f.job.id, a.id, { 'source.tex': 'overwrite' })).toThrow();
    expect(f.service.getArtifact(a.id)).toEqual(a);
    const extra = path.join(f.root, f.repo.database.files.bundlePath('artifacts', f.job.id, a.id), 'preview-1.png');
    fs.writeFileSync(extra, 'tampered'); expect(() => f.service.getArtifact(a.id)).toThrow(expect.objectContaining({ code: 'corrupt_data' }));
  });
  it('checks draft and ownership before filesystem publication', () => {
    const f = fixture(); const spy = vi.spyOn(f.repo.database.files, 'writeBundle');
    expect(() => f.service.publishCandidate({ ...f.publish, expected_draft_revision: 1 })).toThrow(expect.objectContaining({ code: 'revision_conflict' }));
    expect(() => f.service.publishCandidate({ ...f.publish, fence: { ...f.publish.fence, owner_token: 'wrong' } })).toThrow();
    f.repo.stopProcessing('stop'); expect(() => f.service.publishCandidate(f.publish)).toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(['writeFileSync', 'fsyncSync', 'renameSync'] as const)('rolls back references and removes staging on %s failure', operation => {
    const f = fixture(); const old = f.service.publishCandidate(f.publish);
    vi.spyOn(fs, operation).mockImplementationOnce(() => { throw Object.assign(new Error('injected I/O failure'), { code: 'EIO' }); });
    expect(() => f.service.publishCandidate(f.publish)).toThrow('injected I/O failure');
    expect(f.repo.getJob(f.job.id).artifact_version_ids).toEqual([old.id]);
    expect(fs.readdirSync(path.join(f.root, '.featherduster/jobs/artifacts', f.job.id))).toEqual([old.id]);
    expect(f.service.getArtifact(old.id)).toEqual(old);
  });
  it('renames a synced complete directory before publishing metadata', () => {
    const f = fixture(); const rename = fs.renameSync; const publish = f.repo.publishArtifact.bind(f.repo);
    let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      expect(fs.existsSync(path.join(String(source), 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(String(source), 'preview-1.png'))).toBe(true);
      expect(f.repo.getJob(f.job.id).artifact_version_ids).toEqual([]);
      expect(fs.existsSync(destination)).toBe(false);
      rename(source, destination); renamed = true;
    });
    vi.spyOn(f.repo, 'publishArtifact').mockImplementation((...args) => { expect(renamed).toBe(true); return publish(...args); });
    f.service.publishCandidate(f.publish);
  });
  it('does not ignore file fsync errors even when the code is unsupported on Windows', () => {
    const f = fixture();
    const sync = fs.fsyncSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (fs.fstatSync(fd).isFile()) throw Object.assign(new Error('unsupported file sync'), { code: 'EINVAL' });
      sync(fd);
    });
    expect(() => f.service.publishCandidate(f.publish)).toThrow();
    expect(f.repo.getJob(f.job.id).artifact_version_ids).toEqual([]);
  });
  it.each(['EINVAL', 'EIO'])('only tolerates documented Windows directory sync limitations: %s', code => {
    const f = fixture(); const sync = fs.fsyncSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('directory sync'), { code });
      sync(fd);
    });
    if (process.platform === 'win32' && code === 'EINVAL') expect(f.service.publishCandidate(f.publish).id).toBeTruthy();
    else expect(() => f.service.publishCandidate(f.publish)).toThrow();
  });
  it('retains an unreferenced complete orphan after metadata failure', () => {
    const f = fixture(); const old = f.service.publishCandidate(f.publish);
    vi.spyOn(f.repo, 'publishArtifact').mockImplementationOnce(() => { throw new Error('metadata failure'); });
    expect(() => f.service.publishCandidate(f.publish)).toThrow('metadata failure');
    expect(f.repo.getJob(f.job.id).artifact_version_ids).toEqual([old.id]);
    const parent = path.join(f.root, '.featherduster/jobs/artifacts', f.job.id);
    expect(fs.readdirSync(parent)).toHaveLength(2);
    for (const id of fs.readdirSync(parent)) expect(fs.existsSync(path.join(parent, id, 'manifest.json'))).toBe(true);
    expect(new JobArtifactsService(open(f.root)).getArtifact(old.id)).toEqual(old);
  });
  it('binds idempotent human approval to exact hashes and forks the historical draft', () => {
    const f = fixture(); const a = f.service.publishCandidate(f.publish); const request = f.approval(a);
    const review = f.service.approveResume(request); expect(f.service.approveResume(request)).toEqual(review);
    expect(() => f.service.approveResume({ ...request, reviewer_id: 'someone else' })).toThrow(expect.objectContaining({ code: 'idempotency_conflict' }));
    f.drafts.save({ ...f.draft, candidate: { ...f.draft.candidate, summary: 'later edits' } }, 0);
    const forkRequest = { job_id: f.job.id, expected_job_revision: request.expected_job_revision, artifact_version_id: a.id, artifact_fingerprint: a.version_fingerprint, idempotency_key: randomUUID() };
    const fork = f.service.continueEditing(forkRequest);
    expect(f.service.continueEditing(forkRequest)).toEqual(fork); expect(fork.id).not.toBe(f.draft.id); expect(fork.revision).toBe(0);
    expect(fork.parent_artifact_version_id).toBe(a.id); expect(fork.candidate).toEqual(f.draft.candidate);
    f.drafts.save({ ...fork, candidate: { ...fork.candidate, summary: 'new version' } }, 0);
    const next = f.service.publishCandidate({ ...f.publish, draft_id: fork.id, expected_draft_revision: 1 });
    expect(next.parent_version_id).toBe(a.id); expect(f.service.getArtifact(a.id)).toEqual(a);
    const reopened = open(f.root); const events = reopened.listEvents(f.job.id).filter(e => e.payload.kind === 'resume_review');
    expect(events).toHaveLength(1); expect(events[0]!.actor).toEqual({ kind: 'user', id: 'human' });
    expect(events[0]!.payload).toMatchObject({ artifact_fingerprint: a.version_fingerprint, input_fingerprint: f.input.fingerprint, review_id: review.id });
    expect(new JobArtifactsService(reopened).approveResume(request)).toEqual(review);
    expect(reopened.getJob(f.job.id).application_lifecycle).toBe('not_started');
  });
  it('rejects stale revisions, wrong hashes and incomplete validation', () => {
    const f = fixture(); const a = f.service.publishCandidate(f.publish); const request = f.approval(a);
    for (const change of [{ artifact_fingerprint: 'wrong' }, { input_fingerprint: 'wrong' }, { expected_job_revision: 0 }, { reviewer_id: '' }]) expect(() => f.service.approveResume({ ...request, ...change })).toThrow();
    for (const validation_result of ['pending', 'failed'] as const) {
      const b = f.service.publishCandidate({ ...f.publish, validation_result }); expect(() => f.service.approveResume(f.approval(b))).toThrow(expect.objectContaining({ code: 'ineligible' }));
    }
    fs.rmSync(path.join(f.root, a.source.id)); expect(() => f.service.approveResume(request)).toThrow(expect.objectContaining({ code: 'corrupt_data' }));
    expect(f.repo.listEvents(f.job.id).filter(e => e.payload.kind === 'resume_review')).toHaveLength(0);
  });
});

it('always captures knowledge and verifies its bytes with the manifest', () => {
  const f = fixture();
  expect(f.input.corpus_knowledge).toBeDefined();
  const knowledge = JSON.parse(f.repo.database.files.readSnapshot(f.input.corpus_knowledge!, f.job.id, f.input.id).toString());
  expect(knowledge).toEqual({ schema_version: 1, revision: 0, updates: [] });
  fs.writeFileSync(path.join(f.root, f.input.corpus_knowledge!.id), '{}');
  expect(() => f.service.getInputSnapshot(f.input.id)).toThrow(expect.objectContaining({ code: 'corrupt_data' }));
});

it('reads legacy manifests without inserting a default knowledge reference or changing hashes', () => {
  const f = fixture(); const files = f.repo.database.files;
  const manifestPath = `${files.bundlePath('snapshots', f.job.id, f.input.id)}/manifest.json`;
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, manifestPath), 'utf8'));
  delete manifest.snapshot.corpus_knowledge;
  const bytes = JSON.stringify(manifest);
  fs.writeFileSync(path.join(f.root, manifestPath), bytes);
  const { corpus_knowledge: _, ...legacy } = f.input; legacy.fingerprint = fingerprint(bytes);
  f.repo.database.db.prepare('UPDATE input_snapshots SET payload=?,fingerprint=? WHERE id=?').run(JSON.stringify(legacy), legacy.fingerprint, legacy.id);
  expect(f.service.getInputSnapshot(legacy.id)).toEqual(legacy);
  expect(fs.readFileSync(path.join(f.root, manifestPath), 'utf8')).toBe(bytes);
});
