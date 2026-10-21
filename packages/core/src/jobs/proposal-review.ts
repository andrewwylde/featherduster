import { checkCandidateFields } from './candidate-checks.js';
import { applyCandidateProposals } from './preparation.js';
import type { ProposalValidationContext } from '../tailoring/validators.js';
import type { PrivacyRulesConfig } from '../schemas/privacy.js';
import { z } from 'zod';
import { SourceSupportSchema } from '../corpus/schemas.js';
import { ResumeSpecSchema } from '../schemas/resume.js';
import { ProposalSchema, ValidationIssueSchema, type Proposal, type ValidationIssue } from '../tailoring/schemas.js';
import { ImmutableReferenceSchema } from './schemas.js';

const text = z.string().min(1);
const uuid = z.string().uuid();
const revision = z.number().int().nonnegative();
const binding = { schema_version: z.literal(1), workspace_id: text, job_id: uuid, input_snapshot_id: uuid, input_fingerprint: text };
const strictProposal = ProposalSchema.extend({ target: ProposalSchema.shape.target.strict(), checks: z.array(ValidationIssueSchema.strict()) }).strict();
export const ProposalGenerationSchema = z.object({
  ...binding, id: uuid, attempt_id: uuid, raw_output: ImmutableReferenceSchema,
  proposals: z.object({ proposals: z.array(strictProposal) }).strict(), created_at: z.string().datetime(),
}).strict().refine(g => new Set(g.proposals.proposals.map(p => p.id)).size === g.proposals.proposals.length, 'Proposal IDs must be unique');
export type ProposalGeneration = z.infer<typeof ProposalGenerationSchema>;
export const ProposalPatchSchema = z.object({
  proposal_id: text, edited_after: z.string().optional(), citations: z.array(text).optional(), decision: z.enum(['pending', 'rejected']).optional(),
  order: z.array(z.number().int()).optional(), skills: z.array(text).optional(),
}).strict().refine(p => p.edited_after !== undefined || p.citations !== undefined || p.decision !== undefined || p.order !== undefined || p.skills !== undefined, 'Empty patch');
export type ProposalPatch = z.infer<typeof ProposalPatchSchema>;
export const ClaimGroundingSchema = z.object({
  id: uuid, review_id: uuid, review_revision: revision, proposal_id: text, claim_fingerprint: text,
  term: text, sources: z.array(SourceSupportSchema).min(1), explanation: text,
  recorded_by: text, recorded_at: z.string().datetime(),
}).strict();
export type ClaimGrounding = z.infer<typeof ClaimGroundingSchema>;
export const BASE_TEXT_PATH = /^(summary|experiences\.(0|[1-9]\d*)\.bullets\.(0|[1-9]\d*)\.text)$/;
export const BASE_TEXT_MAX = 8192;
/** Identifies the employer entry a bullet correction belongs to, independent of its position. */
export const ExperienceAnchorSchema = z.object({ company: z.string(), role: z.string(), startDate: z.string() }).strict();
/** A job-local starting-resume edit; `before` is the captured text it replaces. Older records have no anchor. */
export const BaseCorrectionSchema = z.object({
  path: z.string().regex(BASE_TEXT_PATH), before: z.string(), after: text.max(BASE_TEXT_MAX), anchor: ExperienceAnchorSchema.optional(), recorded_by: text, recorded_at: z.string().datetime(),
}).strict();
export type BaseCorrection = z.infer<typeof BaseCorrectionSchema>;
export function baseText(base: z.infer<typeof ResumeSpecSchema>, path: string): string | undefined {
  const match = BASE_TEXT_PATH.exec(path);
  if (!match) return undefined;
  return path === 'summary' ? base.summary ?? '' : base.experiences[Number(match[2])]?.bullets[Number(match[3])]?.text;
}
export function experienceAnchor(base: z.infer<typeof ResumeSpecSchema>, path: string): BaseCorrection['anchor'] {
  const match = BASE_TEXT_PATH.exec(path);
  const e = match && path !== 'summary' ? base.experiences[Number(match[2])] : undefined;
  return e ? { company: e.company, role: e.role, startDate: e.startDate } : undefined;
}
/**
 * Locates a correction in newly captured base wording. Anchored bullets are found by employer, then by
 * their captured text; wording the shared resume already adopted needs no overlay, and anything ambiguous
 * or changed is unapplied rather than guessed.
 */
