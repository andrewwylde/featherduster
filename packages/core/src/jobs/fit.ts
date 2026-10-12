import { z } from 'zod';
import type { EvidenceRecord } from '../parsers/index-store.js';
import { AlignmentMatrixSchema, JobAnalysisSchema } from '../tailoring/schemas.js';
import type { AlignmentMatrix, JobAnalysis, ValidationIssue } from '../tailoring/schemas.js';
import { validateAlignment } from '../tailoring/validators.js';
import { CandidateProfileSchema, FitAssessmentSchema, MoneyPreferenceSchema, PostingFitProvenanceSchema } from './schemas.js';
import type { CandidatePreference, CandidateProfile, FitAssessment } from './schemas.js';

const salary = MoneyPreferenceSchema.omit({ amount: true }).extend({
  min: z.number().finite().nonnegative().nullable(), max: z.number().finite().nonnegative().nullable(),
}).strict().refine(s => s.min === null || s.max === null || s.min <= s.max, { message: 'Salary minimum exceeds maximum.' });
// Missing source or value remains unknown; it cannot establish a mismatch.
const fact = <T extends z.ZodTypeAny>(value: T) => z.object({ value: value.nullable(), provenance: PostingFitProvenanceSchema.nullable() }).strict().optional();
const labels = z.array(z.string().trim().min(1)).min(1);
export const PostingFitFactsSchema = z.object({
  base_salary: fact(salary), total_compensation: fact(salary), employment_type: fact(labels),
  location_eligibility: fact(labels), role_level: fact(labels), relocation: fact(z.boolean()),
  sponsorship: fact(z.boolean()), working_hour_overlap: fact(z.number().finite().min(0).max(24)),
}).strict();
export type PostingFitFacts = z.infer<typeof PostingFitFactsSchema>;
export interface AssessJobFitInput {
  id: string;
  job_id: string;
  workspace_id: string;
  posting_snapshot_id: string;
  assessed_at: string;
  profile: CandidateProfile;
  analysis: JobAnalysis;
  alignment: AlignmentMatrix;
  evidence: EvidenceRecord[];
  posting_facts: PostingFitFacts;
}

function compare(preference: CandidatePreference, facts: PostingFitFacts, snapshot: string): FitAssessment['comparisons'][number] {
  const source = facts[preference.field];
  const base = { preference_id: preference.id, strength: preference.strength, provenance: source?.provenance ?? null };
  const unknown = (reason: string): FitAssessment['comparisons'][number] => ({ ...base, result: 'unknown', reason });
  if (!source || source.value === null || !source.provenance || source.provenance.snapshot_id !== snapshot) {
    return unknown(`No sourced ${preference.field} value for this posting snapshot.`);
  }
  let matches: boolean;
  switch (preference.field) {
    case 'base_salary': case 'total_compensation': {
      const value = facts[preference.field]!.value!;
      if (value.max === null || value.currency !== preference.value.currency || value.period !== preference.value.period) {
        return unknown('Salary upper bound, currency or period is unavailable or incomparable.');
      }
      matches = value.max >= preference.value.amount;
      break;
    }
    case 'employment_type': case 'location_eligibility': case 'role_level': {
      const value = facts[preference.field]!.value!;
      matches = preference.value.some(wanted => value.some(actual => actual.toLowerCase() === wanted.toLowerCase()));
      break;
    }
    case 'relocation': case 'sponsorship': matches = facts[preference.field]!.value === preference.value; break;
    case 'working_hour_overlap': matches = facts.working_hour_overlap!.value! >= preference.value; break;
  }
  return { ...base, result: matches ? 'match' : 'mismatch', reason: `${preference.field} ${matches ? 'meets' : 'does not meet'} the candidate ${preference.strength}.` };
}

/** Pure assessment: never upgrades evidence, grants approval, or changes job state. */
export function assessJobFit(input: AssessJobFitInput): FitAssessment {
  const profile = CandidateProfileSchema.parse(input.profile);
  if (profile.workspace_id !== input.workspace_id) throw new Error('Fit profile belongs to a different workspace.');
  const analysis = JobAnalysisSchema.parse(input.analysis);
  const matrix = AlignmentMatrixSchema.parse(input.alignment);
  const facts = PostingFitFactsSchema.parse(input.posting_facts);
  const issues: ValidationIssue[] = [];
  const warn = (kind: string, message: string) => issues.push({ severity: 'warn', kind, message });
  const requirements = new Map(analysis.requirements.map(r => [r.id, r]));
  if (requirements.size !== analysis.requirements.length) warn('duplicate_requirement', 'Analysis contains duplicate requirement identities.');
  if (new Set(matrix.rows.map(r => r.requirement_id)).size !== matrix.rows.length) warn('duplicate_row', 'Duplicate alignment rows were ignored after the first row.');
  const validated = validateAlignment(matrix, { ...analysis, requirements: [...requirements.values()] }, input.evidence);
  const evidence = new Map(input.evidence.map(e => [e.id, e]));
  const coverage = { backed: 0, transferable: 0, gap: 0 };
  const material_gap_requirement_ids: string[] = [];
  for (const row of validated.rows) {
    const live = row.citations.map(c => evidence.get(c)).filter(e => e && e.entry.confidence !== 'retracted');
    if (row.classification === 'transferable' && live.length === 0) {
      row.issues = [...(row.issues ?? []), {
        severity: 'block', kind: 'transferable_without_evidence',
        message: `Requirement ${row.requirement_id} has no live evidence supporting transferability.`,
      }];
    }
    // Revalidation must not erase diagnostics supplied by earlier checks.
    const priorIssues = matrix.rows.find(r => r.requirement_id === row.requirement_id)?.issues ?? [];
    for (const issue of priorIssues) {
      if (!row.issues?.some(existing => existing.severity === issue.severity && existing.kind === issue.kind && existing.message === issue.message)) {
        row.issues = [...(row.issues ?? []), issue];
      }
    }
    issues.push(...(row.issues ?? []));
    const requirement = requirements.get(row.requirement_id);
    if (!requirement) continue;
    let classification = row.classification;
    if (row.issues?.some(i => i.severity === 'block') || (classification === 'transferable' && live.length === 0)) classification = 'gap';
    coverage[classification]++;
    const grounded = !requirement.ungrounded && !!requirement.quote.trim();
    if (!grounded) warn('ungrounded_requirement', `Requirement ${requirement.id} is not grounded in posting text.`);
    if (grounded && requirement.tier === 'must' && classification === 'gap') material_gap_requirement_ids.push(requirement.id);
    if (live.some(e => e?.entry.in_flight)) warn('in_flight_evidence', `Requirement ${requirement.id} cites in-flight work, not shipped work.`);
  }
  if (requirements.size === 0) warn('empty_requirements', 'No requirements were extracted.');
  const comparisons = profile.preferences.map(p => compare(p, facts, input.posting_snapshot_id));
  const hardMismatch = comparisons.some(c => c.strength === 'requirement' && c.result === 'mismatch');
  const needsReview = issues.length > 0 || coverage.transferable > 0 || coverage.gap > 0 || comparisons.some(c => c.result !== 'match');
  return FitAssessmentSchema.parse({
    schema_version: 1, id: input.id, job_id: input.job_id, workspace_id: input.workspace_id,
    posting_snapshot_id: input.posting_snapshot_id, profile_id: profile.id, assessed_at: input.assessed_at,
    recommendation: hardMismatch ? 'unsuitable' : needsReview ? 'review' : 'suitable',
    rows: validated.rows, coverage, material_gap_requirement_ids, comparisons, issues,
  });
}
