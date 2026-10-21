import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { JobsRepository, RepositoryError } from './repository.js';

export interface BatchMember {
  batch_id: string; job_id: string; position: number; input_snapshot_id: string; input_fingerprint: string;
  cycle_id: string; state: 'pending' | 'running' | 'question' | 'technical' | 'ready' | 'later';
  attempt_id?: string; diagnostic?: string; draft_id?: string; draft_revision?: number; questions_visible?: boolean;
}
export interface PreparationCycle { id: string; job_id: string; input_snapshot_id: string; started_at: number; usage: C.AutomaticUsage }
export class PreparationBatchRepository {
  constructor(readonly jobs: JobsRepository) {}
  get(id: string): C.PreparationBatch {
    const row = this.jobs.database.db.prepare('SELECT payload FROM preparation_batches WHERE id=? AND workspace_id=?').get(id, this.jobs.database.workspaceId) as { payload: string } | undefined;
    if (!row) throw new RepositoryError('not_found', 'Preparation batch not found');
    return C.PreparationBatchSchema.parse(JSON.parse(row.payload));
  }
  members(id?: string): BatchMember[] {
    const rows = (id ? this.jobs.database.db.prepare('SELECT payload FROM preparation_members WHERE batch_id=? ORDER BY position').all(id)
      : this.jobs.database.db.prepare('SELECT payload FROM preparation_members ORDER BY rowid').all()) as { payload: string }[];
    return rows.map(row => JSON.parse(row.payload));
  }
  enrolled(jobId: string) { return this.members().reverse().find(m => m.job_id === jobId); }
  save(member: BatchMember) {
    this.jobs.database.db.prepare('UPDATE preparation_members SET state=?,payload=? WHERE batch_id=? AND job_id=?').run(member.state, JSON.stringify(member), member.batch_id, member.job_id);
  }
  cycle(id: string): PreparationCycle {
    const row = this.jobs.database.db.prepare('SELECT payload FROM preparation_cycles WHERE id=?').get(id) as { payload: string } | undefined;
    if (!row) throw new RepositoryError('not_found', 'Preparation cycle not found');
    return JSON.parse(row.payload);
  }
  newCycle(jobId: string, inputId: string) {
    const cycle: PreparationCycle = { id: randomUUID(), job_id: jobId, input_snapshot_id: inputId, started_at: Date.now(), usage: { calls: 0, repairs: 0, retries: 0, elapsed_ms: 0 } };
    this.jobs.database.db.prepare('INSERT INTO preparation_cycles VALUES (?,?,?,?)').run(cycle.id, jobId, inputId, JSON.stringify(cycle));
    return cycle;
  }
  reserve(member: BatchMember, key: string, kind: 'model' | 'repair' | 'retry') {
    return this.jobs.database.db.transaction(() => {
      const cycle = this.cycle(member.cycle_id), policy = this.jobs.getInputSnapshot(member.input_snapshot_id).policy;
      // A dispatch receipt cannot be used as permission to dispatch the same work again after a crash.
      if (this.jobs.database.db.prepare('SELECT 1 FROM preparation_operations WHERE cycle_id=? AND operation_key=?').get(cycle.id, key))
        throw new RepositoryError('ineligible', 'Operation already dispatched; recover its saved result or explicitly retry.');
      cycle.usage.elapsed_ms = Date.now() - cycle.started_at;
      cycle.usage = C.reserveAutomaticOperation(policy, cycle.usage, kind);
      this.jobs.database.db.prepare('UPDATE preparation_cycles SET payload=? WHERE id=?').run(JSON.stringify(cycle), cycle.id);
      this.jobs.database.db.prepare('INSERT INTO preparation_operations VALUES (?,?,?,?)').run(randomUUID(), cycle.id, key, JSON.stringify({ kind, reserved_at: new Date().toISOString(), usage: cycle.usage }));
      return cycle;
    }).immediate();
  }
  create(raw: unknown, capture: (jobId: string, revision: number) => C.InputSnapshot) {
    const request = C.CreatePreparationBatchSchema.parse(raw);
    return this.jobs.withReceipt('preparation_batch', request.idempotency_key, request, () => {
      const control = this.jobs.getControl();
      if (control.stopped_at || control.pause_after_current) throw new RepositoryError('ineligible', 'Processing is stopped or paused. Explicitly Start before preparing.');
      const batch: C.PreparationBatch = { id: randomUUID(), workspace_id: this.jobs.database.workspaceId, created_at: new Date().toISOString(), members: [] };
      const members = request.members.map((selection, position) => {
        const job = this.jobs.getJob(selection.job_id);
        if (job.revision !== selection.expected_revision) throw new RepositoryError('revision_conflict', 'Selected job changed; reload before preparing.');
        if (job.archived_at || job.kind !== 'job' || ['queued', 'preparing'].includes(job.preparation_state) || ['submitted', 'outcome_recorded', 'unknown'].includes(job.application_lifecycle)
          || this.members().some(m => m.job_id === job.id && ['pending', 'running'].includes(m.state))) throw new RepositoryError('ineligible', 'Selected job is not available for preparation.');
        const input = capture(job.id, job.revision), cycle = this.newCycle(job.id, input.id);
        batch.members.push({ job_id: job.id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, position });
        return { batch_id: batch.id, job_id: job.id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, cycle_id: cycle.id, position, state: 'pending' as const };
      });
      this.jobs.database.db.prepare('INSERT INTO preparation_batches VALUES (?,?,?)').run(batch.id, batch.workspace_id, JSON.stringify(batch));
      for (const member of members) this.jobs.database.db.prepare('INSERT INTO preparation_members VALUES (?,?,?,?,?,?)').run(batch.id, member.job_id, member.position, member.input_snapshot_id, member.state, JSON.stringify(member));
      return batch;
    });
  }
}
