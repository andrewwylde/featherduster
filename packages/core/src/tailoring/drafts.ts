import { z } from 'zod';
import { ResumeSpecSchema } from '../schemas/resume.js';
import {
  AlignmentClassificationSchema, DefensibilityBriefSchema, JobAnalysisSchema,
  AlignmentMatrixSchema, ProposalSetSchema, ProposalDecisionSchema, ProposalTargetSchema,
  ProposalTypeSchema, RequirementTierSchema, RunManifestSchema,
} from './schemas.js';

/** Recovery validates shape, not readiness to approve or generate an artifact. */
export const DRAFT_MAX_TEXT_LENGTH = 262_144;
const text = z.string().max(DRAFT_MAX_TEXT_LENGTH);
const id = z.string().min(1).max(512);
const timestamp = z.string().datetime({ offset: true });
const strings = z.array(text).max(10_000);
function checkSnapshotStrings(value: unknown, ctx: z.RefinementCtx): void {
  const visit = (item: unknown, path: (string | number)[]): void => {
    if (typeof item === 'string' && item.length > DRAFT_MAX_TEXT_LENGTH) {
      ctx.addIssue({ code: 'custom', path, message: `Recovery strings must not exceed ${DRAFT_MAX_TEXT_LENGTH} characters` });
    } else if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, [...path, index]));
    } else if (item !== null && typeof item === 'object') {
      Object.entries(item).forEach(([key, entry]) => visit(entry, [...path, key]));
    }
  };
  visit(value, []);
}
const snapshotSpec = ResumeSpecSchema.superRefine(checkSnapshotStrings);
export const DraftKindSchema = z.enum(['setup', 'run', 'manual']);
export type DraftKind = z.infer<typeof DraftKindSchema>;
export const DraftLifecycleSchema = z.enum(['draft', 'completed', 'discarded']);
export type DraftLifecycle = z.infer<typeof DraftLifecycleSchema>;
export const DraftRevisionTokenSchema = z.object({ revision: z.number().int().nonnegative().safe(), fingerprint: id }).strict();
export type DraftRevisionToken = z.infer<typeof DraftRevisionTokenSchema>;
export type RevisionToken = DraftRevisionToken;
export const DraftContextSchema = z.object({
  activeStep: z.enum(['analysis', 'alignment', 'proposals', 'brief']).optional(),
  selectedProposalId: id.optional(), editingProposalId: id.optional(),
  mobilePane: z.enum(['steps', 'work', 'context', 'bullets', 'matcher']).optional(),
  diffMode: z.enum(['side-by-side', 'unified']).optional(),
}).strict();
export type DraftContext = z.infer<typeof DraftContextSchema>;
export const SetupPayloadSchema = z.object({ posting: text, label: text, baseResumeId: text, runner: text }).strict();
export const SetupDraftPayloadSchema = SetupPayloadSchema;
export type SetupPayload = z.infer<typeof SetupPayloadSchema>;
export type SetupDraftPayload = SetupPayload;

const issue = z.object({ severity: z.enum(['block', 'warn']), kind: text, message: text }).strict();
export const DraftAnalysisSchema = z.object({
  company: text, role: text, seniority: text, mission: text,
  requirements: z.array(z.object({ id, tier: RequirementTierSchema, text, quote: text, terms: strings.default([]), ungrounded: z.boolean().optional() }).strict()).max(10_000),
  boilerplate: strings.default([]),
}).strict();
export type DraftAnalysis = z.infer<typeof DraftAnalysisSchema>;
export const DraftAlignmentSchema = z.object({ rows: z.array(z.object({
  requirement_id: id, classification: AlignmentClassificationSchema,
  citations: strings.default([]), rationale: text.default(''), adjacent_tool: text.default(''),
  candidate_confirmed: z.boolean().default(false), issues: z.array(issue).max(10_000).optional(),
}).strict()).max(10_000) }).strict();
export type DraftAlignment = z.infer<typeof DraftAlignmentSchema>;
export const DraftProposalsSchema = z.object({ proposals: z.array(z.object({
  id, type: ProposalTypeSchema, target: ProposalTargetSchema.strict(),
  before: text.default(''), after: text.default(''), order: z.array(z.number().int()).max(10_000).default([]),
  skills: strings.default([]), citations: strings.default([]), requirement_ids: strings.default([]),
  rationale: text.default(''), decision: ProposalDecisionSchema.default('pending'),
  edited_after: text.optional(), override: z.boolean().optional(), checks: z.array(issue).max(10_000).default([]),
}).strict()).max(10_000) }).strict();
export type DraftProposals = z.infer<typeof DraftProposalsSchema>;
export const DraftAppliedContentSchema = z.object({
  analysis: DraftAnalysisSchema.optional(), alignment: DraftAlignmentSchema.optional(), proposals: DraftProposalsSchema.optional(),
}).strict();
export type DraftAppliedContent = z.infer<typeof DraftAppliedContentSchema>;
export const DraftArtifactTokensSchema = z.object({
  analysis: DraftRevisionTokenSchema.optional(), alignment: DraftRevisionTokenSchema.optional(),
  proposals: DraftRevisionTokenSchema.optional(), brief: DraftRevisionTokenSchema.optional(),
}).strict();
export type DraftArtifactTokens = z.infer<typeof DraftArtifactTokensSchema>;
export const RunDraftPayloadSchema = DraftAppliedContentSchema.extend({
  proposalTextById: z.record(id, text).default({}), artifactTokens: DraftArtifactTokensSchema.default({}),
}).strict();
export type RunDraftPayload = z.infer<typeof RunDraftPayloadSchema>;

