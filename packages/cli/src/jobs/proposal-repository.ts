import * as C from '@featherduster/core';
import { fingerprint } from './files.js';
import { JobArtifactsService } from './artifacts.js';
import { JobsRepository, RepositoryError, type OwnershipFence } from './repository.js';

const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export class ProposalRepository {
  constructor(readonly jobs: JobsRepository) {}
  private tx<T>(fn: () => T): T { return this.jobs.database.db.transaction(fn).immediate(); }
  private fail(code: ConstructorParameters<typeof RepositoryError>[0], message: string): never { throw new RepositoryError(code, message); }
  private lineage(value: { workspace_id: string; job_id: string; input_snapshot_id: string; input_fingerprint: string }) {
    const job = this.jobs.getJob(value.job_id);
    const input = new JobArtifactsService(this.jobs).getInputSnapshot(value.input_snapshot_id);
    if (value.workspace_id !== job.workspace_id || input.job_id !== job.id || input.fingerprint !== value.input_fingerprint) this.fail('invalid_relationship', 'Proposal input/workspace mismatch');
  }
  private decode<T>(row: unknown, schema: { parse(v: unknown): T }): T {
    if (!row) return this.fail('not_found', 'Proposal record not found');
    try { return schema.parse(JSON.parse((row as { payload: string }).payload)); }
    catch { return this.fail('corrupt_data', 'Invalid stored proposal record'); }
  }
  private verifyFiles(g: C.ProposalGeneration) {
    try {
      const files = this.jobs.database.files;
      const bytes = canonical(g);
      files.readArtifact({ id: `${files.bundlePath('artifacts', g.job_id, g.id)}/generation.json`, fingerprint: fingerprint(bytes) }, g.job_id, g.id);
      return files.readArtifact(g.raw_output, g.job_id, g.id).toString();
    } catch { return this.fail('corrupt_data', 'Generation output is missing or changed; restore the original bundle'); }
  }
  /** Caller supplies a stable generation ID across publication retries. */
  saveGeneration(value: C.ProposalGeneration, fence: OwnershipFence, rawOutput: string): C.ProposalGeneration {
    return this.tx(() => {
      const g = C.ProposalGenerationSchema.parse(value);
      this.lineage(g);
      const attempt = this.jobs.getAttempt(g.attempt_id);
      if (fence.attempt_id !== attempt.id || !this.jobs.isAttemptCurrent(fence)) this.fail('invalid_ownership', 'Generation owner is no longer current');
      if (attempt.job_id !== g.job_id || attempt.input_snapshot_id !== g.input_snapshot_id) this.fail('invalid_relationship', 'Generation attempt mismatch');
      const files = this.jobs.database.files;
      const parent = files.bundlePath('artifacts', g.job_id, g.id);
      if (g.raw_output.id !== `${parent}/raw-output.json` || g.raw_output.fingerprint !== fingerprint(rawOutput)) this.fail('invalid_relationship', 'Raw output binding mismatch');
      let normalized: C.Proposal[];
      try { normalized = C.normalizeGenerationProposals(JSON.parse(rawOutput).proposals); }
      catch { return this.fail('invalid_relationship', 'Raw proposals are malformed'); }
      if (canonical(normalized) !== canonical(g.proposals.proposals)) this.fail('invalid_relationship', 'Normalized generation differs from raw output');
      const row = this.jobs.database.db.prepare('SELECT payload FROM proposal_generations WHERE id=?').get(g.id);
      if (row) {
        const old = this.getGeneration(g.id);
        if (canonical(old) !== canonical(g)) this.fail('idempotency_conflict', 'Generation ID already used');
        return old;
      }
      try { files.writeBundle('artifacts', g.job_id, g.id, { 'raw-output.json': rawOutput, 'generation.json': canonical(g) }); }
      catch (error) {
        // Only a complete identical orphan can be reused. No overwrite or partial repair.
        this.verifyFiles(g);
      }
      this.verifyFiles(g);
      this.jobs.database.db.prepare('INSERT INTO proposal_generations VALUES (?,?,?,?,?,?)').run(g.id, g.workspace_id, g.job_id, g.attempt_id, g.input_snapshot_id, JSON.stringify(g));
      return g;
    });
  }
  getGeneration(id: string): C.ProposalGeneration {
    const g = this.decode(this.jobs.database.db.prepare('SELECT payload FROM proposal_generations WHERE id=?').get(id), C.ProposalGenerationSchema);
    if (g.id !== id) this.fail('corrupt_data', 'Stored generation identity mismatch');
    this.lineage(g);
    const attempt = this.jobs.getAttempt(g.attempt_id);
    if (attempt.job_id !== g.job_id || attempt.input_snapshot_id !== g.input_snapshot_id) this.fail('corrupt_data', 'Stored generation lineage mismatch');
    this.verifyFiles(g);
    return g;
  }
  getRevision(id: string, revision: number): C.ProposalReviewRevision {
    const r = this.decode(this.jobs.database.db.prepare('SELECT payload FROM proposal_review_revisions WHERE id=? AND revision=?').get(id, revision), C.ProposalReviewRevisionSchema);
    const g = this.getGeneration(r.generation_id);
    if (r.id !== id || r.revision !== revision || r.job_id !== g.job_id || r.workspace_id !== g.workspace_id || r.input_snapshot_id !== g.input_snapshot_id || r.input_fingerprint !== g.input_fingerprint) this.fail('corrupt_data', 'Stored review lineage mismatch');
    C.applyProposalPatches(g.proposals.proposals, [], r.patches);
    return r;
  }
  getActive(jobId: string): C.ProposalReviewRevision | null {
    this.jobs.getJob(jobId);
    const row = this.jobs.database.db.prepare('SELECT review_id,revision FROM job_proposal_reviews WHERE job_id=?').get(jobId) as { review_id: string; revision: number } | undefined;
    if (!row) return null;
    const review = this.getRevision(row.review_id, row.revision);
    if (review.job_id !== jobId) this.fail('corrupt_data', 'Active pointer belongs to another job');
    return review;
  }
  appendReview(value: C.ProposalReviewRevision, expectedRevision: number | null, fence?: OwnershipFence, expectedActive?: { id: string; revision: number }): C.ProposalReviewRevision {
    return this.tx(() => {
      const r = C.ProposalReviewRevisionSchema.parse(value);
      this.lineage(r);
      const g = this.getGeneration(r.generation_id);
      if (g.job_id !== r.job_id || g.workspace_id !== r.workspace_id || g.input_snapshot_id !== r.input_snapshot_id || g.input_fingerprint !== r.input_fingerprint) this.fail('invalid_relationship', 'Review generation mismatch');
      if (fence && !this.jobs.isAttemptCurrent(fence)) this.fail('invalid_ownership', 'Review owner is no longer current');
      if (expectedRevision === null) {
        const active = this.getActive(r.job_id);
        if (active && (active.id !== expectedActive?.id || active.revision !== expectedActive.revision)) this.fail('revision_conflict', 'Explicit current review selection required to activate a new version');
      }
      const activeAttempt = this.jobs.database.db.prepare("SELECT id FROM attempts WHERE job_id=? AND status='active'").get(r.job_id) as { id: string } | undefined;
      if (activeAttempt && (!fence || fence.attempt_id !== activeAttempt.id || g.attempt_id !== fence.attempt_id || !this.jobs.isAttemptCurrent(fence))) this.fail('invalid_ownership', 'Cannot edit during active execution');
      if (activeAttempt && expectedRevision !== null && this.jobs.database.db.prepare('SELECT 1 FROM attempt_proposal_reviews WHERE attempt_id=?').get(activeAttempt.id))
        this.fail('invalid_ownership', 'Cannot edit a bound review during active execution');
      const latest = this.jobs.database.db.prepare('SELECT MAX(revision) AS revision FROM proposal_review_revisions WHERE id=?').get(r.id) as { revision: number | null };
      if (latest.revision !== expectedRevision || r.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)) this.fail('revision_conflict', 'Stale review revision');
      if (expectedRevision !== null) {
        const old = this.getRevision(r.id, expectedRevision);
        const active = this.getActive(r.job_id);
        if (!active || active.id !== old.id || active.revision !== old.revision) this.fail('revision_conflict', 'Review is no longer active');
        if (old.generation_id !== r.generation_id || old.input_snapshot_id !== r.input_snapshot_id) this.fail('invalid_relationship', 'Review lineage cannot change');
      }
      C.applyProposalPatches(g.proposals.proposals, [], r.patches);
      for (const id of r.feedback_ids) {
        const row = this.jobs.database.db.prepare('SELECT payload FROM corpus_feedback WHERE id=?').get(id);
        const feedback = this.decode(row, C.FeedbackEventSchema);
        if (feedback.workspace_id !== r.workspace_id || feedback.job_id !== r.job_id) this.fail('invalid_relationship', 'Foreign review feedback');
      }
      for (const id of r.corpus_update_ids) {
        const row = this.jobs.database.db.prepare('SELECT payload FROM corpus_updates WHERE id=?').get(id);
        const update = this.decode(row, C.CorpusUpdateSchema);
        if (update.workspace_id !== r.workspace_id) this.fail('invalid_relationship', 'Foreign corpus update');
      }
      this.jobs.database.db.prepare('INSERT INTO proposal_review_revisions VALUES (?,?,?,?,?,?)').run(r.id, r.revision, r.generation_id, r.job_id, r.input_snapshot_id, JSON.stringify(r));
      this.jobs.database.db.prepare('INSERT INTO job_proposal_reviews VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET review_id=excluded.review_id,revision=excluded.revision').run(r.job_id, r.id, r.revision);
      return r;
    });
  }
  bindAttempt(attemptId: string, reviewId: string, revision: number, validationFingerprint: string, fence: OwnershipFence) {
    return this.tx(() => {
      const review = this.getRevision(reviewId, revision);
      const attempt = this.jobs.getAttempt(attemptId);
      if (fence.attempt_id !== attemptId || !this.jobs.isAttemptCurrent(fence)) this.fail('invalid_ownership', 'Attempt is no longer current');
      if (attempt.job_id !== review.job_id || attempt.input_snapshot_id !== review.input_snapshot_id || review.validation.fingerprint !== validationFingerprint || review.validation.status !== 'ready') this.fail('invalid_relationship', 'Attempt requires exact ready review');
      const old = this.getAttemptReview(attemptId);
      if (old) {
        if (old.id !== reviewId || old.revision !== revision || old.validation.fingerprint !== validationFingerprint) this.fail('idempotency_conflict', 'Attempt selection is immutable');
        return old;
      }
      const active = this.getActive(review.job_id);
      if (active?.id !== reviewId || active.revision !== revision) this.fail('revision_conflict', 'Review is no longer active');
      this.jobs.database.db.prepare('INSERT INTO attempt_proposal_reviews VALUES (?,?,?,?)').run(attemptId, reviewId, revision, validationFingerprint);
      return review;
    });
  }
  getAttemptReview(attemptId: string): C.ProposalReviewRevision | null {
    const attempt = this.jobs.getAttempt(attemptId);
    const row = this.jobs.database.db.prepare('SELECT review_id,revision,validation_fingerprint FROM attempt_proposal_reviews WHERE attempt_id=?').get(attemptId) as { review_id: string; revision: number; validation_fingerprint: string } | undefined;
    if (!row) return null;
    const review = this.getRevision(row.review_id, row.revision);
    if (review.job_id !== attempt.job_id || review.input_snapshot_id !== attempt.input_snapshot_id || review.validation.fingerprint !== row.validation_fingerprint) this.fail('corrupt_data', 'Attempt selection binding mismatch');
    return review;
  }
}
