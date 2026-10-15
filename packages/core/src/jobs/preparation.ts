import { supportsTerm } from '../corpus/knowledge.js';
import type { z } from 'zod';
import type { ResumeSpec } from '../schemas/resume.js';
import type { EvidenceRecord } from '../parsers/index-store.js';
import { auditSlop, cleanSlop } from '../integrity/deslop-engine.js';
import { applyProposals } from '../tailoring/apply.js';
import { containsTerm, effectiveAfter, isBlocked, validateProposals, type ProposalValidationContext } from '../tailoring/validators.js';
import { TAILORING_STEPS, type Proposal, type StepRecord, type TailoringStep, type ValidationIssue } from '../tailoring/schemas.js';
import { InputSnapshotSchema, type InputSnapshot, type PreparationPolicy } from './schemas.js';

export function completeCandidateStep(record: StepRecord, inputFingerprint: string, completedAt: string): StepRecord {
  return { ...structuredClone(record), status: 'done', input_hash: inputFingerprint, completed_at: completedAt, error: null };
}

export function canUsePreparationStep(mode: PreparationPolicy['mode'], record: StepRecord, currentInputFingerprint: string, issues: ValidationIssue[]): boolean {
  return !!record.input_hash && record.input_hash === currentInputFingerprint &&
    (record.status === 'approved' || (mode === 'candidate' && record.status === 'done')) &&
    !issues.some(i => i.severity === 'block');
}

const block = (kind: string, message: string): ValidationIssue => ({ severity: 'block', kind, message });
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inlineCitations = (text: string): string[] => text.match(/\bev-\d+\b/g) ?? [];
const NUMBER = /(?<![\w.])\d+(?:[,.]\d+)*(?:\s?(?:%|ms|s|[kKmMbB]|x|\+)(?![A-Za-z]))?(?!\w|\.\d)/g;
const TECH_VERSION = /\b(?:Node\.js|Python|Go|Java|React|TypeScript|PostgreSQL|Redis|Kubernetes|Rust|\.NET)\s+v?\d+(?:\.\d+)*\b|\bv\d+(?:\.\d+)+\b/gi;

function numbers(text: string, citationIds: string[] = []): string[] {
  let prose = text.replace(/\bev-\d+\b/g, ' ').replace(TECH_VERSION, ' ');
  for (const id of citationIds) prose = prose.replace(new RegExp(`(?<![\\w])${escapeRegex(id)}(?![\\w])`, 'g'), ' ');
  return (prose.match(NUMBER) ?? []).map(n => n.replace(/\s/g, ''));
}

function evidenceMap(context: Pick<ProposalValidationContext, 'evidence'>): Map<string, EvidenceRecord> {
  return context.evidence instanceof Map ? context.evidence : new Map(context.evidence.map(r => [r.id, r]));
}

function citationIssues(text: string, citations: string[], evidence: Map<string, EvidenceRecord>): ValidationIssue[] {
  return [...new Set([...citations, ...inlineCitations(text)])].flatMap(id => {
    const record = evidence.get(id);
    return !record || record.entry.confidence === 'retracted'
      ? [block('unsupported_citation', `Citation "${id}" is missing or retracted.`)] : [];
  });
}

function placeholderIssues(text: string): ValidationIssue[] {
  return /\[METRIC NEEDED\]/i.test(text) ? [block('metric_needed', 'Candidate contains an unresolved metric placeholder.')] : [];
}

