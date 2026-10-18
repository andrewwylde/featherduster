// packages/core/src/jobs/draft-validation.ts
import { z } from 'zod';
import { DraftResumeSpecSchema } from './draft-content.js';
export const DraftIssueSchema = z.object({
  path: z.string(), code: z.string(), severity: z.enum(['block', 'warn']), message: z.string(),
}).strict();
export type DraftIssue = z.infer<typeof DraftIssueSchema>;
export const DraftBindingSchema = z.object({
  candidate_fingerprint: z.string().min(1), context_fingerprint: z.string().min(1),
  input_snapshot_id: z.string().uuid(), input_fingerprint: z.string().min(1),
  parent_artifact_id: z.string().uuid(), parent_artifact_fingerprint: z.string().min(1),
}).strict();
export type DraftBinding = z.infer<typeof DraftBindingSchema>;
export const CheckJobDraftRequestSchema = z.object({ candidate: DraftResumeSpecSchema }).strict();
export const JobDraftCheckSchema = z.object({
  binding: DraftBindingSchema, job_revision: z.number().int().nonnegative(),
  status: z.enum(['ready', 'blocked', 'unavailable']), issues: z.array(DraftIssueSchema),
}).strict();
export type JobDraftCheck = z.infer<typeof JobDraftCheckSchema>;
export const FinalizeJobDraftRequestSchema = z.object({
  expected_job_revision: z.number().int().nonnegative(),
  expected_draft_revision: z.number().int().nonnegative(), binding: DraftBindingSchema,
  idempotency_key: z.string().min(1),
}).strict();
export type FinalizeJobDraftRequest = z.infer<typeof FinalizeJobDraftRequestSchema>;

