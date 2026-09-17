import type { EvidenceRecord } from '../parsers/index-store.js';
import type { ResumeSpec } from '../schemas/resume.js';
import { auditSlop } from '../integrity/deslop-engine.js';
import type {
  AlignmentMatrix,
  AlignmentRow,
  JobAnalysis,
  Proposal,
  ValidationIssue,
} from './schemas.js';

export const METRIC_NEEDED = '[METRIC NEEDED]';

export type SlopBand = 'low' | 'moderate' | 'high';
const BAND_RANK: Record<string, number> = { clean: 0, low: 1, moderate: 2, high: 3 };

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive whole-term containment that tolerates terms like "C++" or "Node.js". */
export function containsTerm(haystack: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(t)}(?![A-Za-z0-9])`, 'i');
  return re.test(haystack);
}

type EvidenceLookup = (id: string) => EvidenceRecord | undefined;

function lookupFrom(evidence: EvidenceRecord[] | Map<string, EvidenceRecord>): EvidenceLookup {
  if (evidence instanceof Map) return (id) => evidence.get(id);
  const map = new Map(evidence.map((r) => [r.id, r]));
  return (id) => map.get(id);
}

// ---------------------------------------------------------------------------
// Gate 0
// ---------------------------------------------------------------------------

/** Flags requirements whose quote does not occur (whitespace/case-normalized) in the posting. */
export function validateAnalysis(analysis: JobAnalysis, posting: string): JobAnalysis {
  const normalizedPosting = normalizeWs(posting);
  const seen = new Set<string>();
  return {
    ...analysis,
    requirements: analysis.requirements.map((req, idx) => {
      let id = req.id.trim() || `r${idx + 1}`;
      while (seen.has(id)) id = `${id}-${idx + 1}`;
      seen.add(id);
      const quote = normalizeWs(req.quote);
      const ungrounded = !quote || !normalizedPosting.includes(quote);
      return { ...req, id, ungrounded };
    }),
  };
}

// ---------------------------------------------------------------------------
// Gate 1
// ---------------------------------------------------------------------------

export function validateAlignmentRow(
  row: AlignmentRow,
  analysis: JobAnalysis,
  evidence: EvidenceRecord[] | Map<string, EvidenceRecord>
): AlignmentRow {
  const lookup = lookupFrom(evidence);
  const issues: ValidationIssue[] = [];

  if (!analysis.requirements.some((r) => r.id === row.requirement_id)) {
    issues.push({ severity: 'block', kind: 'unknown_requirement', message: `Unknown requirement "${row.requirement_id}".` });
  }

  const unresolved = row.citations.filter((c) => !lookup(c));
  if (unresolved.length > 0) {
    issues.push({
      severity: 'block',
      kind: 'unresolved_citation',
      message: `Cited evidence does not exist: ${unresolved.join(', ')}.`,
    });
  }

  const liveCitations = row.citations.filter((c) => {
    const rec = lookup(c);
    return rec && rec.entry.confidence !== 'retracted';
  });

  if (row.classification === 'backed' && liveCitations.length === 0 && !row.candidate_confirmed) {
    issues.push({
      severity: 'block',
      kind: 'backed_without_evidence',
      message: 'Marked "backed" but cites no verified or provisional evidence.',
    });
  }
  if (row.classification === 'gap' && row.citations.length > 0) {
    issues.push({ severity: 'warn', kind: 'gap_with_citations', message: 'Marked "gap" but cites evidence.' });
  }
  if (row.classification === 'transferable' && !row.adjacent_tool.trim()) {
    issues.push({
      severity: 'warn',
      kind: 'transferable_without_tool',
      message: 'Transferable requirement should name the adjacent tool actually used.',
    });
  }
  const provisionalOnly =
    liveCitations.length > 0 &&
    liveCitations.every((c) => lookup(c)?.entry.confidence === 'provisional');
  if (row.classification === 'backed' && provisionalOnly) {
    issues.push({ severity: 'warn', kind: 'provisional_only', message: 'Backed only by provisional evidence.' });
  }

  return { ...row, issues };
}

/**
 * Validates every row and guarantees exactly one row per requirement
 * (missing requirements are added as unclassified gaps with a warning).
 */
export function validateAlignment(
  matrix: AlignmentMatrix,
  analysis: JobAnalysis,
  evidence: EvidenceRecord[] | Map<string, EvidenceRecord>
): AlignmentMatrix {
  const byReq = new Map<string, AlignmentRow>();
  for (const row of matrix.rows) {
    if (!byReq.has(row.requirement_id)) byReq.set(row.requirement_id, row);
  }
  const rows: AlignmentRow[] = [];
  for (const req of analysis.requirements) {
    const row = byReq.get(req.id);
    if (row) {
      rows.push(validateAlignmentRow(row, analysis, evidence));
      byReq.delete(req.id);
    } else {
      rows.push({
        requirement_id: req.id,
        classification: 'gap',
        citations: [],
        rationale: '',
        adjacent_tool: '',
        candidate_confirmed: false,
        issues: [{ severity: 'warn', kind: 'missing_row', message: 'Model did not classify this requirement.' }],
      });
    }
  }
  // Rows for unknown requirements are kept (flagged) so the user can see them.
  for (const row of byReq.values()) {
    rows.push(validateAlignmentRow(row, analysis, evidence));
  }
  return { rows };
}

export function alignmentSummary(matrix: AlignmentMatrix): Record<'backed' | 'transferable' | 'gap', number> {
  const counts = { backed: 0, transferable: 0, gap: 0 };
  for (const row of matrix.rows) counts[row.classification] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Gate 2
// ---------------------------------------------------------------------------

export interface ProposalValidationContext {
  analysis: JobAnalysis;
  alignment: AlignmentMatrix;
  baseResume: ResumeSpec;
  evidence: EvidenceRecord[] | Map<string, EvidenceRecord>;
  deslopWarnBand?: SlopBand;
}

const NUMBER_TOKEN = /(?<![A-Za-z0-9.])\d(?:[\d,.]*\d)?(?:\s?(?:%|x|ms|s|k|m|b|K|M|B|\+)(?![A-Za-z]))?/g;

function numberTokens(text: string): string[] {
  return (text.match(NUMBER_TOKEN) ?? []).map((t) => t.trim()).filter((t) => /\d/.test(t));
}

function evidenceText(rec: EvidenceRecord): string {
  const e = rec.entry;
  return [
    e.title,
    e.summary,
    e.impact,
    e.themes.join(' '),
    e.metrics.map((m) => `${m.name} ${m.value}`).join(' '),
    rec.narrative,
  ].join('\n');
}

function verifiedMetricText(rec: EvidenceRecord): string {
  return [
    rec.entry.impact,
    rec.entry.summary,
    rec.narrative,
    rec.entry.metrics
      .filter((m) => m.status.toLowerCase() === 'verified')
      .map((m) => `${m.name} ${m.value}`)
      .join(' '),
  ].join('\n');
}

/** Terms whose appearance in proposal text triggers Ledger Ceiling checks. */
export function ledgerVocabulary(
  analysis: JobAnalysis,
  baseResume: ResumeSpec,
  evidence: EvidenceRecord[]
): string[] {
  const terms = new Set<string>();
  analysis.requirements.forEach((r) => r.terms.forEach((t) => t.trim() && terms.add(t.trim())));
  baseResume.skills.forEach((g) => g.skills.forEach((s) => s.trim() && terms.add(s.trim())));
  evidence.forEach((r) => r.entry.themes.forEach((t) => t.trim() && terms.add(t.trim())));
  return Array.from(terms);
}

export function effectiveAfter(p: Proposal): string {
  return p.edited_after ?? p.after;
}

function resolveBefore(p: Proposal, resume: ResumeSpec): string | undefined {
  const exp = resume.experiences[p.target.experience_index];
  switch (p.type) {
    case 'summary.rewrite':
      return resume.summary ?? '';
    case 'bullet.rewrite':
    case 'bullet.drop':
      return exp?.bullets[p.target.bullet_index]?.text;
    default:
      return '';
  }
}

function checkTarget(p: Proposal, resume: ResumeSpec): ValidationIssue | null {
  const exp = resume.experiences[p.target.experience_index];
  const bad = (message: string): ValidationIssue => ({ severity: 'block', kind: 'invalid_target', message });
  switch (p.type) {
    case 'summary.rewrite':
      return effectiveAfter(p).trim() ? null : bad('Summary rewrite is empty.');
    case 'bullet.rewrite':
      if (!exp || !exp.bullets[p.target.bullet_index]) return bad('Target bullet does not exist.');
      return effectiveAfter(p).trim() ? null : bad('Rewritten bullet is empty.');
    case 'bullet.drop':
      return exp && exp.bullets[p.target.bullet_index] ? null : bad('Target bullet does not exist.');
    case 'bullet.add':
      if (!exp) return bad('Target experience does not exist.');
      return effectiveAfter(p).trim() ? null : bad('New bullet is empty.');
    case 'bullet.reorder': {
      if (!exp) return bad('Target experience does not exist.');
      const n = exp.bullets.length;
      const valid =
        p.order.length > 0 &&
        new Set(p.order).size === p.order.length &&
        p.order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
      return valid ? null : bad('Reorder is not a valid permutation of existing bullets.');
    }
    case 'skills.reorder':
    case 'skills.prune': {
      const group = resume.skills[p.target.skill_group_index];
      if (!group) return bad('Target skill group does not exist.');
      return p.skills.length > 0 ? null : bad('No skills listed.');
    }
  }
}

/**
 * Annotates a proposal with checks. Never drops proposals; ungrounded numbers in
 * `after` are replaced with [METRIC NEEDED] (only when the user has not edited it).
 */
export function validateProposal(proposal: Proposal, ctx: ProposalValidationContext): Proposal {
  const lookup = lookupFrom(ctx.evidence);
  const allEvidence = ctx.evidence instanceof Map ? Array.from(ctx.evidence.values()) : ctx.evidence;
  const checks: ValidationIssue[] = [];
  let p: Proposal = { ...proposal };

  const actualBefore = resolveBefore(p, ctx.baseResume);
  if (actualBefore !== undefined && (p.type === 'bullet.rewrite' || p.type === 'bullet.drop' || p.type === 'summary.rewrite')) {
    p.before = actualBefore;
  }

  const targetIssue = checkTarget(p, ctx.baseResume);
  if (targetIssue) checks.push(targetIssue);

  // Citations
  const unresolved = p.citations.filter((c) => !lookup(c));
  if (unresolved.length > 0) {
    checks.push({ severity: 'block', kind: 'unresolved_citation', message: `Cited evidence does not exist: ${unresolved.join(', ')}.` });
  }
  const cited = p.citations
    .map((c) => lookup(c))
    .filter((r): r is EvidenceRecord => !!r && r.entry.confidence !== 'retracted');
  const textual = p.type === 'summary.rewrite' || p.type === 'bullet.rewrite' || p.type === 'bullet.add';
  if (textual && cited.length === 0) {
    checks.push({ severity: 'block', kind: 'ledger_ceiling', message: 'Text edits must cite at least one non-retracted evidence entry.' });
  }

  const confirmedTerms = new Set(
    ctx.alignment.rows
      .filter((row) => row.candidate_confirmed)
      .flatMap((row) => ctx.analysis.requirements.find((r) => r.id === row.requirement_id)?.terms ?? [])
      .map((t) => t.toLowerCase())
  );
  // Terms of requirements the user approved as "backed" count as grounded when this edit
  // cites that row's evidence (vocabulary harmonization, e.g. "observability" for tracing work).
  // Transferable/gap requirement terms (e.g. the posting's "Kafka") never qualify.
  const citedIds = new Set(cited.map((r) => r.id));
  const backedTerms = new Set(
    ctx.alignment.rows
      .filter((row) => row.classification === 'backed' && row.citations.some((c) => citedIds.has(c)))
      .flatMap((row) => ctx.analysis.requirements.find((r) => r.id === row.requirement_id)?.terms ?? [])
      .map((t) => t.toLowerCase())
  );
  const baseSkills = ctx.baseResume.skills.flatMap((g) => g.skills);

  // Ledger Ceiling for text edits
  if (textual) {
    const after = effectiveAfter(p);
    const before = p.before ?? '';
    const grounding = cited.map(evidenceText).join('\n');
    const vocabulary = ledgerVocabulary(ctx.analysis, ctx.baseResume, allEvidence);
    const unbacked = vocabulary.filter(
      (term) =>
        containsTerm(after, term) &&
        !containsTerm(before, term) &&
        !containsTerm(grounding, term) &&
        !baseSkills.some((s) => s.toLowerCase() === term.toLowerCase()) &&
        !confirmedTerms.has(term.toLowerCase()) &&
        !backedTerms.has(term.toLowerCase())
    );
    if (unbacked.length > 0) {
      checks.push({
        severity: 'block',
        kind: 'ledger_ceiling',
        message: `Introduces terms not backed by cited evidence: ${unbacked.join(', ')}.`,
      });
    }

    // Metric grounding
    const metricGrounding = cited.map(verifiedMetricText).join('\n');
    const beforeNumbers = new Set(numberTokens(before));
    const ungrounded = numberTokens(after).filter(
      (n) => !beforeNumbers.has(n) && !metricGrounding.includes(n.replace(/\s/g, '')) && !metricGrounding.includes(n)
    );
    if (ungrounded.length > 0) {
      if (p.edited_after === undefined) {
        let replaced = p.after;
        for (const n of ungrounded) {
          const re = new RegExp(`(?<![A-Za-z0-9.])${escapeRegExp(n)}(?![A-Za-z0-9])`, 'g');
          replaced = replaced.replace(re, METRIC_NEEDED);
        }
        p.after = replaced;
        checks.push({
          severity: 'warn',
          kind: 'metric_needed',
          message: `Unverified numbers replaced with ${METRIC_NEEDED}: ${ungrounded.join(', ')}.`,
        });
      } else {
        checks.push({
          severity: 'warn',
          kind: 'metric_unverified',
          message: `Numbers not found in verified evidence: ${ungrounded.join(', ')}.`,
        });
      }
    }

    // De-slop
    const audit = auditSlop(effectiveAfter(p));
    const warnBand = ctx.deslopWarnBand ?? 'moderate';
    if (!audit.isClean && BAND_RANK[audit.slopBand] >= BAND_RANK[warnBand]) {
      checks.push({ severity: 'warn', kind: 'deslop', message: audit.summary });
    } else if (!audit.isClean) {
      checks.push({ severity: 'warn', kind: 'deslop_minor', message: audit.summary });
    }
  }

  // Ledger Ceiling for skills: reorder must not add skills
  if (p.type === 'skills.reorder') {
    const group = ctx.baseResume.skills[p.target.skill_group_index];
    if (group) {
      const existing = new Set(group.skills.map((s) => s.toLowerCase()));
      const added = p.skills.filter((s) => !existing.has(s.toLowerCase()));
      if (added.length > 0) {
        checks.push({ severity: 'block', kind: 'ledger_ceiling', message: `Reorder adds skills not on the resume: ${added.join(', ')}.` });
      }
    }
  }

  return { ...p, checks };
}

export function validateProposals(proposals: Proposal[], ctx: ProposalValidationContext): Proposal[] {
  const seen = new Set<string>();
  return proposals.map((p, idx) => {
    let id = p.id.trim() || `p${idx + 1}`;
    while (seen.has(id)) id = `${id}-${idx + 1}`;
    seen.add(id);
    return validateProposal({ ...p, id }, ctx);
  });
}

export function isBlocked(p: Proposal): boolean {
  return p.checks.some((c) => c.severity === 'block');
}