export const ManualDraftPayloadSchema = z.object({
  profile: z.object({ name: text, title: text, email: text, phone: text.optional(), location: text.optional(), links: z.record(z.string().max(512), text.optional()).optional() }).strict(),
  summary: text,
  experiences: z.array(z.object({
    id, company: text, role: text, location: text.optional(), startDate: text, endDate: text,
    bullets: z.array(z.object({ id, text, citations: strings.optional(), included: z.boolean() }).strict()).max(10_000),
  }).strict()).max(10_000),
  education: z.array(z.object({ institution: text, degree: text, year: text, details: text.optional() }).strict()).max(10_000),
  skills: z.array(z.object({ category: text, skills: strings }).strict()).max(10_000),
  jobDescription: text, selectedResumeId: text, squeezeMode: z.boolean(),
}).strict();
export type ManualDraftPayload = z.infer<typeof ManualDraftPayloadSchema>;
export const DraftPayloadSchema = z.union([SetupPayloadSchema, RunDraftPayloadSchema, ManualDraftPayloadSchema]);
export type DraftPayload = z.infer<typeof DraftPayloadSchema>;

// Validated snapshots retain the real artifact schemas; editable text uses the relaxed schemas above.
// Recovery owns this annotation even when the workflow schema does not yet declare it.
const snapshotProposals = ProposalSetSchema.extend({
  proposals: z.array(ProposalSetSchema.shape.proposals.element.extend({ override: z.boolean().optional() })),
}).superRefine(checkSnapshotStrings);
export const DraftBaseSchema = z.object({ resumeId: id, spec: snapshotSpec, fingerprint: id }).strict();
export type DraftBase = z.infer<typeof DraftBaseSchema>;
export const DraftRunArtifactsSchema = z.object({
  briefMarkdown: text.optional(), posting: text, manifest: RunManifestSchema.superRefine(checkSnapshotStrings), base: DraftBaseSchema,
  analysis: JobAnalysisSchema.superRefine(checkSnapshotStrings).optional(), alignment: AlignmentMatrixSchema.superRefine(checkSnapshotStrings).optional(),
  proposals: snapshotProposals.optional(), brief: DefensibilityBriefSchema.superRefine(checkSnapshotStrings).optional(),
}).strict();
export type DraftRunArtifacts = z.infer<typeof DraftRunArtifactsSchema>;
export const DraftCompletionSchema = z.object({
  outputId: id, name: text.optional(), type: z.enum(['template', 'tailored']).optional(), path: text.min(1), completedAt: timestamp, spec: snapshotSpec,
  runArtifacts: DraftRunArtifactsSchema.optional(),
}).strict();
export type DraftCompletion = z.infer<typeof DraftCompletionSchema>;
const common = {
  schemaVersion: z.literal(1), id: z.string().uuid(), lifecycle: DraftLifecycleSchema,
  revision: z.number().int().nonnegative().safe(), createdAt: timestamp, editedAt: timestamp, savedAt: timestamp,
  runSlug: id.optional(), parentCompletionId: id.optional(), context: DraftContextSchema.default({}),
  appliedContent: DraftAppliedContentSchema.default({}), completion: DraftCompletionSchema.optional(),
};
export const DraftRecordSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('setup'), base: DraftBaseSchema.nullable(), payload: SetupPayloadSchema }).strict(),
  z.object({ ...common, kind: z.literal('run'), base: DraftBaseSchema, payload: RunDraftPayloadSchema, originSetup: SetupPayloadSchema.optional(), legacyBaseNotice: text.optional(), upstreamSync: z.object({
    candidate: snapshotSpec, previous: DraftRunArtifactsSchema, previousAppliedContent: DraftAppliedContentSchema,
    reviewProposalIds: strings, staleSteps: z.array(z.enum(['alignment', 'proposals', 'brief'])),
  }).strict().optional() }).strict(),
  z.object({ ...common, kind: z.literal('manual'), base: DraftBaseSchema, payload: ManualDraftPayloadSchema }).strict(),
]);
export type DraftRecord = z.infer<typeof DraftRecordSchema>;
export const DraftEnvelopeSchema = z.object({ record: DraftRecordSchema, token: DraftRevisionTokenSchema }).strict();
export type DraftEnvelope = z.infer<typeof DraftEnvelopeSchema>;
export const DraftAcknowledgementSchema = DraftEnvelopeSchema.extend({ mutationId: id }).strict();
export type DraftAcknowledgement = z.infer<typeof DraftAcknowledgementSchema>;
export const DraftUpdateSchema = z.object({
  expected: DraftRevisionTokenSchema, mutationId: id, change: z.enum(['content', 'context']),
  payload: DraftPayloadSchema.optional(), context: DraftContextSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.change === 'content' && value.payload === undefined) ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Content updates require a payload' });
  if (value.change === 'context' && (value.context === undefined || value.payload !== undefined)) ctx.addIssue({ code: 'custom', message: 'Context updates require context and cannot change payload' });
});
export type DraftUpdate = z.infer<typeof DraftUpdateSchema>;
