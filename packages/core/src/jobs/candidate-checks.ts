// packages/core/src/jobs/candidate-checks.ts
import { ResumeSpecSchema, type ResumeSpec } from '../schemas/resume.js';
import { ProposalSchema, type Proposal } from '../tailoring/schemas.js';
import type { ProposalValidationContext } from '../tailoring/validators.js';
import { validateCandidateProposals } from './preparation.js';
import { redactText } from '../integrity/redaction-engine.js';
import type { DraftIssue } from './draft-validation.js';
type Rules = Parameters<typeof redactText>[1];
export function checkCandidateFields(candidate: ResumeSpec, proposals: Proposal[], context: ProposalValidationContext,
  rules?: Rules, supportFor?: (proposal: Proposal) => ProposalValidationContext['skillSupport']): DraftIssue[] {
  const shape = ResumeSpecSchema.safeParse(candidate);
  if (!shape.success) return shape.error.issues.map(i => ({ path: i.path.join('.'), code: 'required_field', severity: 'block', message: i.code === 'too_small' ? `Enter ${i.path[0] === 'profile' ? 'your ' : 'the '}${String(i.path.at(-1)).replace(/([A-Z])/g, ' $1').toLowerCase()}.` : i.message }));
  const issues: DraftIssue[] = [];
  candidate.experiences.forEach((experience, ei) => {
    const seen = new Set<string>();
    experience.bullets.forEach((bullet, bi) => {
      const key = bullet.text.trim().replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) issues.push({ path: `experiences.${ei}.bullets.${bi}.text`, code: 'duplicate_bullet', severity: 'block', message: 'Remove repeated bullet wording without deleting unique accomplishments.' });
      seen.add(key);
    });
  });
  const existingSkills = new Set(context.baseResume.skills.flatMap(group => group.skills).map(skill => skill.trim().toLowerCase()));
  candidate.skills.forEach((group, gi) => {
    const seen = new Set<string>();
    group.skills.forEach((skill, si) => {
      const key = skill.trim().toLowerCase();
      if (seen.has(key)) issues.push({ path: `skills.${gi}.skills.${si}`, code: 'duplicate_skill', severity: 'block', message: 'List each supported skill once.' });
      if (!existingSkills.has(key) && !context.skillSupport?.some(support => support.support === 'direct' && [support.skill, ...support.permitted_terms].some(term => term.trim().toLowerCase() === key)))
        issues.push({ path: `skills.${gi}.skills.${si}`, code: 'unsupported_skill', severity: 'block', message: 'This added skill needs captured direct support before publication.' });
      seen.add(key);
    });
  });
  const fields = [
    { path: 'summary', text: candidate.summary ?? '', citations: proposals.filter(p => p.type === 'summary.rewrite').flatMap(p => p.citations), ei: -1, bi: -1 },
    ...candidate.experiences.flatMap((e, ei) => e.bullets.map((b, bi) => ({ path: `experiences.${ei}.bullets.${bi}.text`, text: b.text, citations: b.citations ?? [], ei, bi }))),
  ];
  for (const f of fields) {
    if (!f.text && f.path === 'summary') continue;
    const origin = proposals.find(p => (p.edited_after ?? p.after) === f.text && JSON.stringify(p.citations) === JSON.stringify(f.citations));
    const probe = ProposalSchema.parse({ id: f.path, type: f.path === 'summary' ? 'summary.rewrite' : 'bullet.rewrite',
      target: { experience_index: f.ei, bullet_index: f.bi }, before: f.text, after: f.text, citations: f.citations });
    const checked = validateCandidateProposals([probe], { ...context, baseResume: candidate,
      skillSupport: origin && supportFor ? supportFor(origin) : context.skillSupport })[0];
    for (const i of checked.checks.filter(i => ['fact_review', 'unsupported_experience', 'unsupported_citation', 'metric_unverified', 'metric_needed'].includes(i.kind))) {
      issues.push({ path: f.path, code: i.kind, severity: i.severity, message: i.message });
    }
  }
  const scan = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (/\[METRIC NEEDED\]/i.test(value) && !issues.some(i => i.path === path && i.code === 'metric_needed'))
        issues.push({ path, code: 'metric_needed', severity: 'block', message: 'Resolve the metric placeholder.' });
      if (rules) {
        const r = redactText(value, rules);
        if (!r.isClean || r.redactedText !== value) issues.push({ path, code: 'privacy', severity: 'block', message: r.violations.join('; ') || 'Remove private wording.' });
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}.${i}`));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => scan(v, path ? `${path}.${k}` : k));
  };
  // Citation IDs bind evidence; they are not rendered resume wording. Their validity
  // is checked above. Privacy/placeholder scans apply to the content we publish.
  scan({ ...candidate, experiences: candidate.experiences.map(e => ({ ...e,
    bullets: e.bullets.map(({ citations: _citations, ...bullet }) => bullet),
  })) }, '');
  return issues;
}

