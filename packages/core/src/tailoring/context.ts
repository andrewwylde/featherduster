import type { PrivacyRulesConfig } from '../schemas/privacy.js';
import type { ResumeSpec } from '../schemas/resume.js';
import type { EvidenceRecord } from '../parsers/index-store.js';
import { redactText } from '../integrity/redaction-engine.js';
import type {
  AlignmentMatrix,
  JobAnalysis,
  Proposal,
  TailoringStep,
} from './schemas.js';

export type RunnerLocality = 'local' | 'cloud';

export interface RedactionViolation {
  source: string;
  terms: string[];
}

export class RedactionBlockedError extends Error {
  readonly violations: RedactionViolation[];
  constructor(violations: RedactionViolation[]) {
    super(
      `Banned keywords detected in model input: ${violations
        .map((v) => `${v.source} (${v.terms.join(', ')})`)
        .join('; ')}`
    );
    this.name = 'RedactionBlockedError';
    this.violations = violations;
  }
}

export interface ContextOptions {
  locality: RunnerLocality;
  rules: PrivacyRulesConfig;
  /** All known evidence IDs; protected from redaction so citations survive. */
  evidenceIds: string[];
}

/**
 * Collects text destined for a model, redacting it for cloud runners and
 * accumulating banned-keyword violations per source.
 */
class Sanitizer {
  readonly violations: RedactionViolation[] = [];
  constructor(private readonly opts: ContextOptions) {}

  clean(source: string, text: string | undefined | null): string {
    const value = text ?? '';
    if (this.opts.locality === 'local' || !value) return value;
    const result = redactText(value, this.opts.rules, { protectTokens: this.opts.evidenceIds });
    if (!result.isClean) {
      this.violations.push({ source, terms: result.violations });
    }
    return result.redactedText;
  }