/** Deterministic evidence-bound checks, not general natural-language fact verification. */
export function validateCandidateProposals(proposals: Proposal[], context: ProposalValidationContext): Proposal[] {
  const originals = structuredClone(proposals);
  const evidence = evidenceMap(context);
  // Machine classifications/confirmations must never grant human authority.
  const delegated = validateProposals(originals, { ...context, alignment: { rows: [] } });
  return delegated.map((validated, index) => {
    const original = originals[index];
    const p = { ...validated, after: original.after, edited_after: original.edited_after };
    const text = effectiveAfter(p);
    const checks = [...original.checks, ...validated.checks.filter(c => !['metric_needed', 'metric_unverified'].includes(c.kind))];
    checks.push(...citationIssues(text, p.citations, evidence));
    if (['summary.rewrite', 'bullet.rewrite', 'bullet.add'].includes(p.type)) {
      checks.push(...placeholderIssues(text));
      const cited = [...new Set([...p.citations, ...inlineCitations(text)])].map(id => evidence.get(id))
        .filter((r): r is EvidenceRecord => !!r && r.entry.confidence !== 'retracted');
      const supportedNumbers = new Set<string>();
      for (const record of cited) {
        if (record.entry.confidence !== 'verified') continue;
        const e = record.entry;
        const unverified = new Set(e.metrics.filter(m => m.status.toLowerCase() !== 'verified').flatMap(m => numbers(m.value)));
        const prose = [e.title, e.summary, e.impact, record.narrative].join('\n');
        const claims = [...numbers(prose), ...e.metrics.filter(m => m.status.toLowerCase() === 'verified').flatMap(m => numbers(m.value))];
        claims.filter(n => !unverified.has(n)).forEach(n => supportedNumbers.add(n));
      }
      const unsupported = numbers(text, [...evidence.keys()]).filter(n => !supportedNumbers.has(n));
      if (unsupported.length) checks.push(block('metric_unverified', `Numbers not supported by cited verified evidence: ${[...new Set(unsupported)].join(', ')}.`));
      // Check all posting vocabulary, including omitted requirement_ids and terms already on the base.
      const grounding = cited.map(r => [r.entry.title, r.entry.summary, r.entry.impact, r.entry.themes.join(' '), r.narrative].join('\n')).join('\n');
      const terms = context.analysis.requirements.flatMap(r => r.terms)
        .filter(term => containsTerm(text, term) && !containsTerm(grounding, term) && !supportsTerm(term, p.citations, cited, context.skillSupport ?? []));
      if (terms.length) checks.push(block('unsupported_experience', `Direct experience is not supported by cited evidence: ${[...new Set(terms)].join(', ')}.`));
    }
    p.checks = checks.filter((issue, i) => checks.findIndex(other => other.kind === issue.kind && other.severity === issue.severity && other.message === issue.message) === i);
    return p;
  });
}

export interface CandidateApplicationResult {
  candidate: ResumeSpec;
  proposals: Proposal[];
  appliedProposalIds: string[];
  issues: ValidationIssue[];
  valid: boolean;
}

/** Applies a working copy; neither this result nor its machine checks are human approval. */
export function applyCandidateProposals(baseResume: ResumeSpec, proposals: Proposal[], context: Omit<ProposalValidationContext, 'baseResume'>, supportFor?: (proposal: Proposal) => ProposalValidationContext['skillSupport']): CandidateApplicationResult {
  const validated = supportFor ? proposals.flatMap(p => validateCandidateProposals([p], { ...context, baseResume, skillSupport: supportFor(p) })) : validateCandidateProposals(proposals, { ...context, baseResume });
  const selected = validated.filter(p => p.decision !== 'rejected' && !isBlocked(p));
  const candidate = applyProposals(structuredClone(baseResume), structuredClone(selected).map(p => ({ ...p, decision: 'accepted' })));
  const issues = validated.filter(p => p.decision !== 'rejected').flatMap(p => p.checks);
  const evidence = evidenceMap(context);
  for (const field of [{ text: candidate.summary ?? '', citations: [] }, ...candidate.experiences.flatMap(e => e.bullets)]) {
    issues.push(...placeholderIssues(field.text), ...citationIssues(field.text, field.citations ?? [], evidence));
  }
  return structuredClone({ candidate, proposals: validated, appliedProposalIds: selected.map(p => p.id), issues, valid: !issues.some(i => i.severity === 'block') });
}

export interface CandidateDeslopEdit {
  path: string;
  before: string;
  after: string;
  fixes: string[];
}
export interface CandidateDeslopResult {
  candidate: ResumeSpec;
  edits: CandidateDeslopEdit[];
  issues: ValidationIssue[];
}

