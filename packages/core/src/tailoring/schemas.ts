import { z } from 'zod';

/**
 * Data contracts for staged, skill-driven resume tailoring runs.
 *
 * Each gate has two shapes:
 * - a *model output* shape (what a runner must return; mirrored by a strict JSON Schema)
 * - a *stored* shape (model output plus user edits, decisions, and validation annotations)
 */

export const TAILORING_STEPS = ['analysis', 'alignment', 'proposals', 'brief'] as const;
export type TailoringStep = (typeof TAILORING_STEPS)[number];

// ---------------------------------------------------------------------------
// Gate 0: Job analysis
// ---------------------------------------------------------------------------

export const RequirementTierSchema = z.enum(['must', 'nice', 'vocabulary']);
export type RequirementTier = z.infer<typeof RequirementTierSchema>;

export const JobRequirementSchema = z.object({
  id: z.string().min(1),
  tier: RequirementTierSchema,
  text: z.string().min(1),
  quote: z.string(),
  /** Concrete technologies/tools/domain terms named by this requirement (e.g. "Kafka"). */
  terms: z.array(z.string()).default([]),
  /** Set by validation: quote could not be found in the posting. */
  ungrounded: z.boolean().optional(),
});
export type JobRequirement = z.infer<typeof JobRequirementSchema>;

