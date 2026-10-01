import { randomUUID } from 'node:crypto';
import { applyProposals, effectiveAfter, isBlocked, mergeEqual, previewResumeMerge, resumeTargetMap, ProposalSetSchema, ResumeSpecSchema, validateProposal, type DraftRecord, type ManualDraftPayload, type MergeChoice, type Proposal, type ResumeSpec } from '@featherduster/core';
import { DraftRepositoryError } from './errors.js';

/** Full editable projection: exclusions are retained here, unlike export. */
export function manualContent(payload: ManualDraftPayload): ResumeSpec {
  return { profile: payload.profile, summary: payload.summary, experiences: payload.experiences.map(({ id: _, bullets, ...exp }) => ({ ...exp, bullets: bullets.map(({ id: _, included: __, ...bullet }) => bullet) })), education: payload.education, skills: payload.skills };
}
export function localResume(record: DraftRecord): ResumeSpec {
  if (!record.base) throw new DraftRepositoryError(409, 'missing_base', 'Select a base resume first');
  if (record.kind === 'setup') return record.base.spec;
  if (record.kind === 'manual') {
    const parsed = ResumeSpecSchema.safeParse(manualContent(record.payload));
    if (!parsed.success) throw new DraftRepositoryError(422, 'unfinished_draft', 'Finish invalid resume fields before previewing upstream changes. Your draft is retained.');
    return parsed.data;
  }
  if (Object.keys(record.payload.proposalTextById).length) throw new DraftRepositoryError(422, 'unfinished_draft', 'Finish or discard unfinished proposal text buffers before upstream sync. Your draft is retained.');
  const parsed = ProposalSetSchema.safeParse(record.payload.proposals ?? { proposals: [] });
  if (!parsed.success) throw new DraftRepositoryError(422, 'unfinished_draft', 'Proposal structure is invalid. Finish the draft before upstream sync.');
  for (const proposal of parsed.data.proposals) {
    if (proposal.decision === 'rejected') continue;
    const checked = validateProposal(proposal, { baseResume: record.base.spec, evidence: [], analysis: { company: "", role: "", seniority: "", mission: "", requirements: [], boilerplate: [] }, alignment: { rows: [] } });
    const exp = record.base.spec.experiences[proposal.target.experience_index];
    if (checked.checks.some(c => c.kind === 'invalid_target') || (proposal.type === 'bullet.add' && proposal.target.bullet_index !== -1 && !exp?.bullets[proposal.target.bullet_index])) throw new DraftRepositoryError(422, 'unfinished_draft', 'A proposal target is invalid or unresolved. Repair or reject it before upstream sync.');
  }
  return applyProposals(record.base.spec, parsed.data.proposals);
}
export function mergeDraftResume(record: DraftRecord, upstream: ResumeSpec, resolutions: Record<string, MergeChoice>) {
  const local = localResume(record), result = previewResumeMerge(record.base!.spec, local, upstream, resolutions);
  if (record.kind === 'manual') {
    const map = resumeTargetMap(local, result.merged);
    const uncertainExclusions = !mergeEqual(local.experiences, result.merged.experiences) && record.payload.experiences.some((e, i) => e.bullets.some(b => !b.included) && map[`/experiences/${i}`] === undefined);
    if (uncertainExclusions && !result.conflicts.some(c => c.path === '/experiences')) {
      result.conflicts.push({ id: '/experiences', path: '/experiences', base: record.base!.spec.experiences, local: local.experiences, upstream: upstream.experiences });
      result.merged.experiences = resolutions['/experiences'] === 'upstream' ? upstream.experiences : local.experiences;
    }
  }
  return { ...result, local };
}
export function mergedManual(payload: ManualDraftPayload, merged: ResumeSpec): ManualDraftPayload {
  const old = manualContent(payload), map = resumeTargetMap(old, merged);
  if (mergeEqual(old.experiences, merged.experiences)) return { ...payload, ...merged, summary: merged.summary ?? '', experiences: structuredClone(payload.experiences) };
  return { ...payload, ...merged, summary: merged.summary ?? '', experiences: merged.experiences.map((experience, index) => {
    const original = payload.experiences.find((_, i) => map[`/experiences/${i}`] === `/experiences/${index}`);
    if (original) return structuredClone(original);
    return { ...experience, id: randomUUID(), bullets: experience.bullets.map(bullet => ({ ...bullet, id: randomUUID(), included: true })) };
  }) };
}
/** Rebase operations on the real upstream, never on the already-tailored candidate. */
export function rebaseProposals(base: ResumeSpec, local: ResumeSpec, upstream: ResumeSpec, candidate: ResumeSpec, proposals: Proposal[]) {
  const map = resumeTargetMap(base, upstream), reviewProposalIds: string[] = [];
  const satisfied = resumeTargetMap(local, upstream);
  const rebased: Proposal[] = [];
  for (const original of proposals) {
    const p = structuredClone(original);
    if (p.decision === 'accepted' && !isBlocked(p)) {
      if (mergeEqual(local, upstream)) continue;
      if (p.type.startsWith('bullet.') && satisfied[`/experiences/${p.target.experience_index}`]) continue;
      if (p.type.startsWith('skills.') && satisfied[`/skills/${p.target.skill_group_index}`]) continue;
    }
    if (p.type === 'summary.rewrite') {
      if (p.decision === 'accepted' && (candidate.summary === upstream.summary || effectiveAfter(p) === upstream.summary)) continue;
      p.before = upstream.summary ?? ''; rebased.push(p); continue;
    }
    const expPath = map[`/experiences/${p.target.experience_index}`], skillPath = map[`/skills/${p.target.skill_group_index}`];
    let safe = true;
    if (p.type.startsWith('bullet.')) {
      const bulletPath = map[`/experiences/${p.target.experience_index}/bullets/${p.target.bullet_index}`];
      const order = p.order.map(i => map[`/experiences/${p.target.experience_index}/bullets/${i}`]);
      safe = !!expPath && (p.type === 'bullet.reorder' ? order.every(Boolean) : p.type === 'bullet.add' && p.target.bullet_index === -1 || !!bulletPath);
      if (safe) { p.target.experience_index = Number(expPath!.split('/').pop()); if (bulletPath) p.target.bullet_index = Number(bulletPath.split('/').pop()); p.order = order.map(value => Number(value!.split('/').pop())); }
    } else { safe = !!skillPath; if (safe) p.target.skill_group_index = Number(skillPath!.split('/').pop()); }
    // An upstream choice discards only operations whose source is still known.
    // Unmatched operations retain their text and an unusable target for review.
    if (safe && p.decision === 'accepted' && !isBlocked(p)
      && (p.type.startsWith('bullet.') ? mergeEqual(candidate.experiences, upstream.experiences) : mergeEqual(candidate.skills, upstream.skills))) continue;
    if (!safe) {
      reviewProposalIds.push(p.id); p.decision = 'pending'; p.override = false;
      p.target = { experience_index: -1, bullet_index: -1, skill_group_index: -1 };
      p.checks = [{ severity: 'block', kind: 'upstream_target', message: 'Upstream changed this target. Review the retained candidate and regenerate or reject this proposal; numeric positions cannot identify it.' }];
    }
    rebased.push(p);
  }
  return { proposals: rebased, reviewProposalIds };
}