  finish(prompt: string): string {
    if (this.violations.length > 0) {
      // Merge by source for a readable error
      const merged = new Map<string, Set<string>>();
      for (const v of this.violations) {
        const set = merged.get(v.source) ?? new Set<string>();
        v.terms.forEach((t) => set.add(t));
        merged.set(v.source, set);
      }
      throw new RedactionBlockedError(
        Array.from(merged.entries()).map(([source, terms]) => ({ source, terms: Array.from(terms) }))
      );
    }
    return prompt;
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const GATE_INSTRUCTIONS: Record<TailoringStep, string> = {
  analysis: `CURRENT GATE: Gate 0 — Ingest & Deconstruct Job Posting.
Parse the job posting into structured requirements using the JD extraction rubric.
- Assign each requirement a short stable id ("r1", "r2", ...).
- tier: "must" (Tier 1), "nice" (Tier 2), or "vocabulary" (Tier 3 company nomenclature).
- quote: copy a short VERBATIM span from the posting that states the requirement. Never paraphrase the quote.
- terms: the concrete technologies, tools, languages, or domain terms the requirement names (e.g. ["Kafka"]). Empty array if none.
- boilerplate: Tier 4 HR filler phrases you deliberately ignored.
- company and role: as stated in the posting ("" if absent).
Do not reference the candidate. Do not invent requirements that the posting does not state.`,
  alignment: `CURRENT GATE: Gate 1 — Requirement Alignment & Gap Matrix.
For EVERY requirement id provided, emit exactly one row:
- classification "backed": the ledger contains explicit production evidence. citations MUST list the supporting evidence IDs exactly as given.
- classification "transferable": the candidate did equivalent work with an adjacent tool/pattern. Set adjacent_tool to the tool actually used and cite the evidence.
- classification "gap": absent from the ledger. citations MUST be empty.
- rationale: one sentence grounded in the cited evidence.
Only cite evidence IDs that appear in the ledger digest. Never infer experience from the resume skills block alone.`,
  proposals: `CURRENT GATE: Gate 2 — Strategic Re-weighting & Terminology Harmonization.
Propose surgical, typed edits to the base resume. Indices refer to the ORIGINAL base resume arrays (0-based). Use -1 for indices that do not apply, [] for unused arrays, "" for unused strings.
Types:
- summary.rewrite: after = new summary (1-2 sentence reframing; preserve positioning).
- bullet.rewrite: target.experience_index + target.bullet_index; before = original text; after = new text.
- bullet.add: target.experience_index; target.bullet_index = insert position; after = new bullet. Must be fully supported by cited evidence.
- bullet.drop: target.experience_index + target.bullet_index; before = original text.
- bullet.reorder: target.experience_index; order = permutation of original bullet indices, most relevant first.
- skills.reorder: target.skill_group_index; skills = the SAME skills in a new order.
- skills.prune: target.skill_group_index; skills = skills to remove.
Rules:
- Ledger Ceiling: never introduce a technology, skill, or claim not present in the cited evidence or the base resume.
- Transferable requirements keep the candidate's true tool name; do not substitute the posting's tool.
- Every summary.rewrite, bullet.rewrite and bullet.add MUST cite evidence IDs.
- Never invent numbers. Use a metric only if it appears in cited evidence; otherwise write [METRIC NEEDED].
- Page budget: do not increase total length. Pair additions with drops or tightening.
- No filler, buzzwords, hedging, or manufactured stakes.
- requirement_ids: the requirement ids each edit serves. rationale: one sentence.
- Give each proposal a unique id ("p1", "p2", ...).`,
  brief: `CURRENT GATE: Gate 4 — Interview Defensibility Brief.
- anchor_stories: up to 3 projects that answer the posting's highest-priority requirements (problem, ownership, proof/metric), each citing evidence IDs.
- bridges: one entry per "transferable" requirement with honest framing from adjacent_tool to the requirement.
- gaps: one entry per "gap" requirement with honest acknowledgement and parallel mastery / ramp-up track record.
Never claim experience the ledger does not show. Use [METRIC NEEDED] for unverified numbers.`,
};

const OUTPUT_CONTRACT = `OUTPUT CONTRACT: Respond ONLY with a JSON object matching the provided JSON schema. No prose outside JSON.`;

/**
 * Builds the system prompt for a gate from the skill text (SKILL.md + references).
 */
export function buildSystemPrompt(skillText: string, step: TailoringStep): string {
  return [
    'You are executing the Featherduster "career-growth-tailor-resume" skill as a single gate inside a staged workflow driven by an application. A human reviews and approves every gate.',
    '=== SKILL ===',
    skillText.trim(),
    '=== END SKILL ===',
    GATE_INSTRUCTIONS[step],
    OUTPUT_CONTRACT,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Gate prompts
// ---------------------------------------------------------------------------

const NARRATIVE_EXCERPT_CHARS = 700;

function narrativeExcerpt(narrative: string): string {
  const flat = narrative.replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim();
  return flat.length > NARRATIVE_EXCERPT_CHARS ? `${flat.slice(0, NARRATIVE_EXCERPT_CHARS)}…` : flat;
}

function digestEvidence(record: EvidenceRecord, s: Sanitizer): Record<string, unknown> {
  const e = record.entry;
  const src = `evidence ${e.id}`;
  return {
    id: e.id,
    date: e.date,
    company: s.clean(src, e.company),
    title: s.clean(src, e.title),
    summary: s.clean(src, e.summary),
    impact: s.clean(src, e.impact),
    themes: e.themes.map((t) => s.clean(src, t)),
    confidence: e.confidence,
    in_flight: e.in_flight,
    metrics: e.metrics.map((m) => ({
      name: s.clean(src, m.name),
      status: m.status,
    })),
    // Tools and mechanisms often appear only in the narrative body.
    narrative_excerpt: s.clean(src, narrativeExcerpt(record.narrative)),
  };
}

function fullEvidence(record: EvidenceRecord, s: Sanitizer): Record<string, unknown> {
  const e = record.entry;
  const src = `evidence ${e.id}`;
  const { narrative_excerpt: _excerpt, ...digest } = digestEvidence(record, s);
  return {
    ...digest,
    metrics: e.metrics.map((m) => ({
      name: s.clean(src, m.name),
      value: s.clean(src, m.value),
      status: m.status,
    })),
    narrative: s.clean(src, record.narrative),
  };
}

function sanitizeResume(resume: ResumeSpec, s: Sanitizer): Record<string, unknown> {
  const src = 'base resume';
  return {
    title: s.clean(src, resume.profile.title),
    summary: s.clean(src, resume.summary ?? ''),
    experiences: resume.experiences.map((exp, experience_index) => ({
      experience_index,
      company: s.clean(src, exp.company),
      role: s.clean(src, exp.role),
      startDate: exp.startDate,
      endDate: exp.endDate,
      bullets: exp.bullets.map((b, bullet_index) => ({
        bullet_index,
        text: s.clean(src, b.text),
        citations: b.citations ?? [],
      })),
    })),
    skills: resume.skills.map((g, skill_group_index) => ({
      skill_group_index,
      category: s.clean(src, g.category),
      skills: g.skills.map((sk) => s.clean(src, sk)),
    })),
  };
}

function section(title: string, body: unknown): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return `## ${title}\n${content}`;
}

export function buildAnalysisPrompt(posting: string, jdRubric: string, opts: ContextOptions): string {
  const s = new Sanitizer(opts);
  const prompt = [
    section('JD Extraction Rubric', jdRubric.trim()),
    section('Job Posting', s.clean('job posting', posting)),
  ].join('\n\n');
  return s.finish(prompt);
}

export function buildAlignmentPrompt(
  analysis: JobAnalysis,
  evidence: EvidenceRecord[],
  baseResume: ResumeSpec,
  opts: ContextOptions
): string {
  const s = new Sanitizer(opts);
  const requirements = analysis.requirements.map((r) => ({
    id: r.id,
    tier: r.tier,
    text: s.clean('requirements', r.text),
    terms: r.terms,
  }));
  const digest = evidence
    .filter((r) => r.entry.confidence !== 'retracted')
    .map((r) => digestEvidence(r, s));
  const skills = baseResume.skills.flatMap((g) => g.skills.map((sk) => s.clean('base resume', sk)));
  const prompt = [
    section('Target Role', { role: s.clean('analysis', analysis.role), seniority: analysis.seniority }),
    section('Requirements', requirements),
    section('Evidence Ledger Digest', digest),
    section('Base Resume Skills (candidate-declared, not proof)', skills),
  ].join('\n\n');
  return s.finish(prompt);
}

export function citedEvidenceIds(alignment: AlignmentMatrix): string[] {
  return Array.from(new Set(alignment.rows.flatMap((r) => r.citations)));
}

export function buildProposalsPrompt(
  analysis: JobAnalysis,
  alignment: AlignmentMatrix,
  baseResume: ResumeSpec,
  citedEvidence: EvidenceRecord[],
  opts: ContextOptions
): string {
  const s = new Sanitizer(opts);
  const requirements = analysis.requirements.map((r) => ({
    id: r.id,
    tier: r.tier,
    text: s.clean('requirements', r.text),
  }));
  const matrix = alignment.rows.map((row) => ({
    requirement_id: row.requirement_id,
    classification: row.classification,
    citations: row.citations,
    adjacent_tool: s.clean('alignment', row.adjacent_tool),
    candidate_confirmed: row.candidate_confirmed,
    rationale: s.clean('alignment', row.rationale),
  }));
  const prompt = [
    section('Target Role', {
      company: s.clean('analysis', analysis.company),
      role: s.clean('analysis', analysis.role),
      seniority: analysis.seniority,
      mission: s.clean('analysis', analysis.mission),
    }),
    section('Requirements', requirements),
    section('Approved Alignment Matrix', matrix),
    section('Base Resume', sanitizeResume(baseResume, s)),
    section('Cited Evidence (full)', citedEvidence.map((r) => fullEvidence(r, s))),
  ].join('\n\n');
  return s.finish(prompt);
}

export function buildBriefPrompt(
  analysis: JobAnalysis,
  alignment: AlignmentMatrix,
  acceptedProposals: Proposal[],
  citedEvidence: EvidenceRecord[],
  opts: ContextOptions
): string {
  const s = new Sanitizer(opts);
  const requirements = analysis.requirements.map((r) => ({
    id: r.id,
    tier: r.tier,
    text: s.clean('requirements', r.text),
  }));
  const prompt = [
    section('Target Role', {
      company: s.clean('analysis', analysis.company),
      role: s.clean('analysis', analysis.role),
      mission: s.clean('analysis', analysis.mission),
    }),
    section('Requirements', requirements),
    section(
      'Approved Alignment Matrix',
      alignment.rows.map((row) => ({
        requirement_id: row.requirement_id,
        classification: row.classification,
        citations: row.citations,
        adjacent_tool: s.clean('alignment', row.adjacent_tool),
      }))
    ),
    section(
      'Accepted Resume Edits',
      acceptedProposals.map((p) => ({
        type: p.type,
        after: s.clean('proposals', p.edited_after ?? p.after),
        citations: p.citations,
      }))
    ),
    section('Cited Evidence (full)', citedEvidence.map((r) => fullEvidence(r, s))),
  ].join('\n\n');
  return s.finish(prompt);
}

/** Rough token estimate used for context budgeting (≈4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
