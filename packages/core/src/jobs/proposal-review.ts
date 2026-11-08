import { checkCandidateFields } from './candidate-checks.js';
import { overlappingProposalIds, originalPassagePath, proposalForPassage } from '../tailoring/operations.js';
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
  generation_policy: z.string().optional(),
  ...binding, id: uuid, attempt_id: uuid, raw_output: ImmutableReferenceSchema,
  proposals: z.object({ proposals: z.array(strictProposal) }).strict(), created_at: z.string().datetime(),
}).strict().refine(g => new Set(g.proposals.proposals.map(p => p.id)).size === g.proposals.proposals.length, 'Proposal IDs must be unique');
export type ProposalGeneration = z.infer<typeof ProposalGenerationSchema>;
export const ExperienceAnchorSchema = z.object({ company: z.string(), role: z.string(), startDate: z.string() }).strict();
export const AccomplishmentOmissionSchema = z.object({
  experience_index: z.number().int().nonnegative(), anchor: ExperienceAnchorSchema, text,
  replaces_proposal_id: text.optional(),
  source_bullets: z.array(z.object({ bullet_index: z.number().int().nonnegative(), before: text }).strict()),
}).strict();
export const ProposalPatchSchema = z.object({
  proposal_id: text, omission: AccomplishmentOmissionSchema.optional(), edited_after: z.string().optional(), citations: z.array(text).optional(), decision: z.enum(['pending', 'rejected']).optional(),
  order: z.array(z.number().int()).optional(), skills: z.array(text).optional(),
}).strict().refine(p => p.edited_after !== undefined || p.citations !== undefined || p.decision !== undefined || p.order !== undefined || p.skills !== undefined || p.omission !== undefined, 'Empty patch');
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
/** A job-local starting-resume edit; `before` is the captured text it replaces. Older records have no anchor. */
export const BaseCorrectionSchema = z.object({
  path: z.string().regex(BASE_TEXT_PATH), before: z.string(), after: text.max(BASE_TEXT_MAX), anchor: ExperienceAnchorSchema.optional(), recorded_by: text, recorded_at: z.string().datetime(),
  before_citations: z.array(text).optional(), citations: z.array(text).optional(),
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
    else {
      const bullet = result.experiences[Number(match[2])].bullets[Number(match[3])];
      if (c.before_citations && JSON.stringify(bullet.citations ?? []) !== JSON.stringify(c.before_citations)) throw new Error(`Starting source mappings no longer match ${c.path}`);
      bullet.text = c.after;
      if (c.citations) bullet.citations = [...c.citations];
    }
  }
  return result;
}
export function textFingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return 'fp_' + (hash >>> 0).toString(16);
}

export const ReviewFindingTargetSchema = z.object({
  scope: z.enum(['retained_baseline', 'draft_candidate', 'generated_patch']),
  text: z.string(),
  text_fingerprint: z.string(),
  span: z.tuple([z.number(), z.number()]).optional(),
  revision: z.number().int().nonnegative(),
}).strict();
export type ReviewFindingTarget = z.infer<typeof ReviewFindingTargetSchema>;

export const BoundReviewFindingSchema = z.object({
  issueKey: z.string(),
  message: z.string(),
  target: ReviewFindingTargetSchema,
  draft_revision: z.number().int().nonnegative(),
  preview_text: z.string(),
  is_stale_for_preview: z.boolean(),
}).strict();
export type BoundReviewFinding = z.infer<typeof BoundReviewFindingSchema>;

export function createReviewFindingTarget(params: {
  scope: 'retained_baseline' | 'draft_candidate' | 'generated_patch';
  text: string;
  text_fingerprint?: string;
  span?: [number, number];
  revision: number;
}): ReviewFindingTarget {
  return ReviewFindingTargetSchema.parse({
    scope: params.scope,
    text: params.text,
    text_fingerprint: params.text_fingerprint ?? textFingerprint(params.text),
    span: params.span,
    revision: params.revision,
  });
}

