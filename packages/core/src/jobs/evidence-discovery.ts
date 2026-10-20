import type { ResumeSpec } from '../schemas/resume.js';
import type { SemanticPassage } from './semantic-evidence.js';
import { DISCOVERY_TERMS } from './evidence-terms.js';
export interface DiscoverySource { id: string; fingerprint: string; work_id: string; text: string; retracted: boolean }
export function discoverEvidence(query: string, sources: DiscoverySource[]) {
  const lower = query.toLowerCase();
  const terms = [...new Set([lower, ...lower.split(/[^a-z0-9-]+/).filter(t => t.length > 3),
    ...Object.entries(DISCOVERY_TERMS).filter(([key]) => lower.includes(key)).flatMap(([, values]) => values)])];
  const matches = sources.filter(s => !s.retracted).map(s => ({ ...s,
    score: terms.reduce((sum, term) => sum + Number(s.text.toLowerCase().includes(term)), 0),
  })).filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { matches, searched: sources.length };
}
export function inventoryPassages(candidate: ResumeSpec, hash: (text: string) => string, previous: SemanticPassage[] = []): SemanticPassage[] {
  const passages: { path: string; text: string; work_id: string; work_context?: string }[] = [];
  // Summary assertions remain passage-specific until a source-backed work identity is established.
  if (candidate.summary?.trim()) passages.push({ path: 'summary', text: candidate.summary, work_id: `summary:${hash(candidate.summary)}` });
  candidate.experiences.forEach((e, ei) => {
    e.bullets.forEach((b, bi) => {
      // Sharing an employer/role alone never establishes that two bullets describe the same project.
      const work_id = hash(JSON.stringify([e.company, e.role, e.startDate, e.endDate,
        b.citations?.length ? [...b.citations].sort() : b.text]));
      if (b.text.trim()) passages.push({ path: `experiences.${ei}.bullets.${bi}.text`, text: b.text, work_id,
        work_context: JSON.stringify({ company: e.company, role: e.role, start: e.startDate, end: e.endDate, cited_work: b.citations ?? [] }) });
    });
  });
  return passages.map(p => {
    const peers = passages.filter(q => q.work_id === p.work_id && q.text === p.text);
    const matches = previous.filter(q => q.work_id === p.work_id && q.text === p.text);
    return { ...p, inherited: true, subject: { id: peers.length === 1 && matches.length === 1 ? matches[0].subject.id
      : hash(JSON.stringify([p.work_id, p.text, peers.length > 1 ? p.path : ''])),
      path: p.path, passage_fingerprint: hash(p.text) } };
  });
}
