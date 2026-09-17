import { STEP_JSON_SCHEMAS } from '@featherduster/core';
import type { RunnerRequest } from './types.js';

/**
 * Deterministic, heuristic "model" used only with FEATHERDUSTER_RUNNER=fake so the
 * full tailoring flow can be demoed and e2e-tested without a real LLM. It reads the
 * structured sections of each gate prompt and produces schema-valid output.
 */

const KNOWN_TERMS = [
  'TypeScript', 'JavaScript', 'Go', 'Golang', 'Python', 'Rust', 'Java', 'C++', 'SQL', 'React', 'Node.js',
  'Kafka', 'RabbitMQ', 'Kubernetes', 'Docker', 'AWS', 'GCP', 'Azure', 'PostgreSQL', 'Redis', 'gRPC',
  'GraphQL', 'Terraform', 'OpenTelemetry', 'distributed systems', 'observability', 'reliability',
  'design system', 'CI/CD', 'mentoring', 'performance', 'security',
];

function sections(prompt: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = prompt.split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    if (nl < 0) continue;
    map.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }
  return map;
}

function json<T>(map: Map<string, string>, prefix: string, fallback: T): T {
  for (const [key, value] of map) {
    if (key.startsWith(prefix)) {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}

function containsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
}

function analysis(prompt: string) {
  const s = sections(prompt);
  const posting = s.get('Job Posting') ?? '';
  const firstLine = posting.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const atMatch = firstLine.match(/^(.*?)\s+(?:at|@|—|-)\s+(.*)$/);
  const role = atMatch ? atMatch[1] : firstLine.slice(0, 80);
  const company = atMatch ? atMatch[2] : '';
  const found = KNOWN_TERMS.filter((t) => containsTerm(posting, t));
  const requirements = found.slice(0, 10).map((term, i) => {
    const re = new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i');
    const idx = posting.search(re);
    const quote = posting.slice(idx, idx + term.length);
    const nice = /plus|nice|bonus|preferred/i.test(posting.slice(Math.max(0, idx - 80), idx + 80));
    return { id: `r${i + 1}`, tier: nice ? 'nice' : 'must', text: `Experience with ${quote}`, quote, terms: [quote] };
  });
  return {
    company,
    role,
    seniority: (posting.match(/\b(Staff|Senior|Principal|Lead|Junior)\b/i)?.[1] ?? ''),
    mission: posting.split('\n').slice(1).join(' ').trim().slice(0, 160),
    requirements,
    boilerplate: /fast-paced/i.test(posting) ? ['fast-paced environment'] : [],
  };
}

function alignment(prompt: string) {
  const s = sections(prompt);
  const reqs = json<Array<{ id: string; terms: string[]; text: string }>>(s, 'Requirements', []);
  const digest = json<Array<Record<string, any>>>(s, 'Evidence Ledger Digest', []);
  return {
    rows: reqs.map((req) => {
      const terms = req.terms.length > 0 ? req.terms : [req.text];
      const hits = digest.filter((e) => {
        const hay = [e.title, e.summary, e.impact, e.narrative_excerpt, ...(e.themes ?? [])].join(' ').replace(/-/g, ' ');
        return terms.some((t) => containsTerm(hay, t));
      });
      if (hits.length > 0) {
        return {
          requirement_id: req.id,
          classification: 'backed',
          citations: hits.slice(0, 2).map((e) => e.id),
          rationale: `Ledger shows production work on ${terms.join(', ')} in "${hits[0].title}".`,
          adjacent_tool: '',
        };
      }
      return { requirement_id: req.id, classification: 'gap', citations: [], rationale: 'No ledger entry mentions this.', adjacent_tool: '' };
    }),
  };
}

function proposals(prompt: string) {
  const s = sections(prompt);
  const matrix = json<Array<{ requirement_id: string; classification: string; citations: string[] }>>(s, 'Approved Alignment Matrix', []);
  const resume = json<any>(s, 'Base Resume', { experiences: [], skills: [] });
  const evidence = json<Array<Record<string, any>>>(s, 'Cited Evidence', []);
  const reqs = json<Array<{ id: string; text: string }>>(s, 'Requirements', []);
  const out: any[] = [];
  const blank = { before: '', after: '', order: [] as number[], skills: [] as string[] };
  const backed = matrix.filter((r) => r.classification === 'backed' && r.citations.length > 0);
  const lead = evidence.find((e) => backed.some((b) => b.citations.includes(e.id)));

  if (lead && resume.summary) {
    out.push({
      id: 'p1',
      type: 'summary.rewrite',
      target: { experience_index: -1, bullet_index: -1, skill_group_index: -1 },
      ...blank,
      before: resume.summary,
      after: `${resume.summary.replace(/\.$/, '')}, with recent ownership of ${String(lead.title).toLowerCase()}.`,
      citations: [lead.id],
      requirement_ids: backed.slice(0, 1).map((b) => b.requirement_id),
      rationale: 'Leads with the most relevant verified project.',
    });
  }

  const exp = resume.experiences?.[0];
  if (exp && lead) {
    out.push({
      id: 'p2',
      type: 'bullet.add',
      target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 },
      ...blank,
      after: `${lead.title}: ${lead.impact}`,
      citations: [lead.id],
      requirement_ids: backed.map((b) => b.requirement_id).slice(0, 2),
      rationale: 'Surfaces verified evidence for a must-have requirement.',
    });
  }
  if (exp && exp.bullets?.length > 1) {
    const order = exp.bullets.map((b: any) => b.bullet_index).reverse();
    out.push({
      id: 'p3',
      type: 'bullet.reorder',
      target: { experience_index: 0, bullet_index: -1, skill_group_index: -1 },
      ...blank,
      order,
      citations: [],
      requirement_ids: [],
      rationale: 'Moves the most relevant bullet to the top.',
    });
    const lastIdx = exp.bullets[exp.bullets.length - 1].bullet_index;
    out.push({
      id: 'p4',
      type: 'bullet.drop',
      target: { experience_index: 0, bullet_index: lastIdx, skill_group_index: -1 },
      ...blank,
      before: exp.bullets[exp.bullets.length - 1].text,
      citations: [],
      requirement_ids: [],
      rationale: 'Frees space for the added bullet (page budget).',
    });
  }
  const group = resume.skills?.[0];
  if (group) {
    const reqText = reqs.map((r) => r.text).join(' ');
    const prioritized = [...group.skills].sort((a: string, b: string) => Number(containsTerm(reqText, b)) - Number(containsTerm(reqText, a)));
    out.push({
      id: 'p5',
      type: 'skills.reorder',
      target: { experience_index: -1, bullet_index: -1, skill_group_index: group.skill_group_index ?? 0 },
      ...blank,
      skills: prioritized,
      citations: [],
      requirement_ids: [],
      rationale: 'Front-loads skills named in the posting.',
    });
  }
  return { proposals: out };
}