/** Protect byte-exact tokens locally; shared manual de-slop behavior remains unchanged. */
export function deslopCandidate(input: ResumeSpec, protectedTechnicalTokens: string[] = []): CandidateDeslopResult {
  const candidate = structuredClone(input);
  const edits: CandidateDeslopEdit[] = [];
  const issues: ValidationIssue[] = [];
  const vocabulary = [...new Set([...protectedTechnicalTokens, ...candidate.skills.flatMap(g => g.skills)])].filter(Boolean).sort((a, b) => b.length - a.length);
  const patterns = [
    '```[\\s\\S]*?```', '`[^`\\r\\n]+`', '\\[[^\\]\\r\\n]+\\]', '\\bev-\\d+\\b',
    ...vocabulary.map(t => `(?<![A-Za-z0-9])${escapeRegex(t)}(?![A-Za-z0-9])`),
    NUMBER.source,
    '\\b[A-Za-z][A-Za-z0-9]*(?:[.+_/-][A-Za-z0-9+]+)+',
    '\\b(?:[A-Za-z]+\\d+[A-Za-z0-9]*|[a-z]+[A-Z][A-Za-z]*|[A-Z]{2,})\\b',
  ];
  const protectedPattern = new RegExp(patterns.join('|'), 'g');
  function clean(before: string, path: string): string {
    let prefix = 'ZPROTECTED';
    while (before.includes(prefix)) prefix += 'Z';
    const tokens: string[] = [];
    const masked = before.replace(protectedPattern, token => `${prefix}${tokens.push(token) - 1}Z`);
    // Iterate to a fixed point for nested stems/intensifiers, bounded by input length.
    let cleaned = masked;
    const fixes: string[] = [];
    for (let i = 0; i <= before.length; i++) {
      const result = cleanSlop(cleaned);
      fixes.push(...result.fixesApplied);
      if (result.cleanedText === cleaned) break;
      cleaned = result.cleanedText;
    }
    const markers = new RegExp(`${prefix}\\d+Z`, 'g');
    const expected = tokens.map((_, i) => `${prefix}${i}Z`);
    if (JSON.stringify(cleaned.match(markers) ?? []) !== JSON.stringify(expected)) {
      issues.push(block('deslop_preservation', `${path}: protected tokens changed; original prose retained.`));
      return before;
    }
    const after = cleaned.replace(markers, marker => tokens[Number(marker.slice(prefix.length, -1))]);
    if (after !== before) edits.push({ path, before, after, fixes });
    const audit = auditSlop(after);
    if (!audit.isClean) issues.push({ severity: 'warn', kind: 'deslop', message: `${path}: ${audit.summary}` });
    return after;
  }
  if (candidate.summary !== undefined) candidate.summary = clean(candidate.summary, 'summary');
  candidate.experiences.forEach((e, ei) => e.bullets.forEach((b, bi) => {
    b.text = clean(b.text, `experiences.${ei}.bullets.${bi}.text`);
  }));
  return { candidate, edits, issues };
}

const SnapshotInputSchema = InputSnapshotSchema.omit({ fingerprint: true, policy_fingerprint: true });
export type CreateInputSnapshotInput = z.input<typeof SnapshotInputSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** References must already identify immutable content; this helper never reads files. */
export async function createInputSnapshot(input: CreateInputSnapshotInput): Promise<InputSnapshot> {
  const parsed = SnapshotInputSchema.parse(input);
  const policy_fingerprint = await fingerprint(parsed.policy);
  const { id: _id, created_at: _created, ...dependencies } = parsed;
  return { ...parsed, policy_fingerprint, fingerprint: await fingerprint({ ...dependencies, policy_fingerprint }) };
}

export function invalidatePreparationSteps<T extends Partial<Record<TailoringStep, StepRecord>>>(steps: T, currentInputFingerprint: string): T {
  const result = structuredClone(steps);
  let stale = false;
  for (const step of TAILORING_STEPS) {
    if (!result[step]) continue;
    const record = structuredClone(result[step]);
    result[step] = record;
    const completed = record.status === 'done' || record.status === 'approved';
    if (record.status === 'stale' || (completed && (!record.input_hash || record.input_hash !== currentInputFingerprint))) stale = true;
    if (stale && (completed || record.status === 'stale' || record.raw_output !== null || record.completed_at !== null)) record.status = 'stale';
  }
  return result;
}

export interface PreparationOutputBinding {
  workspace_id: string;
  job_id: string;
  input_fingerprint: string | null;
  input_snapshot_id?: string | null;
}

/** Freshness only: this does not certify artifact validity or human approval. */
export function isPreparationOutputCurrent(output: PreparationOutputBinding, snapshot: InputSnapshot): boolean {
  return output.workspace_id === snapshot.workspace_id && output.job_id === snapshot.job_id &&
    !!output.input_fingerprint && output.input_fingerprint === snapshot.fingerprint &&
    (output.input_snapshot_id === undefined || output.input_snapshot_id === snapshot.id);
}
