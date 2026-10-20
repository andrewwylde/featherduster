import { randomUUID } from 'node:crypto';
import type { JobsRuntime } from '../../src/jobs/runtime.js';
/** Explicit fixture-user decisions, using the same strict operations as the UI. */
export function confirmJobFacts(runtime: JobsRuntime, jobId: string) {
  for (;;) {
    const view = runtime.semantic.read(jobId), fact = view.facts.find(f => !f.resolution);
    if (!fact) break;
    runtime.semantic.clarify(jobId, { target: view.target, expected_job_revision: view.job_revision,
      expected_semantic_revision: view.semantic_revision, input_fingerprint: view.input_fingerprint,
      claim_ids: [fact.claim.id], fact: fact.claim.fact, assertion: `Fixture user confirms: ${fact.claim.text}`,
      kind: 'confirmation', source_ids: [], supersedes: null, idempotency_key: randomUUID() });
  }
  const facts = runtime.semantic.read(jobId);
  if (facts.target.kind !== 'review') throw Error('Expected review');
  return runtime.proposals.save({ job_id: jobId, review_id: facts.target.review_id, expected_job_revision: facts.job_revision,
    expected_review_revision: facts.target.review_revision, input_fingerprint: facts.input_fingerprint,
    patches: [], groundings: [], feedback_kind: 'grounding', explanation: 'Confirm fixture facts',
    idempotency_key: randomUUID() }).result;
}
