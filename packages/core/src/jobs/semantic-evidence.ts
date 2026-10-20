import { z } from 'zod';
export const SEMANTIC_VERSION = '1';
export const SEMANTIC_LIMITS = Object.freeze({ passages: 8, inputChars: 48000, outputChars: 16000, timeoutMs: 60000, automaticCalls: 4 });
const text = z.string().trim().min(1);
export const FactSchema = z.object({ work_id: text, predicate: text, qualifiers: z.array(text) }).strict();
export const SourceQuoteSchema = z.object({ evidence_id: text, evidence_fingerprint: text,
  field: z.enum(['title', 'summary', 'impact', 'narrative']), start: z.number().int().nonnegative(),
  end: z.number().int().positive(), quote: text,
}).strict().refine(q => q.end > q.start && q.end - q.start === q.quote.length, 'Invalid source span');
export const SubjectSchema = z.object({ id: text, path: text, proposal_id: text.optional(), passage_fingerprint: text }).strict();
export const ClaimSchema = z.object({ id: text, subject: SubjectSchema, text,
  start: z.number().int().nonnegative(), end: z.number().int().positive(), fact: FactSchema,
  qualifier_text: z.array(text),
}).strict().refine(c => c.end > c.start && c.end - c.start === c.text.length, 'Invalid claim span');
export const ClarificationSchema = z.object({ schema_version: z.literal(1), id: z.string().uuid(),
  job_id: z.string().uuid(), input_snapshot_id: z.string().uuid(), revision: z.number().int().nonnegative(),
  kind: z.enum(['confirmation', 'correction']), fact: FactSchema, claim_ids: z.array(text).min(1),
  question: text, assertion: text, actor: text, recorded_at: z.string().datetime(), source_ids: z.array(text),
  supporting_quotes: z.array(SourceQuoteSchema).optional(),
  confirmed: z.boolean().optional(),
  supersedes: z.string().uuid().nullable(), corrected_assertion: text.optional(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === 'correction' && (!v.corrected_assertion || !v.effective_date || !v.source_ids.length))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Identify the older source assertion and when it changed.' });
  if (v.effective_date) {
    const date = new Date(`${v.effective_date}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v.effective_date)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid calendar date.' });
  }
});
export const SemanticStateSchema = z.enum(['supported', 'needs_clarification', 'contradicted', 'unavailable']);
export const ClaimResultSchema = z.object({ claim: ClaimSchema, state: SemanticStateSchema,
  evidence: z.array(SourceQuoteSchema), explanation: text, question: text.optional(),
}).strict().superRefine((v, ctx) => {
  if ((v.state === 'supported' || v.state === 'contradicted') && !v.evidence.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'This decision requires source evidence.' });
  if (v.state === 'needs_clarification' && !v.question)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ask a specific factual question.' });
});
export const PassageResultSchema = z.object({ subject: SubjectSchema,
  claims: z.array(ClaimResultSchema).min(1), complete: z.literal(true) }).strict();
export const SemanticResultSchema = z.object({ schema_version: z.literal(1), id: z.string().uuid(),
  job_id: z.string().uuid(), input_snapshot_id: z.string().uuid(), input_fingerprint: text,
  candidate_fingerprint: text, cache_key: text, head_revision: z.number().int().nonnegative(),
  passages: z.array(PassageResultSchema).min(1), configuration_key: text, policy_version: text,
  evidence_set_fingerprint: text, clarification_fingerprints: z.array(text), provenance: z.literal('model'),
  recorded_at: z.string().datetime(),
}).strict();
export type Fact = z.infer<typeof FactSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type SourceQuote = z.infer<typeof SourceQuoteSchema>;
export type Clarification = z.infer<typeof ClarificationSchema>;
export type ClaimResult = z.infer<typeof ClaimResultSchema>;
export type PassageResult = z.infer<typeof PassageResultSchema>;
export type SemanticResult = z.infer<typeof SemanticResultSchema>;
export interface SemanticPassage { subject: Subject; text: string; work_id: string; inherited: boolean; work_context?: string }
export interface SemanticSource { evidence_id: string; evidence_fingerprint: string; work_id: string;
  field: SourceQuote['field']; start: number; text: string; company?: string }
export interface SemanticBatchRequest {
  subjects: SemanticPassage[]; sources: SemanticSource[]; configuration_key: string;
  configuredStepTimeoutMs: number;
  coverage: { searched_source_count: number; omitted_source_ids: string[]; truncated: boolean };
}
export interface EvaluationRecord { configuration_key: string; suite_hash: string; passed: boolean; recorded_at: string;
  observations: { case_id: string; repetition: number; expected: string; actual: string; quotes_valid: boolean; elapsed_ms: number; reason?: string }[] }
