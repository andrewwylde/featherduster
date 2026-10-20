import type { ClaimResult, Clarification, Fact, SemanticPassage, SemanticSource } from './semantic-evidence.js';
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
  return c.subject.id === passage.subject.id && c.subject.passage_fingerprint === passage.subject.passage_fingerprint
    && c.subject.path === passage.subject.path && c.fact.work_id === passage.work_id
    && passage.text.slice(c.start, c.end) === c.text && result.evidence.every(q => sources.some(s =>
      s.evidence_id === q.evidence_id && s.evidence_fingerprint === q.evidence_fingerprint && s.field === q.field
      && q.start >= s.start && q.end <= s.start + s.text.length && s.text.slice(q.start - s.start, q.end - s.start) === q.quote));
}
export function matchingClarification(result: ClaimResult, clarifications: Clarification[]): Clarification | undefined {
  const superseded = new Set(clarifications.flatMap(c => c.supersedes ? [c.supersedes] : []));
  return clarifications.find(c => !superseded.has(c.id) && sameFact(c.fact, result.claim.fact)
    && (result.state !== 'contradicted' || (c.kind === 'correction' && !!c.corrected_assertion
      && result.evidence.every(q => c.source_ids.includes(q.evidence_id))
      && result.evidence.some(q => q.quote.includes(c.corrected_assertion!)) )));
}
