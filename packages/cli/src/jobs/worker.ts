import { randomUUID } from 'node:crypto';
import type { Attempt, Job, JobEvent } from '@featherduster/core';
import { JobsRepository } from './repository.js';
import { abortable, attemptFence, PreparationBlocked } from './preparation.js';

export interface WorkerDependencies {
  repository: JobsRepository;
  preparation: { run(attempt: Attempt, signal: AbortSignal, previousAttemptId?: string): Promise<void> };
  resolveInput(job: Job): string;
  onEvent?(event: JobEvent): void;
  leaseMs?: number;
  reconcileMs?: number;
  automaticDrain?: boolean;
}
/** One local drain; SQLite remains the authority across processes. No idle model polling. */
export class JobWorker {
  private disposed = false;
  private readonly emitted = new Set<string>();
  private pending = false;
  private draining: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private reconciliation?: ReturnType<typeof setInterval>;
  private readonly leaseMs: number;
  constructor(readonly deps: WorkerDependencies) { this.leaseMs = deps.leaseMs ?? 30000; }
  initialize(): void {
    if (this.disposed || this.reconciliation) return;
    this.reconciliation = setInterval(() => this.wake(), this.deps.reconcileMs ?? 5000);
    this.reconciliation.unref?.(); this.wake();
  }
  wake(): void {
    if (this.disposed) return;
    this.pending = true;
    if (!this.draining) {
      this.draining = Promise.resolve().then(() => this.drain()).finally(() => {
        this.draining = null;
        if (this.pending && !this.disposed) this.wake();
      });
      // Host can inspect persisted diagnostics; never leak a background rejection.
      void this.draining.catch(() => {});
    }
  }
  async whenIdle(): Promise<void> { while (this.draining) await this.draining; }
  abortActive(): void { this.controller?.abort(new Error('Processing stopped')); }
  notify(jobId: string, after: Set<string>): void {
    for (const event of this.deps.repository.listEvents(jobId)) if (!after.has(event.id) && !this.emitted.has(event.id)) {
      this.emitted.add(event.id);
      try { this.deps.onEvent?.(event); } catch { /* notifications never change execution */ }
    }
  }
  launch(attempt: Attempt, previousAttemptId?: string): void {
    if (this.disposed || this.draining) throw new Error('Worker busy or disposed');
    this.draining = Promise.resolve().then(() => this.execute(attempt, previousAttemptId)).finally(() => { this.draining = null; this.wake(); });
    void this.draining.catch(() => {});
  }
  get busy(): boolean { return !!this.draining; }
  private async drain(): Promise<void> {
    const r = this.deps.repository;
    do {
      this.pending = false;
      const recoveryEvents = new Map(r.active().map(a => [a.job_id, new Set(r.listEvents(a.job_id).map(e => e.id))]));
      r.recoverExpiredAttempts();
      for (const [jobId, events] of recoveryEvents) this.notify(jobId, events);
      while (!this.disposed && this.deps.automaticDrain !== false) {
        const control = r.getControl();
        if (!control.automatic_preparation_enabled || control.pause_after_current || control.stopped_at || r.active().length) break;
        const job = r.listJobs().find(j => !j.archived_at && j.kind === 'job' && j.preparation_state === 'queued' && !j.missing_inputs.length && !['submitted', 'outcome_recorded', 'unknown'].includes(j.application_lifecycle));
        if (!job) break;
        const prior = job.current_attempt_id ?? undefined;
        const events = new Set(r.listEvents(job.id).map(e => e.id));
        let input: string;
        try { input = prior ? r.getAttempt(prior).input_snapshot_id : this.deps.resolveInput(job); }
        catch (error) {
          // Invalid configuration must not create a hot claim loop. Persist an actionable input gate.
          const fresh = r.getJob(job.id);
          const reason = String(error).slice(0, 8192);
          r.transitionPreparation(fresh.id, 'block', fresh.revision, randomUUID(), undefined, {
            reason,
            missing_inputs: [{
              key: 'preparation_setup',
              question: 'Correct preparation inputs and explicitly prepare again.',
              scope: { kind: 'job', job_id: fresh.id },
              reason,
            }],
          });
          this.notify(fresh.id, events);
          continue;
        }
        const claim = r.claimJob({ job_id: job.id, input_snapshot_id: input, mode: 'automatic', stop_generation: control.stop_generation, lease_ms: this.leaseMs, idempotency_key: randomUUID() });
        if (claim.replayed || !claim.result) break;
        this.notify(job.id, events);
        await this.execute(claim.result, prior);
      }
    } while (this.pending && !this.disposed);
  }
  private async execute(attempt: Attempt, previousAttemptId?: string): Promise<void> {
    const r = this.deps.repository; const fence = attemptFence(attempt);
    if (!r.isAttemptCurrent(fence)) return;
    if (this.disposed) { r.transitionPreparation(attempt.job_id, 'interrupt', r.getJob(attempt.job_id).revision, randomUUID(), fence); return; }
    const controller = new AbortController(); this.controller = controller;
    const started = Date.now(); const policy = r.getExecutionInput(attempt.input_snapshot_id).policy;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(new Error('Preparation deadline exceeded')); }, policy.timeout_ms);
    const heartbeat = setInterval(() => {
      try { r.renewLease(fence, this.leaseMs); } catch { controller.abort(new Error('Ownership lost')); }
    }, Math.max(1, Math.floor(this.leaseMs / 3)));
    const events = new Set(r.listEvents(attempt.job_id).map(e => e.id));
    try {
      await abortable(this.deps.preparation.run(attempt, controller.signal, previousAttemptId), controller.signal);
      controller.signal.throwIfAborted();
      if (r.isAttemptCurrent(fence)) r.transitionPreparation(attempt.job_id, r.getExecutionInput(attempt.input_snapshot_id).schema_version === 3 ? 'material_complete' : r.getExecutionInput(attempt.input_snapshot_id).schema_version === 2 ? 'fit_complete' : 'complete', r.getJob(attempt.job_id).revision, randomUUID(), fence, { reason: r.getExecutionInput(attempt.input_snapshot_id).schema_version === 3 ? 'Material draft saved; inspect checks before review' : r.getExecutionInput(attempt.input_snapshot_id).schema_version === 2 ? 'Fit assessment saved; tailoring remains optional' : 'Validated candidate ready', elapsed_ms: Date.now() - started });
    } catch (error) {
      if (r.isAttemptCurrent(fence)) {
        const blocked = error instanceof PreparationBlocked;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 8192) || 'Preparation failed';
        r.transitionPreparation(attempt.job_id, this.disposed ? 'interrupt' : blocked ? 'block' : 'fail', r.getJob(attempt.job_id).revision, randomUUID(), fence, { reason: message, elapsed_ms: Date.now() - started, error: { code: timedOut ? 'timeout' : blocked ? 'blocked' : 'preparation_failed', message }, ...(blocked ? { recovery: error.recovery ?? { kind: 'setup' as const, subject: {}, action: 'configure' as const }, missing_inputs: [{ key: error.recovery?.kind ?? 'preparation_setup', question: 'Resolve the preparation blocker and explicitly resume.', scope: { kind: 'job' as const, job_id: attempt.job_id }, reason: message }] } : {}) });
      }
    } finally {
      clearTimeout(deadline); clearInterval(heartbeat); this.controller = null; this.notify(attempt.job_id, events);
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.pending = false; clearInterval(this.reconciliation); this.abortActive(); await this.whenIdle();
  }
}