export function isFindingStaleForPreview(
  target: ReviewFindingTarget,
  previewText: string,
  previewFingerprint?: string
): boolean {
  if (target.text === previewText) return false;
  if (previewFingerprint && target.text_fingerprint === previewFingerprint) return false;
  if (target.text_fingerprint === textFingerprint(previewText)) return false;
  return true;
}

export function bindReviewFinding(input: {
  issueKey: string;
  message: string;
  target: {
    scope: 'retained_baseline' | 'draft_candidate' | 'generated_patch';
    text: string;
    text_fingerprint?: string;
    span?: [number, number];
    revision?: number;
  };
  draft_revision: number;
  preview_text: string;
}): BoundReviewFinding {
  const target = ReviewFindingTargetSchema.parse({
    scope: input.target.scope,
    text: input.target.text,
    text_fingerprint: input.target.text_fingerprint ?? textFingerprint(input.target.text),
    span: input.target.span,
    revision: input.target.revision ?? input.draft_revision,
  });
  return BoundReviewFindingSchema.parse({
    issueKey: input.issueKey,
    message: input.message,
    target,
    draft_revision: input.draft_revision,
    preview_text: input.preview_text,
    is_stale_for_preview: isFindingStaleForPreview(target, input.preview_text),
  });
}

export const ProposalIssueSchema = z.object({
  id: text, subject: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('proposal'), proposal_id: text }).strict(),
    z.object({ kind: z.literal('candidate'), path: text }).strict(),
  ]), group: text, action: z.enum(['edit_proposal', 'refresh_base']),
  target: ReviewFindingTargetSchema.optional(),
  details: z.array(ValidationIssueSchema.strict()).min(1),
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
      const previous = overlay.get(patch.proposal_id);
      const omission = patch.omission ?? previous?.omission;
      if ((!ids.has(patch.proposal_id) && !omission) || seen.has(patch.proposal_id)) throw new Error('Unknown or duplicate proposal ID');
      if (omission) {
        if (ids.has(patch.proposal_id) || !patch.proposal_id.startsWith('user-omission:') || Object.keys(patch).some(k => !['proposal_id', 'omission', 'decision'].includes(k))) throw new Error('Invalid omission patch');
        if (previous?.omission && patch.omission && JSON.stringify(previous.omission) !== JSON.stringify(patch.omission)) throw new Error('Omission targets are immutable');
        seen.add(patch.proposal_id); overlay.set(patch.proposal_id, { ...previous, ...patch }); continue;
      }
      seen.add(patch.proposal_id);
      const original = generation.find(p => p.id === patch.proposal_id)!;
      if ((patch.order && original.type !== 'bullet.reorder') || (patch.skills && original.type !== 'skills.reorder')) throw new Error('Structural overlay does not match the original proposal type');
      if (isIncoming && ((patch.edited_after !== undefined && patch.edited_after !== (previous?.edited_after ?? original.after)) || (patch.citations !== undefined && JSON.stringify(patch.citations) !== JSON.stringify(previous?.citations ?? original.citations)))) changed.add(patch.proposal_id);
      overlay.set(patch.proposal_id, { ...previous, ...patch });
    }
  }
  const proposals: Proposal[] = generation.map(p => { const { proposal_id: _, omission: _omission, ...patch } = overlay.get(p.id) ?? { proposal_id: p.id }; return { ...structuredClone(p), decision: 'pending' as const, ...structuredClone(patch), ...(patch.edited_after !== undefined || patch.citations !== undefined ? { claim_bindings: undefined } : {}), checks: [] }; });
  const omitted = new Set<string>();
  for (const patch of overlay.values()) {
    const o = patch.omission;
    if (!o || patch.decision === 'rejected') continue;
    const original = o.replaces_proposal_id ? proposals.find(p => p.id === o.replaces_proposal_id) : undefined;
    if (o.replaces_proposal_id) {
      if (!original || !['bullet.add', 'bullet.rewrite', 'bullet.consolidate'].includes(original.type) || original.target.experience_index !== o.experience_index
        || (original.edited_after ?? original.after) !== o.text || omitted.has(original.id)) throw new Error('Omitted accomplishment no longer matches its proposal');
      const expected = original.type === 'bullet.add' ? [] : original.type === 'bullet.consolidate' ? original.source_bullets! : [{ bullet_index: original.target.bullet_index, before: original.before }];
      if (JSON.stringify(expected.map(s => s.bullet_index).sort((a,b) => a - b)) !== JSON.stringify(o.source_bullets.map(s => s.bullet_index).sort((a,b) => a - b))) throw new Error('Omission must cover exactly the original accomplishment targets');
      original.decision = 'rejected'; omitted.add(original.id);
    } else if (o.source_bullets.length !== 1 || o.source_bullets[0].before !== o.text) throw new Error('A starting-resume omission must bind one exact original bullet');
    for (const source of o.source_bullets) {
      const id = `${patch.proposal_id}:${source.bullet_index}`;
      if (proposals.some(p => p.id === id)) throw new Error('Duplicate omission operation');
      proposals.push(ProposalSchema.parse({ id, type: 'bullet.drop', target: { experience_index: o.experience_index, bullet_index: source.bullet_index }, before: source.before,
        after: '', citations: [], decision: 'pending', rationale: `Left out of this draft by you: ${o.text}` }));
    }
  }
  return {
    proposals,
    patches: [...overlay.values()].map(p => structuredClone(p)),
    groundings: structuredClone(groundings.filter(g => !changed.has(g.proposal_id) && (!sourceVersions || g.sources.every(s => sourceVersions.get(s.evidence_id) === s.evidence_fingerprint)))),
  };
}
export function normalizeProposalIssues(items: { subject: ProposalIssue['subject']; issues: ValidationIssue[]; target?: ReviewFindingTarget }[]): ProposalIssue[] {
  const result = new Map<string, ProposalIssue>();
  for (const { subject, issues, target: itemTarget } of items) for (const detail of issues) {
    const group = ['ledger_ceiling', 'unsupported_experience', 'unsupported_citation'].includes(detail.kind) ? 'grounding' : detail.kind;
    const key = JSON.stringify([subject, group]);
    const existing = result.get(key);
    const target = detail.target ?? itemTarget;
    if (existing) {
      existing.details.push(structuredClone(detail));
      if (!existing.target && target) existing.target = structuredClone(target);
    } else {
      result.set(key, {
        id: key,
        subject: structuredClone(subject),
        group,
        action: subject.kind === 'proposal' ? 'edit_proposal' : 'refresh_base',
        details: [structuredClone(detail)],
        ...(target ? { target: structuredClone(target) } : {}),
      });
    }
  }
  return [...result.values()];
}
export function detectProposalConflicts(proposals: Proposal[]): ProposalIssue[] {
  const conflicts = overlappingProposalIds(proposals);
  return normalizeProposalIssues([...conflicts].map(id => ({ subject: { kind: 'proposal' as const, proposal_id: id }, issues: [{ severity: 'block' as const, kind: 'target_conflict', message: `Competing edits: ${[...conflicts].join(', ')}` }] })));
}

