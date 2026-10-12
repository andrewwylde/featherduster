import { JobWorker, type WorkerDependencies } from './worker.js';
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
  private request(request: Request, action?: 'resume' | 'retry' | 'reprepare') {
    if (this.disposed) throw new Error('Service disposed');
    const r = this.deps.repository;
    const events = new Set(r.listEvents(request.job_id).map(e => e.id));
    const receipt = r.database.db.transaction(() => {
      let result: ReturnType<typeof r.requestPreparation>;
      try { result = r.requestPreparation({ ...request, action, lease_ms: this.deps.leaseMs ?? 30000 }); }
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
  status() { return { control: this.deps.repository.getControl(), active: this.deps.repository.active() }; }
  dispose(): Promise<void> { this.disposed = true; return this.worker.dispose(); }
}
