import { z } from 'zod';
import { FactSchema, SourceQuoteSchema } from './semantic-evidence.js';
import { SemanticTargetSchema } from './semantic-transport.js';
import { sameFact } from './semantic-policy.js';
const key = z.string().min(1), uuid = z.string().uuid(), revision = z.number().int().nonnegative();
export const CreatePreparationBatchSchema = z.object({
  members: z.array(z.object({ job_id: uuid, expected_revision: revision }).strict()).min(1).max(100)
    .refine(members => new Set(members.map(m => m.job_id)).size === members.length, 'Select each job once'),
  idempotency_key: key,
}).strict();
export const PreparationBatchSchema = z.object({ id: uuid, workspace_id: uuid, created_at: z.string().datetime(),
  members: z.array(z.object({ job_id: uuid, input_snapshot_id: uuid, input_fingerprint: key, position: revision }).strict()),
}).strict();
export type PreparationBatch = z.infer<typeof PreparationBatchSchema>;
export const PreparationQuestionMemberSchema = z.object({ job_id: uuid, input_fingerprint: key, job_revision: revision,
  semantic_revision: revision, target: SemanticTargetSchema, claim_ids: z.array(key).min(1), fact: FactSchema,
  assertion: key, question: key, state: z.enum(['needs_clarification', 'contradicted']),
  content_fingerprint: key, source_ids: z.array(key),
  narrower: z.object({ text: key, source: SourceQuoteSchema }).strict().optional(),
}).strict();
export type PreparationQuestionMember = z.infer<typeof PreparationQuestionMemberSchema>;
/** Unavailable checks never become factual questions; correction and confirmation groups stay separate. */
export function groupPreparationQuestions(members: PreparationQuestionMember[]) {
  const groups: { id: string; members: PreparationQuestionMember[] }[] = [];
  for (const member of members) {
    const group = groups.find(g => sameFact(g.members[0].fact, member.fact)
      && g.members[0].state === member.state && g.members[0].assertion === member.assertion);
    if (group) group.members.push(member);
    else groups.push({ id: member.claim_ids[0], members: [member] });
  }
  return groups;
}
export interface PreparationQueueItem { job_id: string; artifact_id: string; artifact_fingerprint: string; approved: boolean;
  company?: string | null; role?: string | null; posting_url?: string | null }