/** Review boundary: checks are freshly derived, including fields retained after rejection. */
export function validateProposalReview(base: z.infer<typeof ResumeSpecSchema>, proposals: Proposal[], context: Omit<ProposalValidationContext, 'baseResume'>, rules?: PrivacyRulesConfig, supportFor?: (proposal: Proposal) => ProposalValidationContext['skillSupport'], revision = 0) {
  const result = applyCandidateProposals(base, proposals.map(p => ({ ...p, checks: [] })), context, supportFor);
  const items: Parameters<typeof normalizeProposalIssues>[0] = result.proposals.filter(p => p.decision !== 'rejected').map(p => {
    const pText = p.edited_after ?? p.after;
    const pTarget: ReviewFindingTarget = {
      scope: p.edited_after !== undefined ? 'draft_candidate' : 'generated_patch',
      text: pText,
      text_fingerprint: textFingerprint(pText),
      revision,
    };
    return {
      subject: { kind: 'proposal', proposal_id: p.id },
      issues: p.checks.map(c => ({ ...c, target: c.target ?? pTarget })),
      target: pTarget,
    };
  });
  const candidateIssues = checkCandidateFields(result.candidate,
    result.proposals.filter(p => result.appliedProposalIds.includes(p.id)),
    { ...context, baseResume: result.candidate }, rules, supportFor);
  for (const i of candidateIssues) {
    const candidateText = baseText(result.candidate, i.path) ?? (i.path.startsWith('skills.') ? (() => {
      const match = /^skills\.(\d+)\.skills\.(\d+)$/.exec(i.path);
      return match ? result.candidate.skills[Number(match[1])]?.skills[Number(match[2])] ?? '' : '';
    })() : '');
    const origin = proposals.find(p => result.appliedProposalIds.includes(p.id) && (p.edited_after ?? p.after) === candidateText);
    const scope = origin ? (origin.edited_after !== undefined ? 'draft_candidate' : 'generated_patch') : 'retained_baseline';
    const cTarget: ReviewFindingTarget = {
      scope,
      text: candidateText,
      text_fingerprint: textFingerprint(candidateText),
      revision,
    };
    items.push({
      subject: { kind: 'candidate', path: i.path },
      issues: [{ kind: i.code, severity: i.severity, message: i.message, target: cTarget }],
      target: cTarget,
    });
  }

  const issues = [...normalizeProposalIssues(items), ...detectProposalConflicts(proposals)];
  return { ...result, issues, valid: !issues.some(i => i.details.some(d => d.severity === 'block')) };
}


