import type { CorpusSnapshot, CorpusUpdate } from './schemas.js';
import type { Clarification, Fact, SemanticSource, SemanticPassage } from '../jobs/semantic-evidence.js';
import { sameFact } from '../jobs/semantic-policy.js';

export function activeCorpusUpdates(snapshot: CorpusSnapshot): CorpusUpdate[] {
  const inactive = new Set(snapshot.updates.flatMap(u => [...(u.supersedes ? [u.supersedes] : []), ...(u.change.kind === 'withdrawal' ? [u.change.update_id] : [])]));
  return snapshot.updates.filter(u => !inactive.has(u.id) && u.change.kind !== 'withdrawal');
}

export function employmentId(employer: string, period?: string): string {
  const normEmployer = employer.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!period?.trim()) return normEmployer;
  const normPeriod = period.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${normEmployer}:${normPeriod}`;
}

/** Exact work + predicate + qualifiers and immutable evidence bindings. Never reuse style as fact. */
export function reusableClarifications(snapshot: CorpusSnapshot, facts: Fact[], sources: SemanticSource[]): Clarification[] {
  const active = activeCorpusUpdates(snapshot).filter(u => u.change.kind === 'clarification');
  return active.flatMap(u => {
    if (u.change.kind !== 'clarification') return [];
    const { clarification: c, scope, sources: bindings, support_basis } = u.change.value;

    if (support_basis === 'human_confirmation') {
      const matches = facts.some(f => {
        if (!f.predicate || f.predicate !== c.fact.predicate) return false;
        if (scope.kind === 'employer') {
          const scopeKeyNorm = scope.key.trim().toLowerCase();
          const targetKeyNorm = f.work_id.trim().toLowerCase();
          return targetKeyNorm === scopeKeyNorm
            || targetKeyNorm.startsWith(`${scopeKeyNorm}:`)
            || scopeKeyNorm.startsWith(`${targetKeyNorm}:`)
            || targetKeyNorm.split(':')[0] === scopeKeyNorm.split(':')[0];
        }
        return scope.key === f.work_id;
      });
      if (!matches || c.confirmed !== true) return [];
      if (active.some(other => other.id !== u.id && other.change.kind === 'clarification'
        && other.change.value.clarification.fact.predicate === c.fact.predicate
        && (other.change.value.scope.key === scope.key || other.change.value.clarification.fact.work_id === c.fact.work_id)
        && other.change.value.clarification.assertion !== c.assertion)) return [];
      return [{ ...c, support_basis: 'human_confirmation' as const }];
    }

    if (scope.key !== c.fact.work_id || !facts.some(f => sameFact(f, c.fact)) || c.confirmed !== true) return [];
    if (active.some(other => other.id !== u.id && other.change.kind === 'clarification'
      && sameFact(other.change.value.clarification.fact, c.fact) && other.change.value.clarification.assertion !== c.assertion)) return [];
    if (!bindings.every(b => sources.some(s => s.evidence_id === b.evidence_id && s.evidence_fingerprint === b.evidence_fingerprint && s.text.includes(b.quote)))) return [];
    return [c];
  });
}

/** Corrections invalidate old confirmations even in drafts that have not opted into new wording. */
export function correctedClarificationIds(snapshot: CorpusSnapshot): Set<string> {
  const replaced = new Set(snapshot.updates.flatMap(u => [...(u.supersedes ? [u.supersedes] : []), ...(u.change.kind === 'withdrawal' ? [u.change.update_id] : [])]));
  return new Set(snapshot.updates.flatMap(u => replaced.has(u.id) && u.change.kind === 'clarification' ? [u.change.value.clarification.id] : []));
}

/** Resolve a correction chain to its current answer, retaining every superseded claim binding. */
export function clarificationCorrections(snapshot: CorpusSnapshot) {
  return activeCorpusUpdates(snapshot).flatMap(update => {
    if (update.change.kind !== 'clarification' || !update.supersedes) return [];
    const after = update.change.value.clarification, visited = new Set<string>();
    const result: { update: CorpusUpdate; before: Clarification; after: Clarification }[] = [];
    let id: string | null = update.supersedes;
    while (id && !visited.has(id)) {
      visited.add(id);
      const previous = snapshot.updates.find(u => u.id === id);
      if (!previous || previous.change.kind !== 'clarification') break;
      result.push({ update, before: previous.change.value.clarification, after });
      id = previous.supersedes;
    }
    return result;
  });
}

export function knownClarificationConflicts(snapshot: CorpusSnapshot, passages: SemanticPassage[]) {
  const corrected = correctedClarificationIds(snapshot);
  const corrections = clarificationCorrections(snapshot);
  return passages.flatMap(p => snapshot.updates.flatMap(u => {
    if (u.change.kind !== 'clarification') return [];
    const old = u.change.value.clarification;
    if (!corrected.has(old.id) || old.fact.work_id !== p.work_id || !old.confirmed_claims?.some(text => p.text.includes(text))) return [];
    const replacement = corrections.find(c => c.before.id === old.id)?.after;
    if (!old.confirmed_claims?.some(text => p.text.includes(text) && !replacement?.confirmed_claims?.includes(text))) return [];
    return [{ path: p.subject.path, wording: p.text, previous_answer: old.assertion, corrected_answer: replacement?.assertion ?? 'This shared answer was withdrawn.' }];
  }));
}
