import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import type { JobsDatabase } from './database.js';
import { fingerprint } from './files.js';

export type RepositoryErrorCode = 'not_found' | 'revision_conflict' | 'invalid_ownership' | 'invalid_relationship' | 'idempotency_conflict' | 'corrupt_data' | 'ineligible';
export class RepositoryError extends Error {
  constructor(readonly code: RepositoryErrorCode, message: string) { super(message); }
}
export interface OwnershipFence { attempt_id: string; owner_token: string; stop_generation: number }
const stable = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
interface Schema<T> { parse(value: unknown): T }
export class JobsRepository {
  private readonly now: () => string;
  private readonly uuid: () => string;
  constructor(readonly database: JobsDatabase, options: { now?: () => string; uuid?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString()); this.uuid = options.uuid ?? randomUUID;
  }
  private tx<T>(fn: () => T): T { return this.database.db.transaction(fn).immediate(); }
  private error(code: RepositoryErrorCode, message: string): never { throw new RepositoryError(code, message); }
  private workspace(value: { workspace_id: string }): void { if (value.workspace_id !== this.database.workspaceId) this.error('invalid_relationship', 'Wrong workspace'); }
  private decode<T>(row: unknown, schema: Schema<T>): T {
    if (!row) return this.error('not_found', 'Record not found');
    try {
      const value = schema.parse(JSON.parse((row as { payload: string }).payload));
      if (value && typeof value === 'object' && 'workspace_id' in value && value.workspace_id !== this.database.workspaceId) throw new Error('Foreign workspace');
      return value;
    }
    catch { return this.error('corrupt_data', 'Invalid or unsupported stored record; restore a compatible backup'); }
  }
  private get<T>(table: string, id: string, schema: Schema<T>): T { return this.decode(this.database.db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id), schema); }
  private insert(table: string, value: unknown, columns: Record<string, unknown>): void {
    const data = { ...columns, payload: JSON.stringify(value) };
    this.database.db.prepare(`INSERT INTO ${table} (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?').join(',')})`).run(...Object.values(data));
  }
  withReceipt<T>(operation: string, key: string, request: unknown, fn: () => T): { result: T; replayed: boolean } {
    return this.receipt(operation, key, request, fn);
  }
  private receipt<T>(operation: string, key: string, request: unknown, fn: () => T): { result: T; replayed: boolean } {
    if (!key.trim()) this.error('idempotency_conflict', 'An idempotency key is required');
    return this.tx(() => {
      const hash = fingerprint(stable(request));
      const row = this.database.db.prepare('SELECT fingerprint,result FROM mutation_receipts WHERE workspace_id=? AND operation=? AND idempotency_key=?').get(this.database.workspaceId, operation, key) as { fingerprint: string; result: string } | undefined;
      if (row) {
        if (row.fingerprint !== hash) this.error('idempotency_conflict', 'Key used for a different request');
        try { return { result: JSON.parse(row.result) as T, replayed: true }; } catch { return this.error('corrupt_data', 'Invalid receipt'); }
      }
      const result = fn();
      this.database.db.prepare('INSERT INTO mutation_receipts VALUES (?,?,?,?,?,?)').run(this.database.workspaceId, operation, key, hash, JSON.stringify(result), this.now());
      return { result, replayed: false };
    });
  }
  getJob(id: string): C.Job { const j = this.get('jobs', id, C.JobSchema); this.workspace(j); return j; }
  listJobs(): C.Job[] { return this.database.db.prepare('SELECT payload FROM jobs ORDER BY created_at,id').all().map(r => this.decode(r, C.JobSchema)); }
  findByAlias(url: string): C.Job | null {
    const row = this.database.db.prepare('SELECT job_id FROM url_aliases WHERE workspace_id=? AND url=?').get(this.database.workspaceId, url) as { job_id: string } | undefined;
    return row ? this.getJob(row.job_id) : null;
  }
  createJob(value: C.Job, key: string) {
    const job = C.JobSchema.parse(value); this.workspace(job);
    const { id: _id, created_at: _created, updated_at: _updated, ...request } = job;
    return this.receipt('create', key, request, () => {
      const urls = [...new Set([job.canonical_url, job.original_url].filter((url): url is string => url !== null))];
      const matches = urls.map(url => this.findByAlias(url)).filter((match): match is C.Job => match !== null);
      if (matches.length) {
        const existing = matches[0]!;
        if (matches.some(match => match.id !== existing.id)) this.error('invalid_relationship', 'Aliases belong to different jobs');
        for (const url of urls) this.database.db.prepare('INSERT OR IGNORE INTO url_aliases VALUES (?,?,?)').run(job.workspace_id, url, existing.id);
        return existing;
      }
      if (job.revision !== 0 || job.current_attempt_id || job.artifact_version_ids.length || job.preparation_state === 'preparing' || job.preparation_state === 'resume_ready') this.error('invalid_relationship', 'New job cannot contain execution results');
      this.jobLinks(job);
      this.insert('jobs', job, { id: job.id, workspace_id: job.workspace_id, revision: job.revision, kind: job.kind, updated_at: job.updated_at, canonical_url: job.canonical_url, preparation_state: job.preparation_state, application_lifecycle: job.application_lifecycle, created_at: job.created_at });
      for (const url of new Set([job.canonical_url, job.original_url].filter(Boolean))) this.database.db.prepare('INSERT INTO url_aliases VALUES (?,?,?)').run(job.workspace_id, url, job.id);
      return job;
    });
  }
  commitIntakeCapture(jobValue: C.Job, snapshotValue: C.PostingSnapshot | null, key: string, submitted: unknown, fallback?: { job_id: string; revision: number }) {
    const job = C.JobSchema.parse(jobValue); this.workspace(job);
    const snapshot = snapshotValue ? C.PostingSnapshotSchema.parse(snapshotValue) : null;
    if (snapshot) { this.workspace(snapshot); if (snapshot.job_id !== job.id || snapshot.content_fingerprint !== fingerprint(snapshot.text)) this.error('invalid_relationship', 'Invalid capture binding'); }
    const { id, created_at, updated_at, ...jobContent } = job;
    const content = snapshot && { source_kind: snapshot.source_kind, original_url: snapshot.original_url, final_url: snapshot.final_url, text: snapshot.text, content_fingerprint: snapshot.content_fingerprint };
    // Scope IDs are generated for new jobs, not part of the semantic request.
    const request = { submitted, fallback, job: { ...jobContent, missing_inputs: job.missing_inputs.map(({ scope, ...q }) => q) }, snapshot: content };
    return this.receipt('intake', key, request, () => {
      let saved: C.Job;
      if (fallback) {
        saved = this.getJob(fallback.job_id); this.revision(saved.revision, fallback.revision);
        if (saved.id !== job.id || saved.kind !== 'job' || saved.preparation_state !== 'needs_input' || !saved.missing_inputs.some(q => q.key === 'posting_text') || !snapshot || snapshot.source_kind !== 'text') this.error('ineligible', 'Posting text fallback is not eligible');
      } else {
        const aliases = [...new Set([job.original_url, job.canonical_url, job.original_url ? C.canonicalizeJobUrl(job.original_url) : null].filter((url): url is string => url !== null))];
        const matches = aliases.map(url => this.findByAlias(url)).filter((match): match is C.Job => match !== null);
        if (matches.some(match => match.id !== matches[0]!.id)) this.error('invalid_relationship', 'Aliases belong to different jobs');
        saved = matches[0] ?? this.createJob(job, `intake:${key}`).result;
        for (const alias of aliases) this.database.db.prepare('INSERT OR IGNORE INTO url_aliases VALUES (?,?,?)').run(job.workspace_id, alias, saved.id);
        if (saved.id !== job.id) return { job: saved, disposition: 'duplicate' as const };
      }
      if (snapshot) {
        this.savePostingSnapshot(snapshot);
        saved = this.updateJob({ ...saved, posting_snapshot_id: snapshot.id, missing_inputs: fallback ? saved.missing_inputs.filter(q => q.key !== 'posting_text') : saved.missing_inputs }, saved.revision);
      }
      return { job: saved, disposition: 'saved' as const };
    });
  }
  private jobLinks(job: C.Job): void {
    if (job.parent_discovery_id && this.getJob(job.parent_discovery_id).kind !== 'discovery') this.error('invalid_relationship', 'Parent must be discovery');
    if (job.posting_snapshot_id) this.sameJob(this.getPostingSnapshot(job.posting_snapshot_id), job.id);
  }
  private sameJob(record: { workspace_id: string; job_id: string }, jobId: string): void {
    this.workspace(record); if (record.job_id !== jobId) this.error('invalid_relationship', 'Cross-job reference');
  }
  private revision(actual: number, expected: number): void { if (actual !== expected) this.error('revision_conflict', 'Stale revision'); }
  private putJob(value: C.Job): C.Job {
    const job = C.JobSchema.parse({ ...value, revision: value.revision + 1, updated_at: this.now() });
    this.database.db.prepare('UPDATE jobs SET revision=?, updated_at=?, preparation_state=?, application_lifecycle=?, payload=? WHERE id=?').run(job.revision, job.updated_at, job.preparation_state, job.application_lifecycle, JSON.stringify(job), job.id); return job;
  }
  updateJob(value: C.Job, expectedRevision: number): C.Job {
    return this.tx(() => {
      const next = C.JobSchema.parse(value); this.workspace(next); const old = this.getJob(next.id); this.revision(old.revision, expectedRevision);
      if (next.archived_at !== old.archived_at) this.error('invalid_relationship', 'Use job tracking to archive or restore a job');
      for (const field of ['id', 'workspace_id', 'revision', 'created_at', 'kind', 'canonical_url', 'original_url', 'archived_at', 'preparation_state', 'application_lifecycle', 'preparation_stage', 'current_attempt_id', 'artifact_version_ids'] as const) if (stable(next[field]) !== stable(old[field])) this.error('invalid_relationship', `Cannot edit ${field} directly`);
      this.jobLinks(next); return this.putJob(next);
    });
  }
  saveDetails(id: string, request: { expected_revision: number; idempotency_key: string; changes: Partial<Pick<C.Job, 'company' | 'role' | 'notes' | 'context_url'>>; posting_text?: string }) {
    return this.receipt('job_details', request.idempotency_key, { id, ...request }, () => {
      const old = this.getJob(id); this.revision(old.revision, request.expected_revision);
      const previous = old.posting_snapshot_id ? this.getPostingSnapshot(old.posting_snapshot_id) : null;
      const changedPosting = request.posting_text !== undefined && request.posting_text !== previous?.text;
      const changedContext = changedPosting || (request.changes.company !== undefined && request.changes.company !== old.company) || (request.changes.role !== undefined && request.changes.role !== old.role);
      if (changedContext && ['preparing', 'queued'].includes(old.preparation_state)) this.error('ineligible', 'Stop active preparation before changing its context');
      let next = C.JobSchema.parse({ ...old, ...request.changes });
      if (changedPosting) {
        const posting = this.savePostingSnapshot({ schema_version: 1, id: this.uuid(), workspace_id: old.workspace_id, job_id: id, source_kind: 'text', original_url: old.original_url, final_url: null, retrieved_at: null, captured_at: this.now(), text: request.posting_text!, content_fingerprint: fingerprint(request.posting_text!) });
        next.posting_snapshot_id = posting.id;
        next.missing_inputs = next.missing_inputs.filter(q => q.key !== 'posting_text');
        if (!old.current_attempt_id && old.preparation_state === 'needs_input' && !next.missing_inputs.length) {
          next.preparation_state = 'saved'; next.state_reason = null;
        }
      }
      if (changedContext && old.current_attempt_id) {
        next.recovery = { kind: 'stale_inputs', subject: {}, action: 'refresh_inputs' };
        next.state_reason = 'Job context changed. Previous materials are retained; capture current inputs before preparing again.';
        next.preparation_state = 'needs_input';
      }
      return { job: this.putJob(next) };
    });
  }
  private immutable<T extends { id: string; workspace_id: string; job_id: string }>(table: string, value: T, schema: Schema<T>, extra: Record<string, unknown> = {}): T {
    const item = schema.parse(value); this.workspace(item); this.getJob(item.job_id);
    const row = this.database.db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(item.id);
    if (row) { const old = this.decode(row, schema); if (stable(old) !== stable(item)) this.error('idempotency_conflict', 'Immutable record already exists'); return old; }
    this.insert(table, item, { id: item.id, job_id: item.job_id, ...extra }); return item;
  }
  savePostingSnapshot(value: C.PostingSnapshot): C.PostingSnapshot { return this.tx(() => this.immutable('posting_snapshots', value, C.PostingSnapshotSchema, { fingerprint: value.content_fingerprint })); }
  getPostingSnapshot(id: string): C.PostingSnapshot { return this.get('posting_snapshots', id, C.PostingSnapshotSchema); }
  saveInputSnapshot(value: C.InputSnapshot): C.InputSnapshot {
    return this.tx(() => { const input = C.InputSnapshotSchema.parse(value); const posting = this.getPostingSnapshot(input.posting.id); this.sameJob(posting, input.job_id); if (posting.content_fingerprint !== input.posting.fingerprint) this.error('invalid_relationship', 'Posting fingerprint mismatch'); return this.immutable('input_snapshots', input, C.InputSnapshotSchema, { fingerprint: input.fingerprint }); });
  }
  saveFitInputSnapshot(value: C.FitInputSnapshot): C.FitInputSnapshot {
    return this.tx(() => {
      const input = C.FitInputSnapshotSchema.parse(value);
      const posting = this.getPostingSnapshot(input.posting.id); this.sameJob(posting, input.job_id);
      if (posting.content_fingerprint !== input.posting.fingerprint) this.error('invalid_relationship', 'Posting fingerprint mismatch');
      return this.immutable('input_snapshots', input, C.FitInputSnapshotSchema, { fingerprint: input.fingerprint });
    });
  }
  saveMaterialInputSnapshot(value: C.MaterialInputSnapshot): C.MaterialInputSnapshot {
    return this.tx(() => {
      const input = C.MaterialInputSnapshotSchema.parse(value);
      const posting = this.getPostingSnapshot(input.posting.id); this.sameJob(posting, input.job_id);
      if (posting.content_fingerprint !== input.posting.fingerprint) this.error('invalid_relationship', 'Posting fingerprint mismatch');
      return this.immutable('input_snapshots', input, C.MaterialInputSnapshotSchema, { fingerprint: input.fingerprint });
    });
  }
  getExecutionInput(id: string) { return this.get('input_snapshots', id, C.ExecutionInputSchema); }
  getInputSnapshot(id: string): C.InputSnapshot { return this.get('input_snapshots', id, C.InputSnapshotSchema); }
  getProfile(id: string): C.CandidateProfile { return this.get('profiles', id, C.CandidateProfileSchema); }
  saveProfile(value: C.CandidateProfile, expectedRevision: number | null): C.CandidateProfile {
    return this.tx(() => {
      let profile = C.CandidateProfileSchema.parse(value); this.workspace(profile);
      const row = this.database.db.prepare('SELECT payload FROM profiles WHERE id=?').get(profile.id);
      if (row) { const old = this.decode(row, C.CandidateProfileSchema); this.revision(old.revision, expectedRevision ?? -1); profile = { ...profile, revision: old.revision + 1, created_at: old.created_at, updated_at: this.now() }; this.database.db.prepare('UPDATE profiles SET revision=?,payload=? WHERE id=?').run(profile.revision, JSON.stringify(profile), profile.id); }
      else { if (expectedRevision !== null || profile.revision !== 0) this.error('revision_conflict', 'Expected new profile'); this.insert('profiles', profile, { id: profile.id, workspace_id: profile.workspace_id, revision: 0 }); }
      return profile;
    });
  }
  saveAnswer(value: C.ScopedAnswer): C.ScopedAnswer {
    return this.tx(() => {
      let answer = C.ScopedAnswerSchema.parse(value); this.workspace(answer);
      const scope = answer.scope; const identity = scope.kind === 'candidate' ? this.database.workspaceId : scope.kind === 'job' ? scope.job_id : scope.employer_id;
      if (scope.kind === 'job') this.getJob(scope.job_id);
      const old = this.database.db.prepare('SELECT payload FROM scoped_answers WHERE workspace_id=? AND scope_kind=? AND scope_identity=? AND key=?').get(answer.workspace_id, scope.kind, identity, answer.key);
      if (old) { answer = { ...answer, id: this.decode(old, C.ScopedAnswerSchema).id }; this.database.db.prepare('UPDATE scoped_answers SET payload=? WHERE id=?').run(JSON.stringify(answer), answer.id); }
      else this.insert('scoped_answers', answer, { id: answer.id, workspace_id: answer.workspace_id, scope_kind: scope.kind, scope_identity: identity, key: answer.key, job_id: scope.kind === 'job' ? scope.job_id : null });
      return answer;
    });
  }
  listAnswers(scope: C.AnswerScope): C.ScopedAnswer[] {
    scope = C.AnswerScopeSchema.parse(scope);
    const identity = scope.kind === 'candidate' ? this.database.workspaceId : scope.kind === 'job' ? scope.job_id : scope.employer_id;
    return this.database.db.prepare('SELECT payload FROM scoped_answers WHERE workspace_id=? AND scope_kind=? AND scope_identity=? ORDER BY key').all(this.database.workspaceId, scope.kind, identity).map(r => this.decode(r, C.ScopedAnswerSchema));
  }
  getLatestDraft(id: string): C.JobDraft { return this.decode(this.database.db.prepare('SELECT payload FROM draft_revisions WHERE id=? ORDER BY revision DESC LIMIT 1').get(id), C.JobDraftSchema); }
  getDraftRevision(id: string, revision: number): C.JobDraft { return this.decode(this.database.db.prepare('SELECT payload FROM draft_revisions WHERE id=? AND revision=?').get(id, revision), C.JobDraftSchema); }
  approveResume(request: { job_id: string; expected_job_revision: number; artifact_version_id: string; artifact_fingerprint: string; input_snapshot_id: string; input_fingerprint: string; reviewer_id: string; idempotency_key: string }, currentChecks?: () => void): C.ResumeReview {
    const { idempotency_key, ...data } = request;
    return this.receipt('approve_resume', idempotency_key, data, () => {
      const job = this.getJob(data.job_id); this.revision(job.revision, data.expected_job_revision);
      const artifact = this.getArtifact(data.artifact_version_id); this.sameJob(artifact, job.id);
      if (artifact.validation_result !== 'passed') this.error('ineligible', 'Only validated artifacts may be approved');
      if (job.artifact_version_ids.at(-1) !== artifact.id) this.error('ineligible', 'Only the current artifact may be approved');
      const manifest = JSON.parse(this.database.files.readArtifact({ id: `${this.database.files.bundlePath('artifacts', job.id, artifact.id)}/manifest.json`, fingerprint: artifact.version_fingerprint }, job.id, artifact.id).toString()) as { draft_id: string; draft_revision: number };
      const published = this.getDraftRevision(manifest.draft_id, manifest.draft_revision);
      const working = this.database.db.prepare('SELECT id FROM draft_revisions WHERE job_id=? AND parent_artifact_version_id=? ORDER BY rowid DESC LIMIT 1').get(job.id, artifact.id) as { id: string } | undefined;
      if (working && stable(this.getLatestDraft(working.id).candidate) !== stable(published.candidate)) this.error('ineligible', 'Working resume has pending edits; wait for a new checked PDF.');
      currentChecks?.();
      if (artifact.version_fingerprint !== data.artifact_fingerprint || artifact.input_snapshot_id !== data.input_snapshot_id || artifact.input_fingerprint !== data.input_fingerprint) this.error('invalid_relationship', 'Approval binding mismatch');
      const existing = this.listEvents(job.id).find(event => event.payload.kind === 'resume_review' && event.payload.artifact_version_id === artifact.id && event.payload.artifact_fingerprint === artifact.version_fingerprint);
      if (existing?.payload.kind === 'resume_review') return C.ResumeReviewSchema.parse({ schema_version: 1, id: existing.payload.review_id, workspace_id: job.workspace_id,
        job_id: job.id, artifact_version_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, input_snapshot_id: artifact.input_snapshot_id,
        input_fingerprint: artifact.input_fingerprint, reviewer_id: existing.actor.id, reviewed_at: existing.created_at, decision: 'approved' });
      const review = C.ResumeReviewSchema.parse({ schema_version: 1, id: this.uuid(), workspace_id: job.workspace_id, job_id: job.id, artifact_version_id: artifact.id, artifact_fingerprint: data.artifact_fingerprint, input_snapshot_id: data.input_snapshot_id, input_fingerprint: data.input_fingerprint, reviewer_id: data.reviewer_id, reviewed_at: this.now(), decision: 'approved' });
      this.appendEvent({ schema_version: 1, id: this.uuid(), workspace_id: job.workspace_id, job_id: job.id, created_at: review.reviewed_at, actor: { kind: 'user', id: review.reviewer_id }, attempt_id: null, idempotency_key: `approval:${idempotency_key}`, payload: { kind: 'resume_review', review_id: review.id, artifact_version_id: artifact.id, artifact_fingerprint: review.artifact_fingerprint, input_snapshot_id: review.input_snapshot_id, input_fingerprint: review.input_fingerprint } });
      return review;
    }).result;
  }
  forkDraft(request: { job_id: string; expected_job_revision: number; artifact_version_id: string; artifact_fingerprint: string; draft_id: string; draft_revision: number; idempotency_key: string }): C.JobDraft {
    const { idempotency_key, ...data } = request;
    return this.receipt('fork_draft', idempotency_key, data, () => {
      const job = this.getJob(data.job_id); this.revision(job.revision, data.expected_job_revision);
      const artifact = this.getArtifact(data.artifact_version_id); this.sameJob(artifact, job.id);
      const source = this.getDraftRevision(data.draft_id, data.draft_revision); this.sameJob(source, job.id);
      let linkage: { draft_id?: string; draft_revision?: number };
      try { linkage = JSON.parse(this.database.files.readArtifact({ id: `${this.database.files.bundlePath('artifacts', job.id, artifact.id)}/manifest.json`, fingerprint: artifact.version_fingerprint }, job.id, artifact.id).toString()); }
      catch { return this.error('corrupt_data', 'Artifact draft manifest is unavailable'); }
      if (linkage.draft_id !== source.id || linkage.draft_revision !== source.revision) this.error('invalid_relationship', 'Artifact was produced by another draft revision');
      if (artifact.version_fingerprint !== data.artifact_fingerprint || artifact.input_snapshot_id !== source.input_snapshot_id) this.error('invalid_relationship', 'Fork binding mismatch');
      const now = this.now();
      return this.saveDraft({ ...source, id: this.uuid(), revision: 0, parent_artifact_version_id: artifact.id, created_at: now, updated_at: now }, null);
    }).result;
  }
  saveDraft(value: C.JobDraft, expectedRevision: number | null): C.JobDraft {
    return this.tx(() => {
      let draft = C.JobDraftSchema.parse(value); this.workspace(draft); this.getJob(draft.job_id); this.sameJob(this.getInputSnapshot(draft.input_snapshot_id), draft.job_id);
      if (draft.parent_artifact_version_id) this.sameJob(this.getArtifact(draft.parent_artifact_version_id), draft.job_id);
      const row = this.database.db.prepare('SELECT payload FROM draft_revisions WHERE id=? ORDER BY revision DESC LIMIT 1').get(draft.id);
      if (row) { const old = this.decode(row, C.JobDraftSchema); this.sameJob(old, draft.job_id); if (old.input_snapshot_id !== draft.input_snapshot_id || old.parent_artifact_version_id !== draft.parent_artifact_version_id) this.error('invalid_relationship', 'Draft lineage is immutable'); this.revision(old.revision, expectedRevision ?? -1); draft = { ...draft, revision: old.revision + 1, created_at: old.created_at, updated_at: this.now() }; }
      else if (expectedRevision !== null || draft.revision !== 0) this.error('revision_conflict', 'Expected new draft');
      this.insert('draft_revisions', draft, { id: draft.id, revision: draft.revision, job_id: draft.job_id, input_snapshot_id: draft.input_snapshot_id, parent_artifact_version_id: draft.parent_artifact_version_id }); return draft;
    });
  }
  appendEvent(value: C.JobEvent): C.JobEvent {
    return this.tx(() => {
      const event = C.JobEventSchema.parse(value); this.workspace(event); this.getJob(event.job_id); if (event.attempt_id) this.sameJob(this.getAttempt(event.attempt_id), event.job_id);
      if (event.payload.kind === 'resume_review') {
        const artifact = this.getArtifact(event.payload.artifact_version_id); this.sameJob(artifact, event.job_id);
        if (artifact.version_fingerprint !== event.payload.artifact_fingerprint || artifact.input_snapshot_id !== event.payload.input_snapshot_id || artifact.input_fingerprint !== event.payload.input_fingerprint) this.error('invalid_relationship', 'Review binding mismatch');
      } else if (event.payload.kind === 'resume_finalized') {
  const a = this.getArtifact(event.payload.artifact_version_id);
  const d = this.getDraftRevision(event.payload.draft_id, event.payload.draft_revision);
  this.sameJob(a, event.job_id); this.sameJob(d, event.job_id);
  if (a.origin !== 'manual' || a.parent_version_id !== event.payload.parent_artifact_version_id
    || d.parent_artifact_version_id !== a.parent_version_id || d.input_snapshot_id !== a.input_snapshot_id)
    this.error('invalid_relationship', 'Finalization event binding mismatch');
} else if (event.payload.kind === 'channel_action' && event.payload.artifact_version_id) this.sameJob(this.getArtifact(event.payload.artifact_version_id), event.job_id);
      const row = this.database.db.prepare('SELECT payload FROM events WHERE id=? OR (workspace_id=? AND idempotency_key=?)').get(event.id, event.workspace_id, event.idempotency_key);
      if (row) {
        const old = this.decode(row, C.JobEventSchema);
        const { id: _oldId, created_at: _oldTime, ...oldRequest } = old;
        const { id: _newId, created_at: _newTime, ...newRequest } = event;
        if (stable(oldRequest) !== stable(newRequest)) this.error('idempotency_conflict', 'Event key reused');
        return old;
      }
      this.insert('events', event, { id: event.id, workspace_id: event.workspace_id, job_id: event.job_id, attempt_id: event.attempt_id, idempotency_key: event.idempotency_key }); return event;
    });
  }
  listEvents(jobId: string): C.JobEvent[] { return this.database.db.prepare('SELECT payload FROM events WHERE job_id=? ORDER BY sequence').all(jobId).map(r => this.decode(r, C.JobEventSchema)); }
  private event(job: C.Job, payload: C.JobEvent['payload']): void {
    this.appendEvent({ schema_version: 1, id: this.uuid(), workspace_id: job.workspace_id, job_id: job.id, created_at: this.now(), actor: { kind: 'worker', id: 'repository' }, attempt_id: job.current_attempt_id, idempotency_key: null, payload });
  }
  private preparation(job: C.Job, action: C.PreparationAction, reason: string): C.Job {
    const executionInput = job.current_attempt_id && ['material_complete', 'fit_complete', 'fail', 'block', 'interrupt', 'cancel'].includes(action)
      ? this.getExecutionInput(this.getAttempt(job.current_attempt_id).input_snapshot_id) : null;
    const fitInput = executionInput && executionInput.schema_version !== 1 ? executionInput : null;
    const restoreFitState = fitInput && (action === 'material_complete' || action === 'fit_complete' || fitInput.return_state === 'resume_ready');
    const next = this.putJob({ ...C.transitionPreparation(job, action),
      ...(restoreFitState ? { preparation_state: fitInput.return_state, preparation_stage: null, missing_inputs: fitInput.return_missing_inputs } : {}),
      recovery: restoreFitState ? fitInput.return_recovery : action === 'complete' ? undefined : job.recovery, state_reason: reason });
    this.event(next, { kind: 'preparation_transition', ...(next.recovery ? { recovery: next.recovery } : {}), from: job.preparation_state, to: next.preparation_state, reason }); return next;
  }
  transitionApplication(jobId: string, target: C.ApplicationLifecycle, expectedRevision: number, key: string) {
    return this.receipt('application', key, { jobId, target, expectedRevision }, () => {
      const job = this.getJob(jobId); this.revision(job.revision, expectedRevision); if (job.application_lifecycle === target) return job;
      const next = this.putJob(C.transitionApplication(job, target)); this.event(next, { kind: 'application_transition', from: job.application_lifecycle, to: target, reason: 'Explicit application update' }); return next;
    });
  }
  trackJob(jobId: string, action: 'applied' | 'unapply' | 'archive' | 'restore', expectedRevision: number, key: string) {
    return this.receipt('job_tracking', key, { jobId, action, expectedRevision }, () => {
      const job = this.getJob(jobId); this.revision(job.revision, expectedRevision);
      if (['queued', 'preparing'].includes(job.preparation_state)) this.error('ineligible', 'Cancel active preparation before changing job tracking.');
      if (action === 'archive' || action === 'restore') {
        const next = this.putJob({ ...job, archived_at: action === 'archive' ? this.now() : null });
        this.event(next, { kind: 'archive_change', archived: action === 'archive' });
        return next;
      }
      if (action === 'unapply' && job.application_lifecycle !== 'submitted') this.error('ineligible', 'Only applied jobs can be marked not applied.');
      const target = action === 'applied' ? 'submitted' : 'not_started';
      const next = this.putJob(C.transitionApplication(job, target));
      this.event(next, { kind: 'application_transition', from: job.application_lifecycle, to: target, reason: 'Manually updated job tracking' });
      return next;
    });
  }
  transitionPreparation(jobId: string, action: C.PreparationAction, expectedRevision: number, key: string, fence?: OwnershipFence, metadata: { recovery?: C.JobRecovery; reason?: string; error?: C.Attempt['error']; elapsed_ms?: number; missing_inputs?: C.Job['missing_inputs'] } = {}) {
    return this.receipt('preparation', key, { jobId, action, expectedRevision, fence, metadata }, () => {
      const job = this.getJob(jobId); this.revision(job.revision, expectedRevision);
      if (action === 'claim') this.error('invalid_ownership', 'Use claimJob');
      if (job.preparation_state === 'preparing') {
        if (!fence) this.error('invalid_ownership', 'Ownership required');
        const attempt = this.fenced(fence); this.sameJob(attempt, job.id);
        if (action === 'complete' && !job.artifact_version_ids.some(id => { const a = this.getArtifact(id); return a.attempt_id === attempt.id && a.input_snapshot_id === attempt.input_snapshot_id && a.validation_result === 'passed'; })) this.error('invalid_relationship', 'Completion requires passed artifacts');
        if (action === 'material_complete') {
          const input = this.getExecutionInput(attempt.input_snapshot_id);
          if (input.schema_version !== 3 || !this.listCheckpoints(attempt.id).some(cp => cp.completed_stage === 'material' && cp.input_fingerprint === input.fingerprint)) this.error('invalid_relationship', 'Material completion requires bound output');
        }
        if (action === 'fit_complete') {
          const input = this.getExecutionInput(attempt.input_snapshot_id);
          if (input.schema_version !== 2 || !this.listCheckpoints(attempt.id).some(cp => cp.completed_stage === 'fit' && cp.input_fingerprint === input.fingerprint)) this.error('invalid_relationship', 'Fit completion requires a bound assessment');
        }
        this.putAttempt({ ...attempt, error: metadata.error ?? attempt.error, resource_usage: { ...attempt.resource_usage, elapsed_ms: Math.max(attempt.resource_usage.elapsed_ms, metadata.elapsed_ms ?? 0) }, status: action === 'complete' || action === 'fit_complete' || action === 'material_complete' ? 'completed' : action === 'fail' || action === 'block' ? 'failed' : action === 'interrupt' ? 'interrupted' : 'cancelled', finished_at: this.now(), cancelled_at: action === 'cancel' ? this.now() : null });
      }
      return this.preparation({ ...job, recovery: metadata.recovery ?? job.recovery, missing_inputs: metadata.missing_inputs ?? job.missing_inputs }, action, metadata.reason ?? `Explicit ${action}`);
    });
  }
  cancelJob(jobId: string, expectedRevision: number, key: string, reason = 'Cancelled by user') {
    return this.receipt('cancel_job', key, { jobId, expectedRevision, reason }, () => {
      const job = this.getJob(jobId);
      this.revision(job.revision, expectedRevision);
      if (!['queued', 'preparing', 'needs_input'].includes(job.preparation_state)) {
        this.error('ineligible', `Cannot cancel job in "${job.preparation_state}" state`);
      }
      const active = this.active().find(a => a.job_id === jobId);
      if (active) {
        this.putAttempt({ ...active, status: 'cancelled', finished_at: this.now(), cancelled_at: this.now() });
      }
      return this.preparation(job, 'cancel', reason);
    });
  }
  getControl(): C.WorkerControl { return this.decode(this.database.db.prepare('SELECT payload FROM worker_control WHERE workspace_id=?').get(this.database.workspaceId), C.WorkerControlSchema); }
  private putControl(control: C.WorkerControl): C.WorkerControl {
    const next = C.WorkerControlSchema.parse({ ...control, revision: control.revision + 1, updated_at: this.now() }); this.database.db.prepare('UPDATE worker_control SET revision=?,enabled=?,pause_after_current=?,stop_generation=?,stopped_at=?,updated_at=?,payload=? WHERE workspace_id=?').run(next.revision, Number(next.automatic_preparation_enabled), Number(next.pause_after_current), next.stop_generation, next.stopped_at, next.updated_at, JSON.stringify(next), next.workspace_id); return next;
  }
  startAutomaticPreparation(key: string) { return this.receipt('start', key, {}, () => this.putControl({ ...this.getControl(), automatic_preparation_enabled: true, pause_after_current: false, stopped_at: null })); }
  pauseAfterCurrent(key: string) { return this.receipt('pause', key, {}, () => this.putControl({ ...this.getControl(), pause_after_current: true })); }
  getAttempt(id: string): C.Attempt { return this.get('attempts', id, C.AttemptSchema); }
  private putAttempt(value: C.Attempt): void {
    const a = C.AttemptSchema.parse(value); this.database.db.prepare('UPDATE attempts SET status=?,lease_expires_at=?,payload=? WHERE id=?').run(a.status, a.lease_expires_at, JSON.stringify(a), a.id);
  }
  active(): C.Attempt[] { return this.database.db.prepare("SELECT payload FROM attempts WHERE status='active'").all().map(r => this.decode(r, C.AttemptSchema)); }
  private fenced(fence: OwnershipFence): C.Attempt {
    const attempt = this.getAttempt(fence.attempt_id); const control = this.getControl(); const job = this.getJob(attempt.job_id);
    if (attempt.status !== 'active' || job.current_attempt_id !== attempt.id || attempt.owner_token !== fence.owner_token || attempt.stop_generation !== fence.stop_generation || control.stop_generation !== fence.stop_generation || Date.parse(attempt.lease_expires_at) <= Date.parse(this.now())) this.error('invalid_ownership', 'Attempt is no longer owned/current'); return attempt;
  }
  isAttemptCurrent(fence: OwnershipFence): boolean { try { this.fenced(fence); return true; } catch (e) { if (e instanceof RepositoryError && (e.code === 'invalid_ownership' || e.code === 'not_found')) return false; throw e; } }
  recordAttemptProgress(fence: OwnershipFence, update: { stage?: C.PreparationStage; model_calls?: number; repair_attempts?: number; elapsed_ms?: number }): C.Attempt {
    return this.tx(() => {
      const a = this.fenced(fence); const policy = this.getExecutionInput(a.input_snapshot_id).policy;
      for (const n of [update.model_calls ?? 0, update.repair_attempts ?? 0, update.elapsed_ms ?? 0]) if (!Number.isSafeInteger(n) || n < 0) this.error('ineligible', 'Invalid usage counter');
      const usage = { model_calls: a.resource_usage.model_calls + (update.model_calls ?? 0), repair_attempts: a.resource_usage.repair_attempts + (update.repair_attempts ?? 0), elapsed_ms: Math.max(a.resource_usage.elapsed_ms, update.elapsed_ms ?? 0) };
      if (usage.model_calls > policy.max_model_calls || usage.repair_attempts > policy.max_repair_attempts) this.error('ineligible', 'Preparation resource budget exhausted');
      const next = { ...a, current_stage: update.stage ?? a.current_stage, resource_usage: usage }; this.putAttempt(next);
      if (update.stage) this.putJob({ ...this.getJob(a.job_id), preparation_stage: update.stage });
      return next;
    });
  }
  renewLease(fence: OwnershipFence, leaseMs: number): C.Attempt {
    return this.tx(() => { const a = this.fenced(fence); const next = { ...a, lease_expires_at: this.expiry(leaseMs) }; this.putAttempt(next); return next; });
  }
  private expiry(ms: number): string { if (!Number.isSafeInteger(ms) || ms <= 0) this.error('ineligible', 'Lease must be positive milliseconds'); return new Date(Date.parse(this.now()) + ms).toISOString(); }
  recoverExpiredAttempts(): string[] {
    return this.tx(() => {
      const ids: string[] = [];
      for (const a of this.active()) if (Date.parse(a.lease_expires_at) <= Date.parse(this.now())) {
        this.putAttempt({ ...a, status: 'interrupted', finished_at: this.now(), error: { code: 'lease_expired', message: 'Explicit retry required' } });
        this.preparation(this.getJob(a.job_id), 'interrupt', 'Lease expired; explicit retry required'); ids.push(a.id);
      }
      return ids;
    });
  }
  /** A replay is historical acknowledgement, never permission to launch another worker. */
  claimJob(request: { job_id: string; input_snapshot_id: string; mode: 'automatic' | 'manual'; stop_generation: number; lease_ms: number; idempotency_key: string }) {
    const { idempotency_key: key, ...data } = request;
    return this.receipt('claim', key, data, () => {
      if (request.mode !== 'manual' && request.mode !== 'automatic') this.error('ineligible', 'Invalid claim mode');
      const control = this.getControl(); if (request.stop_generation !== control.stop_generation) this.error('invalid_ownership', 'Stop generation changed');
      this.expiry(request.lease_ms); this.recoverExpiredAttempts();
      if (control.stopped_at !== null || control.pause_after_current || this.active().length) return null;
      const job = this.getJob(request.job_id); const input = this.getExecutionInput(request.input_snapshot_id); this.sameJob(input, job.id);
      if (job.archived_at || job.kind !== 'job' || job.preparation_state !== 'queued' || job.missing_inputs.length || (request.mode === 'automatic' && (!control.automatic_preparation_enabled || control.pause_after_current || ['submitted', 'outcome_recorded', 'unknown'].includes(job.application_lifecycle)))) return null;
      const attempt = C.AttemptSchema.parse({ schema_version: 1, id: this.uuid(), workspace_id: job.workspace_id, job_id: job.id, input_snapshot_id: input.id, status: 'active', owner_token: randomUUID(), lease_expires_at: this.expiry(request.lease_ms), stop_generation: control.stop_generation, current_stage: null, checkpoint_ids: [], started_at: this.now(), finished_at: null, cancelled_at: null, error: null, resource_usage: { model_calls: 0, repair_attempts: 0, elapsed_ms: 0 } });
      this.insert('attempts', attempt, { id: attempt.id, workspace_id: attempt.workspace_id, job_id: job.id, input_snapshot_id: input.id, status: attempt.status, owner_token: attempt.owner_token, lease_expires_at: attempt.lease_expires_at, stop_generation: attempt.stop_generation });
      this.preparation({ ...job, current_attempt_id: attempt.id }, 'claim', 'Preparation claimed'); return attempt;
    });
  }
  requestPreparation(request: { job_id: string; expected_revision: number; input_snapshot_id: string; action?: 'resume' | 'retry' | 'reprepare'; idempotency_key: string; lease_ms: number }, admission?: () => void) {
    const { idempotency_key, ...data } = request;
    return this.receipt('request_preparation', idempotency_key, data, () => {
      admission?.();
      let job = this.getJob(data.job_id); this.revision(job.revision, data.expected_revision);
      if (job.archived_at) this.error('ineligible', 'Restore this job from archive before preparing.');
      const input = this.getExecutionInput(data.input_snapshot_id);
      this.sameJob(input, job.id);
      if ((job.posting_snapshot_id && input.posting.id !== job.posting_snapshot_id) || (job.recovery?.kind === 'stale_inputs' && job.current_attempt_id && this.getAttempt(job.current_attempt_id).input_snapshot_id === input.id)) this.error('ineligible', 'Capture current inputs before preparing changed job context');
      const previous_attempt_id = job.current_attempt_id;
      const control = this.getControl();
      if (this.active().length) this.error('ineligible', 'Worker busy');
      if (job.missing_inputs.length) job = this.updateJob({ ...job, missing_inputs: [] }, job.revision);
      if (!data.action && job.preparation_state === 'saved') {
        if (control.stopped_at || control.pause_after_current) this.error('ineligible', 'Start prevented: processing is stopped or paused');
        job = this.preparation(job, 'prepare', 'Explicit preparation request');
      }
      if (data.action) job = this.preparation(job, data.action, 'Explicit preparation request');
      if (job.preparation_state !== 'queued') this.error('ineligible', 'Job is not queued');
      if (control.stopped_at || control.pause_after_current) return { attempt: null, previous_attempt_id };
      const claim = this.claimJob({ job_id: job.id, input_snapshot_id: data.input_snapshot_id, mode: 'manual', stop_generation: control.stop_generation, lease_ms: data.lease_ms, idempotency_key: `request:${idempotency_key}` });
      if (!claim.result || claim.replayed) this.error('ineligible', 'Worker busy or job ineligible');
      return { attempt: claim.result, previous_attempt_id };
    });
  }
  stopProcessing(key: string) {
    return this.receipt('stop', key, {}, () => {
      const control = this.getControl(); const next = this.putControl({ ...control, automatic_preparation_enabled: false, pause_after_current: false, stop_generation: control.stop_generation + 1, stopped_at: this.now() });
      const cancelled: string[] = [];
      for (const a of this.active()) { this.putAttempt({ ...a, status: 'cancelled', finished_at: this.now(), cancelled_at: this.now() }); this.preparation(this.getJob(a.job_id), 'cancel', 'Processing stopped'); cancelled.push(a.id); }
      return { control: next, cancelled_attempt_ids: cancelled };
    });
  }
  listCheckpoints(attemptId: string): C.Checkpoint[] { return this.database.db.prepare('SELECT payload FROM checkpoints WHERE attempt_id=? ORDER BY completed_at,id').all(attemptId).map(r => this.decode(r, C.CheckpointSchema)); }
  saveCheckpoint(value: C.Checkpoint, fence: OwnershipFence): C.Checkpoint {
    return this.tx(() => {
      const a = this.fenced(fence); const cp = C.CheckpointSchema.parse(value); this.sameJob(cp, a.job_id);
      if (cp.attempt_id !== a.id || cp.input_fingerprint !== this.getExecutionInput(a.input_snapshot_id).fingerprint) this.error('invalid_relationship', 'Checkpoint input mismatch');
      const row = this.database.db.prepare('SELECT payload FROM checkpoints WHERE attempt_id=? AND completed_stage=?').get(a.id, cp.completed_stage);
      if (row) { const old = this.decode(row, C.CheckpointSchema); if (old.input_fingerprint !== cp.input_fingerprint || old.output_fingerprint !== cp.output_fingerprint || stable(old.output_references) !== stable(cp.output_references)) this.error('idempotency_conflict', 'Stage already completed differently'); return old; }
      this.immutable('checkpoints', cp, C.CheckpointSchema, { attempt_id: cp.attempt_id, completed_stage: cp.completed_stage, completed_at: cp.completed_at }); this.putAttempt({ ...a, checkpoint_ids: [...a.checkpoint_ids, cp.id], current_stage: cp.completed_stage }); return cp;
    });
  }
  private verifyArtifact(a: C.ArtifactVersion): void {
    for (const ref of [a.source, a.pdf, a.preview, a.validation_report]) if (ref) { try { this.database.files.readArtifact(ref, a.job_id, a.id); } catch { this.error('corrupt_data', 'Artifact missing, unsafe or changed; recover original files'); } }
  }
