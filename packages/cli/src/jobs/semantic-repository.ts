import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { JobsRepository, RepositoryError } from './repository.js';
import { canonicalResumeValue as canonical } from './resume-context.js';
import { fingerprint } from './files.js';
export interface SemanticStart { job_id: string; input_snapshot_id: string; expected_job_revision: number;
  expected_semantic_revision: number; cycle_id: string; target_fingerprint: string; idempotency_key: string; automatic: boolean }
export interface SemanticOperation extends SemanticStart { id: string; sequence: number; stop_generation: number;
  state: 'checking' | 'complete' | 'unavailable'; reason?: string }
export interface SemanticCall { id: string; job_id: string; operation_id: string; owner_token: string; started_at: string }
export class SemanticRepository {
  constructor(readonly jobs: JobsRepository) {}
  private get db() { return this.jobs.database.db; }
  private tx<T>(fn: () => T) { return this.db.transaction(fn).immediate(); }
  private fail(message: string, code: RepositoryError['code'] = 'revision_conflict'): never { throw new RepositoryError(code, message); }
  head(jobId: string): number { this.jobs.getJob(jobId); return (this.db.prepare('SELECT revision FROM semantic_heads WHERE job_id=?').get(jobId) as { revision: number } | undefined)?.revision ?? 0; }
  private lineage(jobId: string, inputId: string) {
    const job = this.jobs.getJob(jobId), input = this.jobs.getInputSnapshot(inputId);
    if (input.job_id !== job.id || input.workspace_id !== job.workspace_id) this.fail('Semantic inputs belong to another job', 'invalid_relationship');
    return { job, input };
  }
  private bump(jobId: string) {
    const next = this.head(jobId) + 1;
    this.db.prepare('INSERT INTO semantic_heads VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET revision=excluded.revision').run(jobId, next);
    return next;
  }
  private parse<T>(row: unknown): T { if (!row) this.fail('Semantic record not found', 'not_found'); return JSON.parse((row as { payload: string }).payload) as T; }
  operation(jobId: string, id: string): SemanticOperation {
    this.jobs.getJob(jobId);
    return this.parse(this.db.prepare('SELECT payload FROM semantic_operations WHERE id=? AND job_id=?').get(id, jobId));
  }
  private setOperation(op: SemanticOperation) { this.db.prepare('UPDATE semantic_operations SET state=?,payload=? WHERE id=?').run(op.state, JSON.stringify(op), op.id); }
  begin(request: SemanticStart): SemanticOperation {
    return this.tx(() => {
      const { job } = this.lineage(request.job_id, request.input_snapshot_id);
      const key = fingerprint(canonical(request));
      const receipt = this.db.prepare('SELECT request_fingerprint,payload FROM semantic_receipts WHERE job_id=? AND idempotency_key=?').get(job.id, request.idempotency_key) as { request_fingerprint: string; payload: string } | undefined;
      if (receipt) {
        if (receipt.request_fingerprint !== key) this.fail('Idempotency key used for different semantic input', 'idempotency_conflict');
        return this.operation(job.id, JSON.parse(receipt.payload).id);
      }
      if (job.revision !== request.expected_job_revision || this.head(job.id) !== request.expected_semantic_revision) this.fail('Stale semantic or job revision');
      const sequence = (this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM semantic_operations WHERE job_id=?').get(job.id) as { n: number }).n;
      const op: SemanticOperation = { ...request, id: randomUUID(), sequence, stop_generation: this.jobs.getControl().stop_generation, state: 'checking' };
      this.db.prepare('INSERT INTO semantic_operations VALUES (?,?,?,?,?,?)').run(op.id, job.id, op.target_fingerprint, sequence, op.state, JSON.stringify(op));
      this.db.prepare('INSERT INTO semantic_receipts VALUES (?,?,?,?)').run(job.id, request.idempotency_key, key, JSON.stringify({ id: op.id }));
      return op;
    });
  }
  reserve(operationId: string, leaseMs: number): SemanticCall {
    return this.tx(() => {
      const op = this.parse<SemanticOperation>(this.db.prepare('SELECT payload FROM semantic_operations WHERE id=?').get(operationId));
      this.assertCurrent(op);
      const lease = this.db.prepare('SELECT * FROM semantic_leases WHERE job_id=?').get(op.job_id) as { call_id: string; expires_at: string } | undefined;
      if (lease && lease.expires_at > new Date().toISOString()) this.fail('A semantic check is already running', 'ineligible');
      if (lease) {
        const old = this.parse<SemanticCall>(this.db.prepare('SELECT payload FROM semantic_calls WHERE id=?').get(lease.call_id));
        this.finishFailure(old, 'Previous classification was interrupted; retry explicitly.', 0);
      }
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM semantic_calls WHERE job_id=? AND cycle_id=?').get(op.job_id, op.cycle_id) as { n: number }).n;
      if (count >= C.SEMANTIC_LIMITS.automaticCalls) this.fail('Classification call limit reached. Review facts manually or request another check.', 'ineligible');
      const call: SemanticCall = { id: randomUUID(), job_id: op.job_id, operation_id: op.id, owner_token: randomUUID(), started_at: new Date().toISOString() };
      this.db.prepare('INSERT INTO semantic_calls VALUES (?,?,?,?,?)').run(call.id, op.job_id, op.cycle_id, count + 1, JSON.stringify(call));
      this.db.prepare('INSERT INTO semantic_leases VALUES (?,?,?,?)').run(op.job_id, call.id, call.owner_token, new Date(Date.now() + leaseMs).toISOString());
      return call;
    });
  }
  private assertCurrent(op: SemanticOperation) {
    const { job } = this.lineage(op.job_id, op.input_snapshot_id);
    const latest = this.db.prepare('SELECT MAX(sequence) AS n FROM semantic_operations WHERE job_id=?').get(job.id) as { n: number };
    if (op.state !== 'checking' || latest.n !== op.sequence || job.revision !== op.expected_job_revision || this.head(job.id) !== op.expected_semantic_revision
      || this.jobs.getControl().stop_generation !== op.stop_generation) this.fail('Semantic check was superseded');
  }
  complete(call: SemanticCall, value: C.SemanticResult, elapsedMs: number) {
    return this.tx(() => {
      const op = this.operation(call.job_id, call.operation_id); this.assertCurrent(op);
      const lease = this.db.prepare('SELECT owner_token,call_id,expires_at FROM semantic_leases WHERE job_id=?').get(call.job_id) as { owner_token: string; call_id: string; expires_at: string } | undefined;
      if (!lease || lease.owner_token !== call.owner_token || lease.call_id !== call.id || lease.expires_at < new Date().toISOString()) this.fail('Semantic lease lost', 'invalid_ownership');
      const parsed = C.SemanticResultSchema.parse(value);
      if (parsed.job_id !== op.job_id || parsed.input_snapshot_id !== op.input_snapshot_id || parsed.candidate_fingerprint !== op.target_fingerprint
        || parsed.input_fingerprint !== this.jobs.getInputSnapshot(op.input_snapshot_id).fingerprint) this.fail('Semantic result lineage mismatch', 'invalid_relationship');
      const result = { ...parsed, head_revision: this.bump(op.job_id) };
      this.db.prepare('INSERT INTO semantic_records VALUES (?,?,?,?,?,?)').run(result.id, result.job_id, result.input_snapshot_id, result.cache_key, result.head_revision, JSON.stringify(result));
      this.db.prepare('INSERT INTO semantic_call_results VALUES (?,?)').run(call.id, JSON.stringify({ state: 'complete', elapsed_ms: elapsedMs }));
      this.db.prepare('DELETE FROM semantic_leases WHERE job_id=? AND owner_token=?').run(call.job_id, call.owner_token);
      this.setOperation({ ...op, expected_semantic_revision: result.head_revision });
      return result;
    });
  }
  finish(operationId: string, jobId: string, reason?: string) {
    this.tx(() => {
      const op = this.operation(jobId, operationId);
      if (op.state !== 'checking') return;
      if (!reason) this.assertCurrent(op);
      this.setOperation({ ...op, state: reason ? 'unavailable' : 'complete', ...(reason ? { reason } : {}) });
    });
  }
  private finishFailure(call: SemanticCall, reason: string, elapsedMs: number) {
    this.db.prepare('INSERT OR IGNORE INTO semantic_call_results VALUES (?,?)').run(call.id, JSON.stringify({ state: 'unavailable', reason, elapsed_ms: elapsedMs }));
    this.db.prepare('DELETE FROM semantic_leases WHERE job_id=? AND owner_token=?').run(call.job_id, call.owner_token);
    const op = this.operation(call.job_id, call.operation_id); this.setOperation({ ...op, state: 'unavailable', reason });
  }
  failCall(call: SemanticCall, reason: string, elapsedMs: number) { this.tx(() => this.finishFailure(call, reason, elapsedMs)); }
  results(jobId: string, inputId: string): C.SemanticResult[] {
    this.lineage(jobId, inputId);
    return this.db.prepare('SELECT payload FROM semantic_records WHERE job_id=? AND input_snapshot_id=? ORDER BY head_revision DESC').all(jobId, inputId).map(r => C.SemanticResultSchema.parse(this.parse(r)));
  }
  clarifications(jobId: string, inputId: string): C.Clarification[] {
    this.lineage(jobId, inputId);
    return this.db.prepare('SELECT payload FROM semantic_clarifications WHERE job_id=? AND input_snapshot_id=? ORDER BY head_revision DESC').all(jobId, inputId).map(r => C.ClarificationSchema.parse(this.parse(r)));
  }
  clarify(value: C.Clarification, expectedHead: number, expectedJobRevision: number, key: string): C.Clarification {
    return this.tx(() => {
      const parsed = C.ClarificationSchema.parse(value), { job } = this.lineage(parsed.job_id, parsed.input_snapshot_id);
      const requestHash = fingerprint(canonical({ ...parsed, id: '', recorded_at: '', revision: 0 }));
      const receipt = this.db.prepare('SELECT request_fingerprint,payload FROM semantic_receipts WHERE job_id=? AND idempotency_key=?').get(job.id, key) as { request_fingerprint: string; payload: string } | undefined;
      if (receipt) { if (receipt.request_fingerprint !== requestHash) this.fail('Clarification key used for different input', 'idempotency_conflict'); return C.ClarificationSchema.parse(JSON.parse(receipt.payload)); }
      if (job.revision !== expectedJobRevision || this.head(job.id) !== expectedHead) this.fail('Stale clarification revision');
      if (parsed.supersedes && !this.clarifications(job.id, parsed.input_snapshot_id).some(c => c.id === parsed.supersedes && C.sameFact(c.fact, parsed.fact))) this.fail('Invalid clarification supersession', 'invalid_relationship');
      const next = { ...parsed, revision: this.bump(job.id) };
      this.db.prepare('INSERT INTO semantic_clarifications VALUES (?,?,?,?,?,?)').run(next.id, job.id, next.input_snapshot_id, next.revision, next.supersedes, JSON.stringify(next));
      this.db.prepare('INSERT INTO semantic_receipts VALUES (?,?,?,?)').run(job.id, key, requestHash, JSON.stringify(next));
      return next;
    });
  }
  usage(jobId: string) {
    this.jobs.getJob(jobId);
    const rows = this.db.prepare('SELECT r.payload FROM semantic_calls c LEFT JOIN semantic_call_results r ON r.call_id=c.id WHERE c.job_id=?').all(jobId) as { payload: string | null }[];
    return { dispatched: rows.length, elapsed_ms: rows.reduce((n, r) => n + (r.payload ? JSON.parse(r.payload).elapsed_ms ?? 0 : 0), 0), tokens: null, cost: null };
  }
  evaluation(key: string, suite: string): C.EvaluationRecord | null {
    const row = this.db.prepare('SELECT payload FROM semantic_evaluations WHERE configuration_key=? AND suite_hash=?').get(key, suite);
    return row ? this.parse(row) : null;
  }
  saveEvaluation(record: C.EvaluationRecord) {
    this.db.prepare('INSERT INTO semantic_evaluations VALUES (?,?,?,?) ON CONFLICT(configuration_key,suite_hash) DO UPDATE SET passed=excluded.passed,payload=excluded.payload').run(record.configuration_key, record.suite_hash, Number(record.passed), JSON.stringify(record));
  }
}