export function relocateBaseCorrection(base: z.infer<typeof ResumeSpecSchema>, c: BaseCorrection): { status: 'carried'; correction: BaseCorrection } | { status: 'already_shared' | 'unapplied' } {
  const carried = (path: string) => ({ status: 'carried' as const, correction: { ...structuredClone(c), path } });
  if (c.path === 'summary' || !c.anchor) { const t = baseText(base, c.path); return t === c.before ? carried(c.path) : { status: t === c.after ? 'already_shared' : 'unapplied' }; }
  const anchor = c.anchor;
  const experiences = base.experiences.flatMap((e, i) => e.company === anchor.company && e.role === anchor.role && e.startDate === anchor.startDate ? [i] : []);
  if (experiences.length !== 1) return { status: 'unapplied' };
  const ei = experiences[0], original = Number(BASE_TEXT_PATH.exec(c.path)![3]);
  const bullets = base.experiences[ei].bullets.flatMap((b, i) => b.text === c.before ? [i] : []);
  const bi = bullets.length === 1 ? bullets[0] : bullets.includes(original) ? original : undefined;
  if (bi !== undefined) return carried(`experiences.${ei}.bullets.${bi}.text`);
  return { status: base.experiences[ei].bullets.some(b => b.text === c.after) ? 'already_shared' : 'unapplied' };
}
/** Captured base plus the review's job-local corrections; the captured snapshot itself never changes. */
export function effectiveBaseResume(base: z.infer<typeof ResumeSpecSchema>, review: { base_corrections?: BaseCorrection[] }) {
  const result = structuredClone(base);
  for (const c of review.base_corrections ?? []) {
    if (baseText(result, c.path) !== c.before) throw new Error(`Starting-resume correction no longer matches ${c.path}`);
    const match = BASE_TEXT_PATH.exec(c.path)!;
    if (c.path === 'summary') result.summary = c.after;
    else result.experiences[Number(match[2])].bullets[Number(match[3])].text = c.after;
  }
  return result;
}
export const ProposalIssueSchema = z.object({
  id: text, subject: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('proposal'), proposal_id: text }).strict(),
    z.object({ kind: z.literal('candidate'), path: text }).strict(),
  ]), group: text, action: z.enum(['edit_proposal', 'refresh_base']), details: z.array(ValidationIssueSchema.strict()).min(1),
}).strict();
export type ProposalIssue = z.infer<typeof ProposalIssueSchema>;
export const ProposalReviewValidationSchema = z.object({
  authority: z.literal('server'), version: text, fingerprint: text, input_fingerprint: text,
  generation_id: uuid, review_revision: revision, status: z.enum(['ready', 'blocked']), issues: z.array(ProposalIssueSchema),
}).strict().refine(v => v.status !== 'ready' || !v.issues.some(i => i.details.some(d => d.severity === 'block')), 'Blocked validation cannot be ready');
export const ProposalReviewRevisionSchema = z.object({
  ...binding, id: uuid, generation_id: uuid, revision, patches: z.array(ProposalPatchSchema), groundings: z.array(ClaimGroundingSchema),
  base_corrections: z.array(BaseCorrectionSchema).optional(),
  feedback_ids: z.array(uuid), corpus_update_ids: z.array(uuid), candidate_preview: ResumeSpecSchema,
  validation: ProposalReviewValidationSchema, created_at: z.string().datetime(),
}).strict().superRefine((r, ctx) => {
  if (r.validation.generation_id !== r.generation_id || r.validation.input_fingerprint !== r.input_fingerprint || r.validation.review_revision !== r.revision || r.groundings.some(g => g.review_id !== r.id || g.review_revision !== r.revision)) ctx.addIssue({ code: 'custom', message: 'Review validation/grounding binding mismatch' });
  if (new Set(r.patches.map(p => p.proposal_id)).size !== r.patches.length) ctx.addIssue({ code: 'custom', message: 'Duplicate patch' });
  if (new Set(r.base_corrections?.map(c => c.path)).size !== (r.base_corrections?.length ?? 0)) ctx.addIssue({ code: 'custom', message: 'Duplicate starting-resume correction' });
});
export type ProposalReviewRevision = z.infer<typeof ProposalReviewRevisionSchema>;

/** Run once at ingestion, before publishing immutable generation metadata. */
export function normalizeGenerationProposals(values: unknown[]): Proposal[] {
  const used = new Set<string>();
  const reserved = new Set(values.map(v => (v as { id?: unknown })?.id).filter((v): v is string => typeof v === 'string' && !!v.trim()));
  return values.map((value, index) => {
    const raw = value as Record<string, unknown>;
    let id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || used.has(id)) { id = `proposal-${index + 1}`; while (used.has(id) || reserved.has(id)) id += '-normalized'; }
    used.add(id);
    return ProposalSchema.parse({ ...raw, id, decision: 'pending', edited_after: undefined, checks: [] });
  });
}