export function makeAccomplishmentOmission(base: z.infer<typeof ResumeSpecSchema>, proposals: Proposal[], path: string, wording: string, id: string): ProposalPatch {
  const match = /^experiences\.(\d+)\.bullets\.\d+\.text$/.exec(path);
  if (!match) throw new Error('Only an experience accomplishment can be omitted here.');
  const ei = Number(match[1]), exp = base.experiences[ei];
  if (!exp) throw new Error('Employment experience no longer exists.');
  const proposal = proposalForPassage(proposals, path, wording);
  const original = originalPassagePath(base, path, wording);
  if (!proposal && !original) throw new Error('This accomplishment has ambiguous original targets. Review its wording before removing it.');
  const sources = proposal ? proposal.type === 'bullet.add' ? [] : proposal.type === 'bullet.consolidate' ? proposal.source_bullets! : [{ bullet_index: proposal.target.bullet_index, before: proposal.before }]
    : [{ bullet_index: Number(BASE_TEXT_PATH.exec(original!)![3]), before: wording }];
  return ProposalPatchSchema.parse({ proposal_id: `user-omission:${id}`, omission: { experience_index: ei, anchor: { company: exp.company, role: exp.role, startDate: exp.startDate }, text: wording,
    ...(proposal ? { replaces_proposal_id: proposal.id } : {}), source_bullets: sources.map(source => ({ ...source, before: exp.bullets[source.bullet_index]?.text ?? source.before })) } });
}
export function validateOmissionTargets(base: z.infer<typeof ResumeSpecSchema>, patches: ProposalPatch[]) {
  for (const patch of patches) {
    const o = patch.omission; if (!o || patch.decision === 'rejected') continue;
    const e = base.experiences[o.experience_index];
    if (!e || e.company !== o.anchor.company || e.role !== o.anchor.role || e.startDate !== o.anchor.startDate
      || new Set(o.source_bullets.map(s => s.bullet_index)).size !== o.source_bullets.length
      || o.source_bullets.some(s => e.bullets[s.bullet_index]?.text !== s.before)) throw new Error('Omission targets changed. Reload the current draft before removing an accomplishment.');
  }
}

export {
  type PassageDiffStage,
  type PassageDiffTrace,
  type ArtifactChangesSummary,
  computeArtifactChanges,
} from './restoration.js';

