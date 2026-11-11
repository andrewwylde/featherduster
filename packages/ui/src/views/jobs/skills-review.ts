import { computeSkillsListDiff, type Proposal, type ResumeSpec } from '@featherduster/core';

export function isSkillsProposal(proposal: Proposal) {
  return proposal.type === 'skills.prune' || proposal.type === 'skills.reorder';
}

/** Captured membership and the applied candidate outrank generated prose or intent. */
export function skillsReviewChange(proposal: Proposal, base?: ResumeSpec, candidate?: ResumeSpec) {
  const index = proposal.target.skill_group_index ?? -1;
  const group = base?.skills[index];
  const before = group?.skills ?? (base ? [] : proposal.before_skills ?? proposal.before.split(/,\s*/).filter(Boolean));
  const names = new Map(before.map(name => [name.toLowerCase(), name]));
  const order = proposal.skills.map(name => names.get(name.toLowerCase())).filter((name): name is string => Boolean(name));
  const removed = new Set(proposal.skills.map(name => name.toLowerCase()));
  const applied = proposal.type === 'skills.prune' ? before.filter(name => !removed.has(name.toLowerCase()))
    : [...order, ...before.filter(name => !order.includes(name))];
  let after = proposal.decision === 'rejected' ? before : applied;
  let ambiguous = false;
  if (base && candidate && group) {
    const sameSlots = base.skills.length === candidate.skills.length && base.skills.every((original, i) => original.category === candidate.skills[i].category);
    if (sameSlots) after = candidate.skills[index].skills;
    else {
      const originals = base.skills.filter(original => original.category === group.category);
      const matches = candidate.skills.filter(current => current.category === group.category);
      if (originals.length === 1 && matches.length <= 1) after = matches[0]?.skills ?? [];
      else ambiguous = true;
    }
  }
  return { ...computeSkillsListDiff(before, after), category: group?.category ?? `Skills group ${index + 1}`, missing: Boolean(base && !group), ambiguous };
}
