import { z } from 'zod';
import { DraftResumeSpecSchema } from './draft-content.js';
import { FactSchema, SourceQuoteSchema, type ClaimResult, type Clarification, type SemanticPassage, type SemanticSource } from './semantic-evidence.js';
import { HumanProvenanceSchema } from '../corpus/schemas.js';
import type { ProposalIssue } from './proposal-review.js';
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
  corrected_assertion: key.optional(), effective_date: key.optional(), source_ids: z.array(key).default([]), supersedes: z.string().uuid().nullable().default(null),
  supporting_quotes: z.array(SourceQuoteSchema).optional(),
  confirmed: z.boolean().optional(),
  reuse: z.enum(['job', 'project', 'employer']).optional(),
  expected_corpus_revision: revision.optional(),
  supersedes_shared: z.string().uuid().optional(),
  support_basis: z.enum(['captured_evidence', 'human_confirmation', 'both']).optional(),
  human_provenance: HumanProvenanceSchema.optional(),
  employment_id: key.optional(),
  employment: z.object({ employer: z.string(), period: z.string().optional() }).optional(),
}).strict();
export type SemanticTarget = z.infer<typeof SemanticTargetSchema>;
export type StartSemanticCheck = z.infer<typeof StartSemanticCheckSchema>;
export type SaveFactClarification = z.infer<typeof SaveFactClarificationSchema>;
export interface JobFact extends ClaimResult {
  resolution: { provenance: 'model' | 'human'; explanation: string } | null;
  passage: SemanticPassage;
  status?: string;
  support_label?: string;
  support_basis?: 'captured_evidence' | 'human_confirmation' | 'both';
}

export const SemanticBatchFailureSchema = z.object({
  batch_index: z.number().int().nonnegative().optional(),
  stage: z.enum(['dispatch', 'wire_parse', 'schema_validation', 'timeout', 'stale_revision']),
  code: z.enum(['wire_shape_invalid', 'invalid_span', 'timeout', 'stale_result', 'unknown']),
  safe_diagnostic: z.string().min(1),
  passage_ids: z.array(z.string()).optional(),
});
export type SemanticBatchFailure = z.infer<typeof SemanticBatchFailureSchema>;

export interface JobFacts {
  job_id: string; job_revision: number; input_fingerprint: string; semantic_revision: number; target: SemanticTarget;
  candidate_fingerprint: string; support_fingerprint: string; facts: JobFact[]; clarifications: Clarification[];
  sources?: SemanticSource[];
  corpus_revision?: number;
  shared_clarifications?: { update_id: string; clarification: Clarification }[];
  execution: 'unchecked' | 'checking' | 'complete' | 'unavailable'; reason?: string; configuration_evaluated: boolean;
  failures?: SemanticBatchFailure[];
  batches_succeeded?: number;
  batches_failed?: number;
  batchesSucceeded?: number;
  batchesFailed?: number;
  usage: { dispatched: number; elapsed_ms: number; tokens: number | null; cost: number | null };
}

export const UnifiedReviewSummarySchema = z.object({
  unresolved_facts_count: z.number().int().nonnegative(),
  wording_issues_count: z.number().int().nonnegative(),
  technical_failures_count: z.number().int().nonnegative(),
  supported_claims_count: z.number().int().nonnegative(),
  total_claims_count: z.number().int().nonnegative(),
  primary_next_action: z.enum([
    'answer_facts',
    'fix_wording',
    'retry_technical',
    'wait_checking',
    'review_pdf',
    'ready_to_approve',
  ]),
}).strict();
export type UnifiedReviewSummary = z.infer<typeof UnifiedReviewSummarySchema>;

export function computeUnifiedReviewSummary(params: {
  facts?: JobFacts;
  issues?: ProposalIssue[];
  wordingIssuesCount?: number;
  isChecking?: boolean;
  hasPdf?: boolean;
  isApproved?: boolean;
}): UnifiedReviewSummary {
  const isChecking = params.isChecking ?? (params.facts?.execution === 'checking');
  const factsList = params.facts?.facts ?? [];

  const unresolved_facts_count = factsList.filter(
    f => !f.resolution && (f.state === 'needs_clarification' || f.state === 'contradicted')
  ).length;

  const wording_issues_count = params.wordingIssuesCount ?? (
    params.issues?.filter(
      i => !i.details || i.details.length === 0 || i.details.some(d => d.severity === 'block')
    ).length ?? 0
  );

  const batchFailures = params.facts?.failures?.length ?? 0;
  const unavailableFacts = factsList.filter(f => !f.resolution && f.state === 'unavailable').length;
  const technical_failures_count = batchFailures > 0 ? batchFailures : unavailableFacts;

  const supported_claims_count = factsList.filter(
    f => f.resolution != null || f.state === 'supported'
  ).length;

  const total_claims_count = factsList.length;

  let primary_next_action: UnifiedReviewSummary['primary_next_action'];
  if (isChecking) {
    primary_next_action = 'wait_checking';
  } else if (unresolved_facts_count > 0) {
    primary_next_action = 'answer_facts';
  } else if (technical_failures_count > 0) {
    primary_next_action = 'retry_technical';
  } else if (wording_issues_count > 0) {
    primary_next_action = 'fix_wording';
  } else if (!params.hasPdf) {
    primary_next_action = 'wait_checking';
  } else if (!params.isApproved) {
    primary_next_action = 'ready_to_approve';
  } else {
    primary_next_action = 'review_pdf';
  }

  return {
    unresolved_facts_count,
    wording_issues_count,
    technical_failures_count,
    supported_claims_count,
    total_claims_count,
    primary_next_action,
  };
}
