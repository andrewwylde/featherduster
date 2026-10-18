import type { CorpusScope, SkillSupport } from '@featherduster/core';

/** Plain-language wording for remembered relationships; ids, hashes and JSON stay behind Details. */
export function scopeDescription(scope: CorpusScope, options: { currentJobId?: string } = {}): string {
  switch (scope.kind) {
    case 'workspace': return 'all jobs';
    case 'employer': return `jobs at ${scope.key}`;
    case 'project': return `the ${scope.key} project`;
    case 'role': return `${scope.key} roles`;
    case 'job': return scope.key === options.currentJobId ? 'this job only' : 'only the job where it was remembered';
  }
}
export const appliesTo = (scope: CorpusScope, options?: { currentJobId?: string }) => `Applies to: ${scopeDescription(scope, options)}`;
const quoted = (terms: string[]) => terms.map(t => `'${t}'`).join(', ');
const verb: Record<SkillSupport['support'], [string, string]> = {
  direct: ['is supported by', 'are supported by'],
  transferable: ['is supported as transferable experience by', 'are supported as transferable experience by'],
  unsupported: ['is not supported by', 'are not supported by'],
};
export function supportDescription(s: Pick<SkillSupport, 'permitted_terms' | 'support'> & { sources: { evidence_id: string }[] }, titleOf: (id: string) => string): string {
  const titles = [...new Set(s.sources.map(v => titleOf(v.evidence_id)))].join(', ');
  return `${quoted(s.permitted_terms)} ${verb[s.support][s.permitted_terms.length === 1 ? 0 : 1]}: ${titles}`;
}
export const withdrawLabel = (s: Pick<SkillSupport, 'permitted_terms' | 'scope'>, options?: { currentJobId?: string }) => `Withdraw ${quoted(s.permitted_terms)} for ${scopeDescription(s.scope, options)}`;
/** Withdrawal is global: say how far it reaches. */
export function withdrawEffect(scope: CorpusScope, options: { currentJobId?: string } = {}): string {
  const reach = scope.kind === 'workspace' ? 'every job'
    : scope.kind === 'role' ? `all ${scope.key} roles`
    : scope.kind === 'employer' ? `all jobs at ${scope.key}`
    : scope.kind === 'project' ? `all jobs for the ${scope.key} project`
    : scopeDescription(scope, options);
  return `Withdrawing stops it being offered for ${reach}.`;
}
export const confirmLabel = (label: string) => `Confirm ${label[0].toLowerCase()}${label.slice(1)}`;
/** Keep accessible names unique: repeated labels name their source ("(from API delivery)"), then fall back to an ordinal. */
export function uniqueLabels(items: { label: string; detail?: string }[]): string[] {
  const count = (labels: string[]) => labels.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const repeated = count(items.map(i => i.label));
  const named = items.map(i => (repeated.get(i.label)! > 1 && i.detail ? `${i.label} (from ${i.detail})` : i.label));
  const seen = new Map<string, number>();
  return named.map(label => { const n = (seen.get(label) ?? 0) + 1; seen.set(label, n); return n === 1 ? label : `${label} (${n})`; });
}
/** The source titles of a relationship, for telling same-reading labels apart. */
export const sourceTitles = (s: { sources: { evidence_id: string }[] }, titleOf: (id: string) => string) => [...new Set(s.sources.map(v => titleOf(v.evidence_id)))].join(', ');
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
/** Same remembered relationship (as captured on a job) as a corpus update's value. */
export function sameRelationship(a: SkillSupport, b: SkillSupport): boolean {
  const scope = (s: CorpusScope) => s.kind === 'workspace' ? s.kind : `${s.kind}:${s.key}`;
  const ids = (s: SkillSupport) => s.sources.map(v => v.evidence_id).sort().join('\0');
  const terms = (s: SkillSupport) => s.permitted_terms.map(norm).sort().join('\0');
  return norm(a.skill) === norm(b.skill) && norm(a.facet) === norm(b.facet) && scope(a.scope) === scope(b.scope)
    && ids(a) === ids(b) && terms(a) === terms(b) && a.support === b.support;
}
