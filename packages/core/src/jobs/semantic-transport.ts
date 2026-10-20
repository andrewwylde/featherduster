import { z } from 'zod';
import { DraftResumeSpecSchema } from './draft-content.js';
import { FactSchema, type ClaimResult, type Clarification, type SemanticPassage } from './semantic-evidence.js';
const key = z.string().min(1), revision = z.number().int().nonnegative();
export const SemanticTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('review'), review_id: z.string().uuid(), review_revision: revision }).strict(),
  z.object({ kind: z.literal('draft'), draft_id: z.string().uuid(), candidate: DraftResumeSpecSchema }).strict(),
]);
export const StartSemanticCheckSchema = z.object({ expected_job_revision: revision, expected_semantic_revision: revision,
  input_fingerprint: key, target: SemanticTargetSchema, reason: z.enum(['edit', 'check', 'retry']), idempotency_key: key }).strict();
export const SaveFactClarificationSchema = z.object({ target: SemanticTargetSchema,
  expected_job_revision: revision, expected_semantic_revision: revision, input_fingerprint: key, idempotency_key: key,
  claim_ids: z.array(key).min(1), fact: FactSchema, assertion: key, kind: z.enum(['confirmation', 'correction']),
  corrected_assertion: key.optional(), effective_date: key.optional(), source_ids: z.array(key), supersedes: z.string().uuid().nullable().default(null),
}).strict();
export type SemanticTarget = z.infer<typeof SemanticTargetSchema>;
export type StartSemanticCheck = z.infer<typeof StartSemanticCheckSchema>;
export type SaveFactClarification = z.infer<typeof SaveFactClarificationSchema>;
export interface JobFact extends ClaimResult { resolution: { provenance: 'model' | 'human'; explanation: string } | null;
  passage: SemanticPassage; }
export interface JobFacts {
  job_id: string; job_revision: number; input_fingerprint: string; semantic_revision: number; target: SemanticTarget;
  candidate_fingerprint: string; support_fingerprint: string; facts: JobFact[]; clarifications: Clarification[];
  execution: 'unchecked' | 'checking' | 'complete' | 'unavailable'; reason?: string; configuration_evaluated: boolean;
  usage: { dispatched: number; elapsed_ms: number; tokens: number | null; cost: number | null };
}