function brief(prompt: string) {
  const s = sections(prompt);
  const matrix = json<Array<{ requirement_id: string; classification: string; citations: string[]; adjacent_tool: string }>>(s, 'Approved Alignment Matrix', []);
  const evidence = json<Array<Record<string, any>>>(s, 'Cited Evidence', []);
  return {
    anchor_stories: evidence.slice(0, 3).map((e) => ({
      title: e.title,
      problem: e.summary,
      ownership: 'Owned design and delivery end to end.',
      proof: e.impact,
      citations: [e.id],
    })),
    bridges: matrix
      .filter((r) => r.classification === 'transferable')
      .map((r) => ({ requirement_id: r.requirement_id, adjacent_tool: r.adjacent_tool, framing: `Same architectural patterns applied with ${r.adjacent_tool}.` })),
    gaps: matrix
      .filter((r) => r.classification === 'gap')
      .map((r) => ({ requirement_id: r.requirement_id, acknowledgement: 'No production experience yet.', parallel_mastery: 'Track record of ramping on adjacent stacks quickly.' })),
  };
}

export function createDemoResponder(): (req: RunnerRequest) => unknown {
  return (req) => {
    if (req.schema === STEP_JSON_SCHEMAS.analysis) return analysis(req.prompt);
    if (req.schema === STEP_JSON_SCHEMAS.alignment) return alignment(req.prompt);
    if (req.schema === STEP_JSON_SCHEMAS.proposals) return proposals(req.prompt);
    if (req.schema === STEP_JSON_SCHEMAS.brief) return brief(req.prompt);
    throw new Error('Demo responder: unknown schema');
  };
}
