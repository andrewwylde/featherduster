import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CreatePreparationBatchSchema, groupPreparationQuestions, type PreparationQuestionMember } from '../src/jobs/preparation-batch.js';
it('preserves selection order and rejects duplicate selections', () => {
  const first = { job_id: randomUUID(), expected_revision: 2 }, second = { job_id: randomUUID(), expected_revision: 0 };
  expect(CreatePreparationBatchSchema.parse({ members: [second, first], idempotency_key: 'select' }).members).toEqual([second, first]);
  expect(CreatePreparationBatchSchema.safeParse({ members: [first, first], idempotency_key: 'duplicate' }).success).toBe(false);
});
it('groups only exact work, predicate, qualifiers and correction requirements', () => {
  const member: PreparationQuestionMember = { job_id: randomUUID(), input_fingerprint: 'input', job_revision: 1, semantic_revision: 2,
    target: { kind: 'review', review_id: randomUUID(), review_revision: 3 }, claim_ids: ['claim'], fact: { work_id: 'Acme/project-a', predicate: 'same-feature', qualifiers: ['prototype'] },
    assertion: 'Built feature', question: 'Is this the same feature?', state: 'needs_clarification', content_fingerprint: 'content', source_ids: [] };
  const equivalent = { ...member, job_id: randomUUID() };
  expect(groupPreparationQuestions([member, equivalent])).toHaveLength(1);
  for (const changed of [{ ...equivalent, fact: { ...member.fact, work_id: 'Acme/project-b' } },
    { ...equivalent, fact: { ...member.fact, qualifiers: ['production'] } }, { ...equivalent, state: 'contradicted' as const }])
    expect(groupPreparationQuestions([member, changed])).toHaveLength(2);
});
