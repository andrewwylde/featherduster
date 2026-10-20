import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { semanticFixture } from './fixtures/semantic-fixture.js';
import { SemanticRepository } from '../src/jobs/semantic-repository.js';
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
it('rejects foreign input lineage and stale expected heads', () => {
  const f = semanticFixture(); cleanups.push(f.cleanup);
  const r = new SemanticRepository(f.jobs);
  expect(() => r.begin({ job_id: f.job.id, input_snapshot_id: randomUUID(), expected_job_revision: 0,
    expected_semantic_revision: 0, cycle_id: 'c', target_fingerprint: 't', idempotency_key: 'key', automatic: false })).toThrow();
  expect(() => r.begin({ job_id: f.job.id, input_snapshot_id: f.input.id, expected_job_revision: f.jobs.getJob(f.job.id).revision,
    expected_semantic_revision: 9, cycle_id: 'c', target_fingerprint: 't', idempotency_key: 'key', automatic: false })).toThrow(/revision/);
});
