import { z } from 'zod';
import { EvidenceEntrySchema, ConfidenceLevelSchema, MetricEntrySchema, InternalReferenceSchema } from '../schemas/evidence.js';

const id = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().trim().min(1);
const revision = z.number().finite().int().nonnegative();

export const CorpusScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }).strict(),
  z.object({ kind: z.enum(['employer', 'project', 'role', 'job']), key: text }).strict(),
]);
export const SourceSupportSchema = z.object({
  evidence_id: text, evidence_fingerprint: hash, quote: text,
  // Captured by the server, not evidence of authority supplied by a model.
  // Legacy bindings without status cannot be rebound after source edits.
  source_status: z.object({ confidence: ConfidenceLevelSchema, in_flight: z.boolean() }).strict().optional(),
}).strict();
export const SkillSupportSchema = z.object({
  skill: text, facet: text, permitted_terms: z.array(text).min(1),
  support: z.enum(['direct', 'transferable', 'unsupported']),
  scope: CorpusScopeSchema, sources: z.array(SourceSupportSchema).min(1), explanation: text,
}).strict();
export const EvidenceAmendmentSchema = z.object({
  evidence_id: text, base_fingerprint: hash,
  entry: EvidenceEntrySchema.extend({
    metrics: z.array(MetricEntrySchema.strict()).default([]),
    internal_references: z.array(InternalReferenceSchema.strict()).default([]),
  }).strict(),
  narrative: z.string(), confirmation_basis: z.literal('user_confirmed'), explanation: text,
}).strict().refine(a => a.entry.id === a.evidence_id, 'Evidence identity cannot change');
export const CorpusChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill_support'), value: SkillSupportSchema }).strict(),
  z.object({ kind: z.literal('evidence_amendment'), value: EvidenceAmendmentSchema }).strict(),
  z.object({ kind: z.literal('withdrawal'), update_id: id, reason: text }).strict(),
]);
export const FeedbackEventSchema = z.object({
  schema_version: z.literal(1), id, workspace_id: text,
  job_id: id.nullable(), proposal_id: text.nullable(), review_revision: revision.nullable(),
  kind: z.enum(['wording', 'citation', 'grounding', 'fact', 'unsupported', 'relevance', 'rejection']),
  before: z.string(), after: z.string(), explanation: z.string(), scope: CorpusScopeSchema,
  recorded_by: text, recorded_at: z.string().datetime(),
}).strict();
export const CorpusUpdateSchema = z.object({
  schema_version: z.literal(1), id, workspace_id: text, revision,
  feedback_id: id, supersedes: id.nullable(), change: CorpusChangeSchema, recorded_at: z.string().datetime(),
}).strict();
export const CorpusSnapshotSchema = z.object({
  schema_version: z.literal(1), revision, updates: z.array(CorpusUpdateSchema),
  materialized: z.object({
    support: z.array(SkillSupportSchema),
    sources: z.array(z.object({ entry: EvidenceEntrySchema, narrative: z.string() }).strict()),
  }).strict().optional(),
}).strict();

export type CorpusScope = z.infer<typeof CorpusScopeSchema>;
export type SourceSupport = z.infer<typeof SourceSupportSchema>;
export type SkillSupport = z.infer<typeof SkillSupportSchema>;
export type EvidenceAmendment = z.infer<typeof EvidenceAmendmentSchema>;
export type CorpusChange = z.infer<typeof CorpusChangeSchema>;
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;
export type CorpusUpdate = z.infer<typeof CorpusUpdateSchema>;
export type CorpusSnapshot = z.infer<typeof CorpusSnapshotSchema>;
