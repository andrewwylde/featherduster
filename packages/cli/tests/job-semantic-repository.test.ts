import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { semanticFixture } from './fixtures/semantic-fixture.js';
import { SemanticRepository } from '../src/jobs/semantic-repository.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(f => f()); });
it('reserves only one live call, counts failed calls and rejects changed replay payloads', () => {
  const f = semanticFixture(); cleanups.push(f.cleanup);
  const r = new SemanticRepository(f.jobs);
  const req = { job_id: f.job.id, input_snapshot_id: f.input.id, expected_job_revision: f.jobs.getJob(f.job.id).revision,
    expected_semantic_revision: 0, cycle_id: 'cycle', target_fingerprint: 'target', idempotency_key: randomUUID(), automatic: true };
  const op = r.begin(req);
  const call = r.reserve(op.id, 1000);
  expect(() => r.reserve(op.id, 1000)).toThrow(/running/);
  expect(() => r.begin({ ...req, target_fingerprint: 'changed' })).toThrow(/different/);
  r.failCall(call, 'timeout', 1000);
  expect(r.operation(f.job.id, op.id).state).toBe('unavailable');
  expect(r.usage(f.job.id).dispatched).toBe(1);
  expect(r.begin(req).id).toBe(op.id);
});
it('fences cross-connection owners and counts every failed dispatch against the four-call budget', () => {
  const f = semanticFixture(); cleanups.push(f.cleanup);
  const other = openJobsDatabase(f.root), r = new SemanticRepository(f.jobs), peer = new SemanticRepository(new JobsRepository(other));
  try {
    const request = { job_id: f.job.id, input_snapshot_id: f.input.id, expected_job_revision: f.jobs.getJob(f.job.id).revision,
      expected_semantic_revision: 0, cycle_id: 'attempt', target_fingerprint: 'target', automatic: true };
    const first = r.begin({ ...request, idempotency_key: randomUUID() }), call = r.reserve(first.id, 10000);
    expect(() => peer.reserve(first.id, 10000)).toThrow(/running/);
    const newer = peer.begin({ ...request, idempotency_key: randomUUID() });
    expect(() => r.finish(first.id, f.job.id)).toThrow(/superseded/);
    r.failCall(call, 'superseded', 2);
    for (let n = 1; n < 4; n++) {
      const op = n === 1 ? newer : r.begin({ ...request, idempotency_key: randomUUID() });
      r.failCall(r.reserve(op.id, 1000), 'unavailable', 1);
    }
    const fifth = r.begin({ ...request, idempotency_key: randomUUID() });
    expect(() => peer.reserve(fifth.id, 1000)).toThrow(/limit/);
    expect(r.usage(f.job.id)).toMatchObject({ dispatched: 4, elapsed_ms: 5, tokens: null, cost: null });
    expect(() => f.database.db.prepare('DELETE FROM semantic_calls WHERE id=?').run(call.id)).toThrow();
  } finally { other.close(); }
});
it('rejects foreign input lineage and stale expected heads', () => {
  const f = semanticFixture(); cleanups.push(f.cleanup);
  const r = new SemanticRepository(f.jobs);
  expect(() => r.begin({ job_id: f.job.id, input_snapshot_id: randomUUID(), expected_job_revision: 0,
    expected_semantic_revision: 0, cycle_id: 'c', target_fingerprint: 't', idempotency_key: 'key', automatic: false })).toThrow();
  expect(() => r.begin({ job_id: f.job.id, input_snapshot_id: f.input.id, expected_job_revision: f.jobs.getJob(f.job.id).revision,
    expected_semantic_revision: 9, cycle_id: 'c', target_fingerprint: 't', idempotency_key: 'key', automatic: false })).toThrow(/revision/);
});
