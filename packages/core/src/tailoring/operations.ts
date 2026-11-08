import type { ResumeSpec } from '../schemas/resume.js';
import type { Proposal } from './schemas.js';

/** Candidate indices can shift after consolidation. Resolve within the original experience. */
export function originalPassagePath(base: ResumeSpec, candidatePath: string, text: string): string | undefined {
  if (candidatePath === 'summary') return base.summary === text ? 'summary' : undefined;
  const match = /^experiences\.(\d+)\.bullets\.\d+\.text$/.exec(candidatePath);
  if (!match) return;
  const ei = Number(match[1]);
  const matches = base.experiences[ei]?.bullets.flatMap((b, bi) => b.text === text ? [bi] : []) ?? [];
  return matches.length === 1 ? `experiences.${ei}.bullets.${matches[0]}.text` : undefined;
}

export function proposalForPassage(proposals: Proposal[], path: string, text: string): Proposal | undefined {
  const experience = /^experiences\.(\d+)\.bullets\.\d+\.text$/.exec(path)?.[1];
  const matches = proposals.filter(p => p.decision !== 'rejected' && (p.edited_after ?? p.after) === text
    && (path === 'summary' ? p.type === 'summary.rewrite' : experience !== undefined && p.target.experience_index === Number(experience)
      && ['bullet.add', 'bullet.rewrite', 'bullet.consolidate'].includes(p.type)));
  return matches.length === 1 ? matches[0] : undefined;
}

/** All indices refer to the captured resume, never an intermediate candidate. */
export function originalBulletTargets(p: Proposal): number[] {
  return p.type === 'bullet.consolidate' ? (p.source_bullets ?? []).map(s => s.bullet_index)
    : ['bullet.rewrite', 'bullet.drop'].includes(p.type) ? [p.target.bullet_index] : [];
}

export function consolidationError(p: Proposal, base: ResumeSpec): string | undefined {
  if (p.type !== 'bullet.consolidate') return;
  const sources = p.source_bullets ?? [], exp = base.experiences[p.target.experience_index];
  if (!exp || sources.length < 2 || new Set(sources.map(s => s.bullet_index)).size !== sources.length)
    return 'Consolidation needs at least two distinct original bullets in one experience.';
  if (!sources.some(s => s.bullet_index === p.target.bullet_index)) return 'Consolidation insertion target must be one of its original bullets.';
  if (sources.some(s => exp.bullets[s.bullet_index]?.text !== s.before)) return 'Consolidation source wording or position changed. Refresh the captured targets.';
  if (!(p.edited_after ?? p.after).trim()) return 'Consolidated accomplishment is empty.';
}

export function overlappingProposalIds(proposals: Proposal[]): Set<string> {
  const owners = new Map<string, string[]>();
  for (const p of proposals.filter(p => p.decision !== 'rejected')) {
    const keys = originalBulletTargets(p).map(i => `bullet:${p.target.experience_index}:${i}`);
    if (p.type === 'summary.rewrite') keys.push('summary');
    if (p.type === 'bullet.reorder') keys.push(`order:${p.target.experience_index}`);
    if (p.type === 'skills.reorder') keys.push(`skills:${p.target.skill_group_index}`);
    for (const key of keys) owners.set(key, [...(owners.get(key) ?? []), p.id]);
  }
  return new Set([...owners.values()].filter(ids => ids.length > 1).flat());
}
