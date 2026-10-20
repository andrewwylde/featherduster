import type { JobFact } from './semantic-transport.js';
import { sameFact } from './semantic-policy.js';
export function groupReviewFacts(facts: JobFact[]) {
  const groups: { id: string; facts: JobFact[]; resolved: boolean }[] = [];
  for (const fact of facts) {
    const group = groups.find(g => sameFact(g.facts[0].claim.fact, fact.claim.fact)
      && g.facts[0].state === fact.state);
    if (group) { group.facts.push(fact); group.resolved &&= !!fact.resolution; }
    else groups.push({ id: fact.claim.id, facts: [fact], resolved: !!fact.resolution });
  }
  return groups;
}
