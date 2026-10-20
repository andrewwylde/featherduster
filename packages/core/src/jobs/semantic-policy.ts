import type { ClaimResult, Clarification, Fact, SemanticPassage, SemanticSource } from './semantic-evidence.js';
import type { JobFacts } from './semantic-transport.js';
/** Read-only projection of exact, source-checked content. Never inferred from vocabulary. */
export interface SemanticSupport {
  path: string;
  proposal_id?: string;
  text: string;
  resolved: boolean;
  citations: string[];
  resolved_spans?: { start: number; end: number }[];
}
export function semanticSupportsTerm(support: SemanticSupport | undefined, term: string): boolean {
  if (!support) return false;
  if (support.resolved) return true;
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  const occurrences = [...support.text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi'))];
  return occurrences.length > 0 && occurrences.every(m => support.resolved_spans?.some(s => s.start <= m.index && s.end >= m.index + m[0].length));
}
export function semanticSupport(view: JobFacts): SemanticSupport[] {
  return [...new Set(view.facts.map(f => f.passage.subject.id))].map(id => {
    const facts = view.facts.filter(f => f.passage.subject.id === id), p = facts[0].passage;
    return { path: p.subject.path, proposal_id: p.subject.proposal_id, text: p.text,
      resolved: facts.length > 0 && facts.every(f => !!f.resolution),
      resolved_spans: facts.filter(f => !!f.resolution).map(f => ({ start: f.claim.start, end: f.claim.end })),
      citations: [...new Set(facts.filter(f => !!f.resolution).flatMap(f => f.evidence.map(e => e.evidence_id)))] };
  });
}
export function sameFact(a: Fact, b: Fact): boolean {
  return a.work_id === b.work_id && a.predicate === b.predicate
    && JSON.stringify([...a.qualifiers].sort()) === JSON.stringify([...b.qualifiers].sort());
}
export function resolveSemanticFindings<T extends { kind: string; claim_id?: string }>(findings: T[], supportedClaimIds: ReadonlySet<string>): T[] {
  return findings.filter(f => !((f.kind === 'unsupported_experience' || f.kind === 'ledger_ceiling')
    && f.claim_id !== undefined && supportedClaimIds.has(f.claim_id)));
}
export function validClaimBinding(result: ClaimResult, passage: SemanticPassage, sources: SemanticSource[]): boolean {
  const c = result.claim;
  let company: string | undefined;
  try { company = passage.work_context ? JSON.parse(passage.work_context).company : undefined; } catch { return false; }
  const sameEmployer = (source: SemanticSource) => !company || !source.company
    || company.trim().toLowerCase() === source.company.trim().toLowerCase();
  return c.subject.id === passage.subject.id && c.subject.passage_fingerprint === passage.subject.passage_fingerprint
    && c.subject.path === passage.subject.path && c.fact.work_id === passage.work_id
    && passage.text.slice(c.start, c.end) === c.text && result.evidence.every(q => sources.some(s => sameEmployer(s) &&
      s.evidence_id === q.evidence_id && s.evidence_fingerprint === q.evidence_fingerprint && s.field === q.field
      && q.start >= s.start && q.end <= s.start + s.text.length && s.text.slice(q.start - s.start, q.end - s.start) === q.quote));
}
export function matchingClarification(result: ClaimResult, clarifications: Clarification[]): Clarification | undefined {
  const superseded = new Set(clarifications.flatMap(c => c.supersedes ? [c.supersedes] : []));
  return clarifications.find(c => c.confirmed !== false && !superseded.has(c.id) && sameFact(c.fact, result.claim.fact)
    && (result.state !== 'contradicted' || (c.kind === 'correction' && !!c.corrected_assertion
      && result.evidence.every(q => c.source_ids.includes(q.evidence_id))
      && result.evidence.some(q => q.quote.includes(c.corrected_assertion!)) )));
}