/** Rebuild from immutable generation + saved overlay + incoming edits; never accept authority fields. */
export function applyProposalPatches(generation: Proposal[], current: ProposalPatch[], incoming: ProposalPatch[], groundings: ClaimGrounding[] = [], sourceVersions?: ReadonlyMap<string, string>) {
  const ids = new Set(generation.map(p => p.id));
  const overlay = new Map<string, ProposalPatch>();
  const changed = new Set<string>();
  for (const [batch, isIncoming] of [[current, false], [incoming, true]] as const) {
    const seen = new Set<string>();
    for (const raw of batch) {
      const patch = ProposalPatchSchema.parse(raw);
      if (!ids.has(patch.proposal_id) || seen.has(patch.proposal_id)) throw new Error('Unknown or duplicate proposal ID');
      seen.add(patch.proposal_id);
      const original = generation.find(p => p.id === patch.proposal_id)!;
      if ((patch.order && original.type !== 'bullet.reorder') || (patch.skills && original.type !== 'skills.reorder')) throw new Error('Structural overlay does not match the original proposal type');
      const previous = overlay.get(patch.proposal_id);
      if (isIncoming && ((patch.edited_after !== undefined && patch.edited_after !== (previous?.edited_after ?? original.after)) || (patch.citations !== undefined && JSON.stringify(patch.citations) !== JSON.stringify(previous?.citations ?? original.citations)))) changed.add(patch.proposal_id);
      overlay.set(patch.proposal_id, { ...previous, ...patch });
    }
  }
  return {
    proposals: generation.map(p => { const { proposal_id: _, ...patch } = overlay.get(p.id) ?? { proposal_id: p.id }; return { ...structuredClone(p), decision: 'pending' as const, ...structuredClone(patch), checks: [] }; }),
    patches: [...overlay.values()].map(p => structuredClone(p)),
    groundings: structuredClone(groundings.filter(g => !changed.has(g.proposal_id) && (!sourceVersions || g.sources.every(s => sourceVersions.get(s.evidence_id) === s.evidence_fingerprint)))),
  };
}
export function normalizeProposalIssues(items: { subject: ProposalIssue['subject']; issues: ValidationIssue[] }[]): ProposalIssue[] {
  const result = new Map<string, ProposalIssue>();
  for (const { subject, issues } of items) for (const detail of issues) {
    const group = ['ledger_ceiling', 'unsupported_experience', 'unsupported_citation'].includes(detail.kind) ? 'grounding' : detail.kind;
    const key = JSON.stringify([subject, group]);
    const existing = result.get(key);
    if (existing) existing.details.push(structuredClone(detail));
    else result.set(key, { id: key, subject: structuredClone(subject), group, action: subject.kind === 'proposal' ? 'edit_proposal' : 'refresh_base', details: [structuredClone(detail)] });
  }
  return [...result.values()];
}
export function detectProposalConflicts(proposals: Proposal[]): ProposalIssue[] {
  const targets = new Map<string, Proposal[]>();
  for (const p of proposals.filter(p => p.decision !== 'rejected')) {
    const key = p.type === 'summary.rewrite' ? 'summary' : ['bullet.rewrite', 'bullet.drop'].includes(p.type) ? `bullet:${p.target.experience_index}:${p.target.bullet_index}` : p.type === 'bullet.reorder' ? `order:${p.target.experience_index}` : p.type === 'skills.reorder' ? `skills:${p.target.skill_group_index}` : null;
    if (key) targets.set(key, [...(targets.get(key) ?? []), p]);
  }
  return normalizeProposalIssues([...targets.values()].filter(ps => ps.length > 1).flatMap(ps => ps.map(p => ({ subject: { kind: 'proposal' as const, proposal_id: p.id }, issues: [{ severity: 'block' as const, kind: 'target_conflict', message: `Competing edits: ${ps.map(p => p.id).join(', ')}` }] }))));
}

/** Review boundary: checks are freshly derived, including fields retained after rejection. */
export function validateProposalReview(base: z.infer<typeof ResumeSpecSchema>, proposals: Proposal[], context: Omit<ProposalValidationContext, 'baseResume'>, rules?: PrivacyRulesConfig, supportFor?: (proposal: Proposal) => ProposalValidationContext['skillSupport']) {
  const result = applyCandidateProposals(base, proposals.map(p => ({ ...p, checks: [] })), context, supportFor);
  const items: Parameters<typeof normalizeProposalIssues>[0] = result.proposals.filter(p => p.decision !== 'rejected').map(p => ({ subject: { kind: 'proposal', proposal_id: p.id }, issues: p.checks }));
const candidateIssues = checkCandidateFields(result.candidate,
  result.proposals.filter(p => result.appliedProposalIds.includes(p.id)),
  { ...context, baseResume: result.candidate }, rules, supportFor);
for (const i of candidateIssues) items.push({ subject: { kind: 'candidate', path: i.path },
  issues: [{ kind: i.code, severity: i.severity, message: i.message }] });

  const issues = [...normalizeProposalIssues(items), ...detectProposalConflicts(proposals)];
  return { ...result, issues, valid: !issues.some(i => i.details.some(d => d.severity === 'block')) };
}
