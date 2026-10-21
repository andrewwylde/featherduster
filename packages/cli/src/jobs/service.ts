import { JobWorker, type WorkerDependencies } from './worker.js';
import type { Attempt, Job } from '@featherduster/core';
import { ProposalRepository } from './proposal-repository.js';
import { RepositoryError } from './repository.js';

type Request = { job_id: string; expected_revision: number; input_snapshot_id: string; idempotency_key: string };
/** Host-facing lifecycle API. Intake/answer persistence never implicitly resumes work. */
export class JobsService {
  readonly worker: JobWorker;
  private disposed = false;
  constructor(private readonly deps: WorkerDependencies) { this.worker = new JobWorker(deps); }
  initialize(): void { this.worker.initialize(); }
  startAutomaticPreparation(key: string) {
    const receipt = this.deps.repository.startAutomaticPreparation(key);
    if (!receipt.replayed) this.worker.wake();
    return receipt;
  }
  stopProcessing(key: string) {
    const r = this.deps.repository;
    const before = new Map(r.active().map(a => [a.job_id, new Set(r.listEvents(a.job_id).map(e => e.id))]));
    const receipt = r.stopProcessing(key);
    if (!receipt.replayed) {
      this.worker.abortActive();
      for (const [job, events] of before) this.worker.notify(job, events);
    }
    return receipt;
  }
  pauseAfterCurrent(key: string) { return this.deps.repository.pauseAfterCurrent(key); }
  prepare(request: Request) { return this.request(request); }
  reprepare(request: Request) { return this.request(request, 'reprepare'); }
  resume(request: Request) { return this.request(request, 'resume'); }
  retry(request: Request) { return this.request(request, 'retry'); }
  cancelJob(jobId: string, expectedRevision: number, key: string, reason?: string) {
    if (this.disposed) throw new Error('Service disposed');
    const r = this.deps.repository;
    const events = new Set(r.listEvents(jobId).map(e => e.id));
    const activeBefore = r.active().some(a => a.job_id === jobId);
    const receipt = r.cancelJob(jobId, expectedRevision, key, reason);
    if (!receipt.replayed) {
      if (activeBefore) {
        this.worker.abortActive();
      }
      this.worker.notify(jobId, events);
    }
    return receipt;
  }
  admitReview(request: { job_id: string; expected_job_revision: number; idempotency_key: string }, check: () => { job: Job; input_snapshot_id: string; previous_attempt_id?: string; bind(attempt: Attempt): unknown }) {
    if (this.disposed) throw new Error('Service disposed');
    const r = this.deps.repository;
    const events = new Set(r.listEvents(request.job_id).map(e => e.id));
    let previousAttemptId: string | undefined;
    const receipt = r.withReceipt('proposal_admission', request.idempotency_key, request, () => {
      const control = r.getControl();
      if (control.stopped_at || control.pause_after_current) throw new RepositoryError('ineligible', 'Start prevented: processing is stopped or paused; explicitly Start first');
      if (this.worker.busy || r.active().length) throw new RepositoryError('ineligible', 'Start prevented: worker busy');
      const selected = check();
      previousAttemptId = selected.previous_attempt_id;
      const action = selected.job.preparation_state === 'needs_input' ? 'resume' : selected.job.preparation_state === 'resume_ready' ? 'reprepare' : 'retry';
      const result = r.requestPreparation({ job_id: request.job_id, expected_revision: request.expected_job_revision, input_snapshot_id: selected.input_snapshot_id, action, idempotency_key: `review:${request.idempotency_key}`, lease_ms: this.deps.leaseMs ?? 30000 }).result;
      if (!result.attempt) throw new RepositoryError('ineligible', 'Start prevented');
      selected.bind(result.attempt);
      return { ...result, admission: 'started' as const };
    });
    if (!receipt.replayed) {
      this.worker.notify(request.job_id, events);
      this.worker.launch(receipt.result.attempt, previousAttemptId ?? receipt.result.previous_attempt_id ?? undefined);
    }
    return receipt;
  }
  private request(request: Request, action?: 'resume' | 'retry' | 'reprepare') {
    if (this.disposed) throw new Error('Service disposed');
    const r = this.deps.repository;
    const events = new Set(r.listEvents(request.job_id).map(e => e.id));
    const receipt = r.database.db.transaction(() => {
      let result: ReturnType<typeof r.requestPreparation>;
      try { result = r.requestPreparation({ ...request, action, lease_ms: this.deps.leaseMs ?? 30000 }, () => {
        const review = new ProposalRepository(r).getActive(request.job_id);
        if (review && review.input_snapshot_id === request.input_snapshot_id) throw new RepositoryError('ineligible', 'Use exact proposal review continuation; generic preparation cannot replace saved output');
      }); }
      catch (error) {
        if (error instanceof Error && /^Invalid preparation action "/.test(error.message)) throw new RepositoryError('ineligible', error.message);
        throw error;
      }
      if (!result.replayed && result.result.attempt && this.worker.busy) throw new RepositoryError('ineligible', 'Worker busy');
      return result;
    }).immediate();
    if (!receipt.replayed) {
      this.worker.notify(request.job_id, events);
      if (receipt.result.attempt) this.worker.launch(receipt.result.attempt, receipt.result.previous_attempt_id ?? undefined);
    }
    return receipt;
  }
  durableEnqueue(): void { this.worker.wake(); }
  status() { const jobs = this.deps.repository.listJobs().filter(j => !j.archived_at && !['submitted', 'outcome_recorded', 'unknown'].includes(j.application_lifecycle)); return { control: this.deps.repository.getControl(), active: this.deps.repository.active(), queued_count: jobs.filter(j => j.preparation_state === 'queued').length, needs_review_count: jobs.filter(j => j.preparation_state === 'needs_input' && ['proposals', 'candidate', 'render'].includes(j.recovery?.kind ?? '')).length }; }
  dispose(): Promise<void> { this.disposed = true; return this.worker.dispose(); }
}
