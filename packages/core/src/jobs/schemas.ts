import { DraftResumeSpecSchema } from './draft-content.js';
import { z } from 'zod';
import { ResumeSpecSchema } from '../schemas/resume.js';
import { AlignmentRowSchema, ProposalSetSchema, TAILORING_STEPS, ValidationIssueSchema } from '../tailoring/schemas.js';

const text = z.string().trim().min(1);
const uuid = z.string().uuid();
const count = z.number().int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const version = { schema_version: z.literal(1) };
const entity = { ...version, id: uuid, workspace_id: text };
const jobEntity = { ...entity, job_id: uuid };
const dates = { created_at: timestamp, updated_at: timestamp };

export const PreparationStateSchema = z.enum(['saved', 'queued', 'preparing', 'needs_input', 'resume_ready', 'failed', 'interrupted', 'skipped', 'cancelled']);
export type PreparationState = z.infer<typeof PreparationStateSchema>;
export const ApplicationLifecycleSchema = z.enum(['not_started', 'draft', 'needs_input', 'submitted', 'outcome_recorded', 'unknown']);
export type ApplicationLifecycle = z.infer<typeof ApplicationLifecycleSchema>;
export const PreparationStageSchema = z.enum(['preflight', ...TAILORING_STEPS, 'deslop', 'compile', 'verify', 'fit', 'material']);
export type PreparationStage = z.infer<typeof PreparationStageSchema>;
export const JobProvenanceSchema = z.object({
  source_type: z.enum(['user', 'posting', 'import', 'model']), reference: text,
  quote: text.nullable(), recorded_at: timestamp,
}).strict();
export type JobProvenance = z.infer<typeof JobProvenanceSchema>;
export const ImmutableReferenceSchema = z.object({ id: text, fingerprint: text }).strict();
export type ImmutableReference = z.infer<typeof ImmutableReferenceSchema>;
export const AnswerScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('candidate') }).strict(),
  z.object({ kind: z.literal('employer'), employer_id: text }).strict(),
  z.object({ kind: z.literal('job'), job_id: uuid }).strict(),
]);
export type AnswerScope = z.infer<typeof AnswerScopeSchema>;
export const JobRecoverySchema = z.object({
  kind: z.enum(['proposals', 'candidate', 'setup', 'fact', 'render', 'stale_inputs']),
  recovery_attempt_id: uuid.optional(), review_id: uuid.optional(), generation_id: uuid.optional(), failed_output: ImmutableReferenceSchema.optional(),
  subject: z.object({ proposal_id: text.optional(), path: text.optional() }).strict(),
  action: z.enum(['review_proposals', 'refresh_inputs', 'configure', 'answer_fact', 'retry_render']),
}).strict();
export type JobRecovery = z.infer<typeof JobRecoverySchema>;
export const CorpusNotificationSchema = z.object({ revision: count, update_ids: z.array(uuid) }).strict();
export type CorpusNotification = z.infer<typeof CorpusNotificationSchema>;
export const JobSchema = z.object({
  ...entity, recovery: JobRecoverySchema.optional(), revision: count, kind: z.enum(['job', 'discovery']),
  original_url: z.string().url().nullable(), canonical_url: z.string().url().nullable(),
  employer_id: text.nullable(), external_job_id: text.nullable(), company: text.nullable(), role: text.nullable(),
  notes: z.string().max(100000).optional(),
  context_url: z.string().url().refine(url => /^https?:\/\//i.test(url), 'Use an HTTP or HTTPS link').nullable().optional(),
  parent_discovery_id: uuid.nullable(), posting_snapshot_id: uuid.nullable(),
  preparation_state: PreparationStateSchema, application_lifecycle: ApplicationLifecycleSchema,
  preparation_stage: PreparationStageSchema.nullable(), base_resume_id: text.nullable(), template_id: text.nullable(),
  runner: text.nullable(), policy_fingerprint: text.nullable(), current_attempt_id: uuid.nullable(),
  artifact_version_ids: z.array(uuid), missing_inputs: z.array(z.object({
    key: text, question: text, scope: AnswerScopeSchema, reason: text,
  }).strict()), confirmation_provenance: z.array(JobProvenanceSchema), state_reason: text.nullable(), ...dates,
}).strict();
export type Job = z.infer<typeof JobSchema>;
export const PostingSnapshotSchema = z.object({
  ...jobEntity, source_kind: z.enum(['url', 'text']), original_url: z.string().url().nullable(),
  final_url: z.string().url().nullable(), retrieved_at: timestamp.nullable(), captured_at: timestamp,
  text, content_fingerprint: text,
}).strict().refine(s => s.source_kind !== 'url' || !!(s.original_url && s.final_url && s.retrieved_at), {
  message: 'URL capture requires original/final URLs and retrieval time.',
});
export type PostingSnapshot = z.infer<typeof PostingSnapshotSchema>;
export const DiscoveryOpeningSchema = z.object({
  ...entity, parent_discovery_id: uuid, company: text, role: text, original_url: z.string().url(),
  canonical_url: z.string().url(), source_quote: text, selected_job_id: uuid.nullable(),
}).strict().refine(s => s.selected_job_id !== s.parent_discovery_id, { message: 'Selection must link to a distinct child job.' });
export type DiscoveryOpening = z.infer<typeof DiscoveryOpeningSchema>;
export const ScopedAnswerSchema = z.object({
  ...entity, key: text, question: text, scope: AnswerScopeSchema,
  status: z.enum(['confirmed', 'inferred', 'unknown', 'privacy_preference']),
  value: z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]),
  provenance: JobProvenanceSchema, confirmed_at: timestamp.nullable(), updated_at: timestamp,
}).strict().superRefine((a, ctx) => {
  if (a.status === 'confirmed' ? a.value === null || a.confirmed_at === null : a.confirmed_at !== null) {
    ctx.addIssue({ code: 'custom', message: 'Only confirmed answers have a non-null value and confirmation time.' });
  }
  if (a.status === 'unknown' && a.value !== null) ctx.addIssue({ code: 'custom', message: 'Unknown answers must have null value.' });
});
export type ScopedAnswer = z.infer<typeof ScopedAnswerSchema>;
export const MoneyPreferenceSchema = z.object({ amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/), period: z.enum(['hour', 'month', 'year']) }).strict();
export type MoneyPreference = z.infer<typeof MoneyPreferenceSchema>;
const preferenceBase = { ...entity, strength: z.enum(['requirement', 'preference']), provenance: JobProvenanceSchema, updated_at: timestamp };
const setValue = z.array(text).min(1);
export const CandidatePreferenceSchema = z.discriminatedUnion('field', [
  z.object({ ...preferenceBase, field: z.literal('base_salary'), value: MoneyPreferenceSchema }).strict(),
  z.object({ ...preferenceBase, field: z.literal('total_compensation'), value: MoneyPreferenceSchema }).strict(),
  z.object({ ...preferenceBase, field: z.literal('employment_type'), value: setValue }).strict(),
  z.object({ ...preferenceBase, field: z.literal('location_eligibility'), value: setValue }).strict(),
  z.object({ ...preferenceBase, field: z.literal('role_level'), value: setValue }).strict(),
  z.object({ ...preferenceBase, field: z.literal('relocation'), value: z.boolean() }).strict(),
  z.object({ ...preferenceBase, field: z.literal('sponsorship'), value: z.boolean() }).strict(),
  z.object({ ...preferenceBase, field: z.literal('working_hour_overlap'), value: z.number().finite().min(0).max(24) }).strict(),
]);
export type CandidatePreference = z.infer<typeof CandidatePreferenceSchema>;
export const CandidateProfileSchema = z.object({
  ...entity, revision: count, facts: z.array(ScopedAnswerSchema), preferences: z.array(CandidatePreferenceSchema), ...dates,
}).strict().superRefine((p, ctx) => {
  if (p.facts.some(a => a.scope.kind !== 'candidate')) ctx.addIssue({ code: 'custom', message: 'Profile facts must be candidate-scoped.' });
  if ([...p.facts, ...p.preferences].some(a => a.workspace_id !== p.workspace_id)) ctx.addIssue({ code: 'custom', message: 'Profile facts/preferences must belong to its workspace.' });
});
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export const PostingFitProvenanceSchema = z.object({ snapshot_id: uuid, quote: text }).strict();
export type PostingFitProvenance = z.infer<typeof PostingFitProvenanceSchema>;
export const FitAssessmentSchema = z.object({
  ...jobEntity, posting_snapshot_id: uuid, profile_id: uuid, assessed_at: timestamp,
  recommendation: z.enum(['suitable', 'review', 'unsuitable']), rows: z.array(AlignmentRowSchema),
  coverage: z.object({ backed: count, transferable: count, gap: count }).strict(), material_gap_requirement_ids: z.array(text),
  comparisons: z.array(z.object({ preference_id: uuid, strength: z.enum(['requirement', 'preference']),
    result: z.enum(['match', 'mismatch', 'unknown']), reason: text, provenance: PostingFitProvenanceSchema.nullable(),
  }).strict()), issues: z.array(ValidationIssueSchema),
}).strict();
export type FitAssessment = z.infer<typeof FitAssessmentSchema>;
export const PreparationPolicySchema = z.object({
  ...version, mode: z.enum(['manual', 'candidate']), output_format: z.literal('latex'),
  page_budget: z.number().int().positive().default(1), max_model_calls: z.number().int().positive(),
  timeout_ms: z.number().int().positive(), max_repair_attempts: count, model_retry_count: count.default(0),
}).strict();
export type PreparationPolicy = z.infer<typeof PreparationPolicySchema>;
export const InputSnapshotSchema = z.object({
  ...jobEntity, created_at: timestamp, fingerprint: text, posting: ImmutableReferenceSchema,
  base_resume: ImmutableReferenceSchema, corpus_knowledge: ImmutableReferenceSchema.optional(), selected_evidence: z.array(ImmutableReferenceSchema),
  privacy_rules: ImmutableReferenceSchema, template: ImmutableReferenceSchema, runner_configuration: ImmutableReferenceSchema,
  policy: PreparationPolicySchema, policy_fingerprint: text,
}).strict();
export type InputSnapshot = z.infer<typeof InputSnapshotSchema>;
/** Version 2 is fit-only; legacy resume snapshots are deliberately unchanged. */
export const FitInputSnapshotSchema = InputSnapshotSchema.omit({ base_resume: true, template: true, policy: true }).extend({
  schema_version: z.literal(2), activity: z.literal('fit'),
  selection: ImmutableReferenceSchema,
  return_state: z.enum(['saved', 'resume_ready', 'needs_input']),
  return_recovery: JobRecoverySchema.optional(),
  return_missing_inputs: JobSchema.shape.missing_inputs,
  policy: z.object({ timeout_ms: z.number().int().positive(), max_model_calls: z.literal(2), max_repair_attempts: z.literal(0), model_retry_count: z.literal(0) }).strict(),
}).strict();
export type FitInputSnapshot = z.infer<typeof FitInputSnapshotSchema>;
export const MaterialInputSnapshotSchema = FitInputSnapshotSchema.extend({
  schema_version: z.literal(3), activity: z.enum(['cover_letter', 'interview_brief']),
  expected_material_revision_id: uuid.nullable(),
  resume: ImmutableReferenceSchema.nullable(), resume_content: ImmutableReferenceSchema.nullable(),
  policy: z.object({ timeout_ms: z.number().int().positive(), max_model_calls: z.literal(1), max_repair_attempts: z.literal(0), model_retry_count: z.literal(0) }).strict(),
}).strict();
export type MaterialInputSnapshot = z.infer<typeof MaterialInputSnapshotSchema>;
export const ExecutionInputSchema = z.union([InputSnapshotSchema, FitInputSnapshotSchema, MaterialInputSnapshotSchema]);
export const AttemptSchema = z.object({
  ...jobEntity, input_snapshot_id: uuid, status: z.enum(['active', 'completed', 'failed', 'interrupted', 'cancelled']),
  owner_token: text, lease_expires_at: timestamp, stop_generation: count, current_stage: PreparationStageSchema.nullable(),
  checkpoint_ids: z.array(uuid), started_at: timestamp, finished_at: timestamp.nullable(), cancelled_at: timestamp.nullable(),
  error: z.object({ code: text, message: z.string().min(1).max(8192) }).strict().nullable(),
  resource_usage: z.object({ model_calls: count, repair_attempts: count, elapsed_ms: count }).strict(),
}).strict();
export type Attempt = z.infer<typeof AttemptSchema>;
export const CheckpointSchema = z.object({
  ...jobEntity, attempt_id: uuid, completed_stage: PreparationStageSchema, input_fingerprint: text,
  output_fingerprint: text, output_references: z.array(ImmutableReferenceSchema), completed_at: timestamp,
}).strict();
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const ArtifactVersionSchema = z.object({
  origin: z.enum(['automatic', 'manual']).optional(),
  semantic_binding: z.object({ revision: z.number().int().nonnegative(), configuration_key: text, evaluated: z.boolean() }).strict().optional(),
  ...jobEntity, attempt_id: uuid, input_snapshot_id: uuid, input_fingerprint: text, version_fingerprint: text,
  parent_version_id: uuid.nullable(), created_at: timestamp, source: ImmutableReferenceSchema,
  pdf: ImmutableReferenceSchema.nullable(), preview: ImmutableReferenceSchema.nullable(), validation_report: ImmutableReferenceSchema.nullable(),
  validation_result: z.enum(['pending', 'passed', 'failed']),
}).strict().refine(a => a.validation_result !== 'passed' || !!(a.pdf && a.preview && a.validation_report), {
  message: 'Passed artifacts require PDF, preview and validation report references; this is not human approval.',
});
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
const reviewBinding = { artifact_version_id: uuid, artifact_fingerprint: text, input_snapshot_id: uuid, input_fingerprint: text };
export const ResumeReviewSchema = z.object({
  ...jobEntity, ...reviewBinding, reviewer_id: text, reviewed_at: timestamp, decision: z.enum(['approved', 'changes_requested']),
}).strict();
export type ResumeReview = z.infer<typeof ResumeReviewSchema>;
export const JobDraftSchema = z.object({
  ...jobEntity, revision: count, input_snapshot_id: uuid, parent_artifact_version_id: uuid.nullable(),
  candidate: DraftResumeSpecSchema, proposals: ProposalSetSchema, ...dates,
}).strict();
export type JobDraft = z.infer<typeof JobDraftSchema>;
export const JobEventSchema = z.object({
  ...jobEntity, created_at: timestamp, actor: z.object({ kind: z.enum(['user', 'worker', 'import']), id: text }).strict(),
  attempt_id: uuid.nullable(), idempotency_key: text.nullable(),
  payload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('import_history'), source_namespace: text, original_id: text,
      original_status: z.string().nullable(), resume_path: z.string().nullable(), tex_path: z.string().nullable(),
      notes: z.string().nullable(), events_json: z.string(),
    }).strict(),
    z.object({ kind: z.literal('preparation_transition'), recovery: JobRecoverySchema.optional(), from: PreparationStateSchema, to: PreparationStateSchema, reason: text }).strict(),
    z.object({ kind: z.literal('application_transition'), from: ApplicationLifecycleSchema, to: ApplicationLifecycleSchema, reason: text }).strict(),
    z.object({ kind: z.literal('proposal_review'), review_id: uuid, revision: count, generation_id: uuid, input_fingerprint: text }).strict(),
    z.object({ kind: z.literal('resume_review'), review_id: uuid, ...reviewBinding }).strict(),
    z.object({ kind: z.literal('resume_finalized'), artifact_version_id: uuid,
  parent_artifact_version_id: uuid, draft_id: uuid, draft_revision: count }).strict(),
    z.object({ kind: z.literal('channel_action'), action: z.enum(['form_draft_prepared', 'resume_attached', 'application_submitted', 'email_drafted', 'email_sent', 'survey_completed', 'user_reported_outcome']),
      channel: text, destination: text, source_type: z.enum(['user', 'posting', 'import', 'model']), timestamp,
      artifact_version_id: uuid.nullable(), confirmation_reference: text.nullable(), verification_method: text,
      status: z.enum(['unresolved', 'verified', 'user_reported']), original_notes: z.string().nullable(),
    }).strict(),
  ]),
}).strict();
export type JobEvent = z.infer<typeof JobEventSchema>;
export const WorkerControlSchema = z.object({
  ...version, workspace_id: text, revision: count, automatic_preparation_enabled: z.boolean().default(false),
  pause_after_current: z.boolean().default(false), stop_generation: count, stopped_at: timestamp.nullable(), updated_at: timestamp,
}).strict();
export type WorkerControl = z.infer<typeof WorkerControlSchema>;