assertManualPublication(request: { draft_id: string; expected_draft_revision: number;
  expected_job_revision: number; parent_artifact_id: string; parent_artifact_fingerprint: string }) {
  const draft = this.getLatestDraft(request.draft_id), job = this.getJob(draft.job_id);
  this.revision(draft.revision, request.expected_draft_revision);
  this.revision(job.revision, request.expected_job_revision);
  const parent = this.getArtifact(request.parent_artifact_id);
  this.sameJob(parent, job.id);
  if (parent.version_fingerprint !== request.parent_artifact_fingerprint || draft.parent_artifact_version_id !== parent.id
    || job.artifact_version_ids.at(-1) !== parent.id || draft.input_snapshot_id !== parent.input_snapshot_id)
    this.error('invalid_relationship', 'The draft or current resume changed. Reload before finalizing.');
  if (this.active().some(a => a.job_id === job.id) || job.recovery?.kind === 'stale_inputs')
    this.error('ineligible', 'Job preparation or changed inputs must be resolved first.');
  return { draft, job, parent };
}
publishManualArtifact(value: C.ArtifactVersion, request: Parameters<JobsRepository['assertManualPublication']>[0], idempotencyKey: string) {
  return this.tx(() => {
    const { draft, job, parent } = this.assertManualPublication(request);
    const artifact = C.ArtifactVersionSchema.parse(value);
    this.sameJob(artifact, job.id);
    if (artifact.origin !== 'manual' || artifact.attempt_id !== parent.attempt_id
      || artifact.parent_version_id !== parent.id || artifact.input_snapshot_id !== parent.input_snapshot_id
      || artifact.input_fingerprint !== parent.input_fingerprint || artifact.validation_result !== 'passed')
      this.error('invalid_relationship', 'Manual artifact binding mismatch');
    this.verifyArtifact(artifact);
    this.immutable('artifacts', artifact, C.ArtifactVersionSchema, { attempt_id: artifact.attempt_id,
      input_snapshot_id: artifact.input_snapshot_id, parent_version_id: artifact.parent_version_id });
    this.putJob({ ...job, artifact_version_ids: [...job.artifact_version_ids, artifact.id],
      preparation_state: 'resume_ready', state_reason: null, recovery: undefined });
    this.appendEvent({ schema_version: 1, id: this.uuid(), workspace_id: job.workspace_id, job_id: job.id,
      created_at: this.now(), actor: { kind: 'user', id: 'local-human' }, attempt_id: null,
      idempotency_key: `finalize:${idempotencyKey}`, payload: { kind: 'resume_finalized', artifact_version_id: artifact.id,
        parent_artifact_version_id: parent.id, draft_id: draft.id, draft_revision: draft.revision } });
    return artifact;
  });
}

  getArtifact(id: string): C.ArtifactVersion { const a = this.get('artifacts', id, C.ArtifactVersionSchema); this.verifyArtifact(a); return a; }
  publishArtifact(value: C.ArtifactVersion, fence: OwnershipFence, draft?: { id: string; revision: number }): C.ArtifactVersion {
    return this.tx(() => {
      const attempt = this.fenced(fence); const artifact = C.ArtifactVersionSchema.parse(value); this.sameJob(artifact, attempt.job_id);
      if (artifact.attempt_id !== attempt.id || artifact.input_snapshot_id !== attempt.input_snapshot_id || artifact.input_fingerprint !== this.getInputSnapshot(attempt.input_snapshot_id).fingerprint) this.error('invalid_relationship', 'Artifact input mismatch');
      if (artifact.parent_version_id) this.sameJob(this.getArtifact(artifact.parent_version_id), artifact.job_id);
      if (draft) { const current = this.getLatestDraft(draft.id); this.sameJob(current, artifact.job_id); this.revision(current.revision, draft.revision); if (current.input_snapshot_id !== artifact.input_snapshot_id) this.error('invalid_relationship', 'Draft input mismatch'); }
      this.verifyArtifact(artifact);
      this.immutable('artifacts', artifact, C.ArtifactVersionSchema, { attempt_id: artifact.attempt_id, input_snapshot_id: artifact.input_snapshot_id, parent_version_id: artifact.parent_version_id });
      const job = this.getJob(artifact.job_id); if (!job.artifact_version_ids.includes(artifact.id)) this.putJob({ ...job, artifact_version_ids: [...job.artifact_version_ids, artifact.id] }); return artifact;
    });
  }
}
