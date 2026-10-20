import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { semanticFixture } from './fixtures/semantic-fixture.js';
import { SemanticService } from '../src/jobs/semantic-service.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const f of cleanups.splice(0)) await f(); });
function setup() {
  const f = semanticFixture();
  const now = new Date().toISOString(), draftId = randomUUID();
  f.jobs.saveDraft({ schema_version: 1, id: draftId, revision: 0, job_id: f.job.id, workspace_id: f.job.workspace_id,
    input_snapshot_id: f.input.id, parent_artifact_version_id: null, candidate: f.candidate, proposals: { proposals: [] }, created_at: now, updated_at: now }, null);
  const run = vi.fn(async () => { throw Error('offline'); });
  const runner = { id: 'fake' as const, model: 'test', label: 'Fake', locality: 'local' as const, run, detect: async () => ({ available: true, detail: '' }) };
  const service = new SemanticService(f.jobs, f.artifacts, { runner: () => runner, consent: () => true, timeoutMs: () => 1000 });
  const target: C.SemanticTarget = { kind: 'draft', draft_id: draftId, candidate: f.candidate };
  cleanups.push(async () => { await service.dispose(); f.cleanup(); });
  return { ...f, service, target, run };
}
it('reads never dispatch inference and manual confirmation works before any model inventory', () => {
  const f = setup(), read = f.service.read(f.job.id, f.target), fact = read.facts[0];
  expect(f.run).not.toHaveBeenCalled();
  const confirmed = f.service.clarify(f.job.id, { target: f.target, expected_job_revision: read.job_revision,
    expected_semantic_revision: read.semantic_revision, input_fingerprint: read.input_fingerprint, idempotency_key: randomUUID(),
    claim_ids: [fact.claim.id], fact: fact.claim.fact, assertion: 'I implemented these backend services.', kind: 'confirmation', source_ids: [], supersedes: null });
  expect(confirmed.facts[0].resolution?.provenance).toBe('human');
  expect(f.run).not.toHaveBeenCalled();
});
it('records outage separately from unsupported content and does not retry on reads', async () => {
  const f = setup(), read = f.service.read(f.job.id, f.target);
  const operation = f.service.start(f.job.id, { target: f.target, expected_job_revision: read.job_revision, expected_semantic_revision: read.semantic_revision,
    input_fingerprint: read.input_fingerprint, reason: 'check', idempotency_key: randomUUID() });
  await f.service.wait(f.job.id);
  expect(f.service.operation(f.job.id, operation.operation_id).state).toBe('unavailable');
  expect(f.service.read(f.job.id, f.target).facts[0].state).toBe('unavailable');
  f.service.read(f.job.id, f.target);
  expect(f.run).toHaveBeenCalledTimes(1);
});
