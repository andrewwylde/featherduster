import type * as C from '@featherduster/core';
import { PreparationBatchRepository, type BatchMember } from './preparation-batch-repository.js';
import { ProposalRepository } from './proposal-repository.js';
import { JobsRepository, RepositoryError } from './repository.js';
import type { JobsService } from './service.js';
import type { ProposalService } from './proposal-service.js';
import type { JobDraftFinalization } from './draft-finalization.js';
import type { SemanticService } from './semantic-service.js';

/** Durable selection opt-in. Reads are observational; only the host's scheduler dispatches. */
export class PreparationCoordinator {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private disposed = false;
  constructor(readonly store: PreparationBatchRepository, private service: JobsService,
    private proposals: ProposalService, private drafts: JobDraftFinalization, private semantic: SemanticService, private onChange?: () => void) {}
  initialize() {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.wake(), 250); this.timer.unref?.(); this.wake();
  }
  wake() {
    if (this.disposed || this.running) return;
    this.running = this.tick().catch(error => console.error('Preparation scheduler failed', error)).finally(() => { this.running = null; if (!this.disposed) this.onChange?.(); });
  }
  async whenIdle() { await this.running; await this.service.worker.whenIdle(); }
  private get r(): JobsRepository { return this.store.jobs; }
  private async tick() {
    const control = this.r.getControl();
    if (control.stopped_at || control.pause_after_current) return;
    for (const member of this.store.members()) {
      if (member.state !== 'running') continue;
      const job = this.r.getJob(member.job_id);
      if (job.preparation_state === 'preparing') continue;
      if (job.preparation_state === 'interrupted' && member.attempt_id && this.r.getAttempt(member.attempt_id).stop_generation === control.stop_generation) {
        try {
          this.store.reserve(member, `worker-retry:${member.attempt_id}`, 'retry');
          this.store.save({ ...member, state: 'pending', diagnostic: 'Resuming interrupted preparation from saved checkpoints.' });
          continue;
        } catch { /* Exhausted or expired cycles remain technical; never reset their counters. */ }
      }
      let factual = false;
      if (job.preparation_state === 'needs_input' && ['proposals', 'candidate'].includes(job.recovery?.kind ?? '')) {
        try { const facts = this.semantic.read(job.id); const review = this.proposals.read(job.id);
          factual = (review.availability === 'available' && review.review.validation.issues.some(i => i.details.some(d => d.kind === 'material_decision')))
            || (facts.execution !== 'unavailable' && facts.facts.some(f => !f.resolution && ['needs_clarification', 'contradicted'].includes(f.state))); } catch { /* no factual inventory */ }
      }
      this.store.save({ ...member, state: job.preparation_state === 'resume_ready' ? 'ready' : factual ? 'question' : 'technical', questions_visible: factual, diagnostic: job.state_reason ?? undefined });
    }
    if (this.service.worker.busy || this.r.active().length) return;
    const member = this.store.members().find(m => m.state === 'pending');
    if (!member) return;
    try {
      if (member.draft_id) { await this.refreshDraft(member); return; }
      const job = this.r.getJob(member.job_id);
      if (job.preparation_state === 'resume_ready' && job.artifact_version_ids.at(-1)
        && this.r.getArtifact(job.artifact_version_ids.at(-1)!).input_snapshot_id === member.input_snapshot_id) {
        this.store.save({ ...member, state: 'ready' }); return;
      }
      const latest = this.r.database.db.prepare("SELECT id FROM input_snapshots WHERE job_id=? AND json_extract(payload,'$.schema_version')=1 ORDER BY rowid DESC LIMIT 1").get(job.id) as { id: string } | undefined;
      if (latest?.id !== member.input_snapshot_id) throw new RepositoryError('revision_conflict', 'Starting inputs changed. Review current inputs before retrying.');
      const reviews = new ProposalRepository(this.r), active = reviews.getActive(job.id);
      const args = { job_id: job.id, expected_revision: job.revision, input_snapshot_id: member.input_snapshot_id, idempotency_key: `batch:${member.cycle_id}:${active?.revision ?? 'initial'}:${job.current_attempt_id ?? 'new'}` };
      let attempt: C.Attempt | null | undefined;
      if (active && active.input_snapshot_id === member.input_snapshot_id) {
        const facts = this.semantic.read(job.id);
        if (facts.execution === 'unavailable' || facts.execution === 'unchecked') {
          this.semantic.start(job.id, { target: facts.target, expected_job_revision: facts.job_revision, expected_semantic_revision: facts.semantic_revision,
            input_fingerprint: facts.input_fingerprint, reason: 'retry', idempotency_key: `batch-resolve:${member.cycle_id}:${active.revision}` }, member.cycle_id);
          await this.semantic.wait(job.id);
        }
        if (this.store.enrolled(job.id)?.cycle_id !== member.cycle_id || this.r.getControl().stop_generation !== control.stop_generation || this.r.getControl().stopped_at) return;
        const fresh = this.proposals.refreshFacts(active);
        if (fresh.validation.status !== 'ready') {
          const failed = this.semantic.read(job.id).execution === 'unavailable';
          this.store.save({ ...member, state: failed ? 'technical' : 'question', questions_visible: !failed, diagnostic: failed ? 'Evidence checks remain unavailable. Retry checks or review current inputs.' : undefined }); return;
        }
        attempt = this.proposals.continue({ job_id: job.id, review_id: fresh.id, expected_job_revision: this.r.getJob(job.id).revision,
          expected_review_revision: fresh.revision, input_fingerprint: fresh.input_fingerprint, validation_fingerprint: fresh.validation.fingerprint, idempotency_key: args.idempotency_key }).result.attempt;
      } else {
        const action = job.preparation_state === 'resume_ready' ? 'reprepare' : job.preparation_state === 'needs_input' ? 'resume'
          : ['failed', 'cancelled', 'interrupted'].includes(job.preparation_state) ? 'retry' : 'prepare';
        attempt = this.service[action](args).result.attempt;
      }
      this.store.save({ ...member, state: 'running', attempt_id: attempt?.id });
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof RepositoryError && error.code === 'ineligible' && /worker busy/i.test(error.message)) return;
      const current = this.store.enrolled(member.job_id);
      if (current?.cycle_id === member.cycle_id && current.state === 'pending')
        this.store.save({ ...member, state: 'technical', diagnostic: error instanceof Error ? error.message : String(error) });
    }
  }
  answered(jobId: string) {
    const member = this.store.enrolled(jobId);
    if (!member || !['question', 'later'].includes(member.state)) return;
    this.store.save({ ...member, state: 'pending' }); this.wake();
  }
  defer(jobId: string) {
    const member = this.store.enrolled(jobId);
    if (member && member.state === 'question') this.store.save({ ...member, state: 'later' });
  }
  retry(jobId: string, expectedRevision: number, key: string) {
    const result = this.r.withReceipt('batch_retry', key, { jobId, expectedRevision }, () => {
      const member = this.store.enrolled(jobId), job = this.r.getJob(jobId);
      if (!member || job.revision !== expectedRevision || ['running', 'pending'].includes(member.state)) throw new RepositoryError('revision_conflict', 'Reload the job before retrying.');
      const cycle = this.store.newCycle(jobId, member.input_snapshot_id);
      this.store.save({ ...member, state: 'pending', cycle_id: cycle.id, diagnostic: undefined });
      return { cycle_id: cycle.id };
    });
    this.wake(); return result;
  }
  edited(jobId: string, draft: C.JobDraft) {
    const member = this.store.enrolled(jobId);
    if (!member) return;
    const cycle = this.store.newCycle(jobId, draft.input_snapshot_id);
    this.store.save({ ...member, input_snapshot_id: draft.input_snapshot_id, cycle_id: cycle.id, draft_id: draft.id, draft_revision: draft.revision, state: 'pending', questions_visible: false });
    this.wake();
  }
  private async refreshDraft(member: BatchMember) {
    const stopGeneration = this.r.getControl().stop_generation;
    const guard = () => {
      const control = this.r.getControl();
      if (this.disposed || control.stopped_at || control.stop_generation !== stopGeneration || this.store.enrolled(member.job_id)?.cycle_id !== member.cycle_id)
        throw new RepositoryError('invalid_ownership', 'Automatic draft refresh was stopped or superseded. Saved edits are retained.');
    };
    guard();
    const draft = this.r.getLatestDraft(member.draft_id!);
    if (draft.revision !== member.draft_revision) return;
    const job = this.r.getJob(member.job_id), latestId = job.artifact_version_ids.at(-1);
    if (latestId) {
      const artifact = this.r.getArtifact(latestId);
      const manifest = JSON.parse(this.r.database.files.readArtifact({ id: `${this.r.database.files.bundlePath('artifacts', job.id, latestId)}/manifest.json`, fingerprint: artifact.version_fingerprint }, job.id, latestId).toString());
      if (manifest.draft_id === draft.id && manifest.draft_revision === draft.revision) {
        this.store.save({ ...member, state: 'ready', draft_id: undefined, draft_revision: undefined }); return;
      }
    }
    const target: C.SemanticTarget = { kind: 'draft', draft_id: draft.id, candidate: draft.candidate };
    const facts = this.semantic.read(member.job_id, target);
    this.semantic.start(member.job_id, { target, expected_job_revision: facts.job_revision, expected_semantic_revision: facts.semantic_revision,
      input_fingerprint: facts.input_fingerprint, reason: 'edit', idempotency_key: `batch-edit:${member.cycle_id}:${facts.semantic_revision}` });
    await this.semantic.wait(member.job_id); guard();
    const checked = await this.drafts.check(member.job_id, draft.id, draft.candidate);
    if (this.store.enrolled(member.job_id)?.cycle_id !== member.cycle_id) return;
    if (checked.status !== 'ready') { this.store.save({ ...member, state: checked.status === 'unavailable' ? 'technical' : 'question', questions_visible: checked.status !== 'unavailable', diagnostic: checked.issues.map(i => i.message).join('; ') }); return; }
    await this.drafts.finalize(member.job_id, draft.id, { expected_job_revision: checked.job_revision, expected_draft_revision: draft.revision,
      binding: checked.binding, idempotency_key: `batch-finalize:${member.cycle_id}` }, guard);
    this.store.save({ ...member, state: 'ready', draft_id: undefined, draft_revision: undefined });
  }
  async dispose() { this.disposed = true; clearInterval(this.timer); await this.running; }
}