export const JobAnalysisSchema = z.object({
  company: z.string(),
  role: z.string(),
  seniority: z.string(),
  mission: z.string(),
  requirements: z.array(JobRequirementSchema),
  boilerplate: z.array(z.string()).default([]),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

// ---------------------------------------------------------------------------
// Gate 1: Alignment matrix
// ---------------------------------------------------------------------------

export const AlignmentClassificationSchema = z.enum(['backed', 'transferable', 'gap']);
export type AlignmentClassification = z.infer<typeof AlignmentClassificationSchema>;

export const ValidationIssueSchema = z.object({
  severity: z.enum(['block', 'warn']),
  kind: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const AlignmentRowSchema = z.object({
  requirement_id: z.string().min(1),
  classification: AlignmentClassificationSchema,
  citations: z.array(z.string()).default([]),
  rationale: z.string().default(''),
  adjacent_tool: z.string().default(''),
  candidate_confirmed: z.boolean().default(false),
  issues: z.array(ValidationIssueSchema).optional(),
});
export type AlignmentRow = z.infer<typeof AlignmentRowSchema>;

export const AlignmentMatrixSchema = z.object({
  rows: z.array(AlignmentRowSchema),
});
export type AlignmentMatrix = z.infer<typeof AlignmentMatrixSchema>;

// ---------------------------------------------------------------------------
// Gate 2: Proposals
// ---------------------------------------------------------------------------

export const PROPOSAL_TYPES = [
  'summary.rewrite',
  'bullet.rewrite',
  'bullet.add',
  'bullet.drop',
  'bullet.reorder',
  'skills.reorder',
  'skills.prune',
] as const;
export const ProposalTypeSchema = z.enum(PROPOSAL_TYPES);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

export const ProposalTargetSchema = z.object({
  /** Index into base resume `experiences`, or -1 when not applicable. */
  experience_index: z.number().int().default(-1),
  /** Index into that experience's original `bullets` (insert position for bullet.add), or -1. */
  bullet_index: z.number().int().default(-1),
  /** Index into base resume `skills` groups, or -1. */
  skill_group_index: z.number().int().default(-1),
});
export type ProposalTarget = z.infer<typeof ProposalTargetSchema>;

export const ProposalDecisionSchema = z.enum(['pending', 'accepted', 'rejected']);
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>;

export const ProposalSchema = z.object({
  id: z.string().min(1),
  type: ProposalTypeSchema,
  target: ProposalTargetSchema,
  before: z.string().default(''),
  after: z.string().default(''),
  /** bullet.reorder: permutation of original bullet indices. */
  order: z.array(z.number().int()).default([]),
  /** skills.reorder: full new ordering; skills.prune: skills to remove. */
  skills: z.array(z.string()).default([]),
  citations: z.array(z.string()).default([]),
  requirement_ids: z.array(z.string()).default([]),
  rationale: z.string().default(''),
  decision: ProposalDecisionSchema.default('pending'),
  /** User-edited replacement for `after`. */
  edited_after: z.string().optional(),
  checks: z.array(ValidationIssueSchema).default([]),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const ProposalSetSchema = z.object({
  proposals: z.array(ProposalSchema),
});
export type ProposalSet = z.infer<typeof ProposalSetSchema>;

// ---------------------------------------------------------------------------
// Gate 3: Interview defensibility brief
// ---------------------------------------------------------------------------

export const DefensibilityBriefSchema = z.object({
  anchor_stories: z
    .array(
      z.object({
        title: z.string(),
        problem: z.string(),
        ownership: z.string(),
        proof: z.string(),
        citations: z.array(z.string()).default([]),
      })
    )
    .default([]),
  bridges: z
    .array(
      z.object({
        requirement_id: z.string(),
        adjacent_tool: z.string(),
        framing: z.string(),
      })
    )
    .default([]),
  gaps: z
    .array(
      z.object({
        requirement_id: z.string(),
        acknowledgement: z.string(),
        parallel_mastery: z.string(),
      })
    )
    .default([]),
});
export type DefensibilityBrief = z.infer<typeof DefensibilityBriefSchema>;

// ---------------------------------------------------------------------------
// Run manifest
// ---------------------------------------------------------------------------

export const RunStateSchema = z.enum([
  'draft',
  'analyzing',
  'analysis_ready',
  'aligning',
  'alignment_review',
  'proposing',
  'proposal_review',
  'briefing',
  'complete',
  'error',
  'cancelled',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const StepStatusSchema = z.enum(['pending', 'running', 'done', 'approved', 'stale', 'error']);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepRecordSchema = z.object({
  status: StepStatusSchema.default('pending'),
  completed_at: z.string().nullable().default(null),
  input_hash: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  raw_output: z.string().nullable().default(null),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

export const RunManifestSchema = z.object({
  slug: z.string().min(1),
  title: z.string().default(''),
  created: z.string(),
  updated: z.string(),
  runner: z.string(),
  model: z.string().default(''),
  base_resume: z.string(),
  state: RunStateSchema,
  error: z.string().nullable().default(null),
  finalized_path: z.string().nullable().default(null),
  steps: z.object({
    analysis: StepRecordSchema,
    alignment: StepRecordSchema,
    proposals: StepRecordSchema,
    brief: StepRecordSchema,
  }),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

// ---------------------------------------------------------------------------
// Strict JSON Schemas handed to runners (structured output).
// All properties required + additionalProperties:false for provider compatibility.
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

const str: JsonSchema = { type: 'string' };
const strArr: JsonSchema = { type: 'array', items: { type: 'string' } };
const intArr: JsonSchema = { type: 'array', items: { type: 'integer' } };

function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export const JOB_ANALYSIS_JSON_SCHEMA: JsonSchema = obj({
  company: str,
  role: str,
  seniority: str,
  mission: str,
  requirements: {
    type: 'array',
    items: obj({
      id: str,
      tier: { type: 'string', enum: ['must', 'nice', 'vocabulary'] },
      text: str,
      quote: str,
      terms: strArr,
    }),
  },
  boilerplate: strArr,
});

export const ALIGNMENT_JSON_SCHEMA: JsonSchema = obj({
  rows: {
    type: 'array',
    items: obj({
      requirement_id: str,
      classification: { type: 'string', enum: ['backed', 'transferable', 'gap'] },
      citations: strArr,
      rationale: str,
      adjacent_tool: str,
    }),
  },
});

export const PROPOSALS_JSON_SCHEMA: JsonSchema = obj({
  proposals: {
    type: 'array',
    items: obj({
      id: str,
      type: { type: 'string', enum: [...PROPOSAL_TYPES] },
      target: obj({
        experience_index: { type: 'integer' },
        bullet_index: { type: 'integer' },
        skill_group_index: { type: 'integer' },
      }),
      before: str,
      after: str,
      order: intArr,
      skills: strArr,
      citations: strArr,
      requirement_ids: strArr,
      rationale: str,
    }),
  },
});

export const BRIEF_JSON_SCHEMA: JsonSchema = obj({
  anchor_stories: {
    type: 'array',
    items: obj({ title: str, problem: str, ownership: str, proof: str, citations: strArr }),
  },
  bridges: {
    type: 'array',
    items: obj({ requirement_id: str, adjacent_tool: str, framing: str }),
  },
  gaps: {
    type: 'array',
    items: obj({ requirement_id: str, acknowledgement: str, parallel_mastery: str }),
  },
});

export const STEP_JSON_SCHEMAS: Record<TailoringStep, JsonSchema> = {
  analysis: JOB_ANALYSIS_JSON_SCHEMA,
  alignment: ALIGNMENT_JSON_SCHEMA,
  proposals: PROPOSALS_JSON_SCHEMA,
  brief: BRIEF_JSON_SCHEMA,
};
