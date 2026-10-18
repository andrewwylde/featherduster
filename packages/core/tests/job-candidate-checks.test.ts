import { expect, it } from 'vitest';
import { checkCandidateFields, DEFAULT_STARTER_RESUME } from '../src/index.js';
it('checks edited text without mutating it or reapplying proposals', () => {
  const candidate = { ...structuredClone(DEFAULT_STARTER_RESUME), summary: '[METRIC NEEDED]', experiences: [] };
  const before = structuredClone(candidate);
  const issues = checkCandidateFields(candidate, [], {
    baseResume: candidate, analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] },
    alignment: { rows: [] }, evidence: [], skillSupport: [],
  });
  expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'summary', code: 'metric_needed', severity: 'block' })]));
  expect(candidate).toEqual(before);
});
it('locates empty fields before invoking claim validation', () => {
  const candidate = { ...structuredClone(DEFAULT_STARTER_RESUME), profile: { name: '', title: '', email: '' } };
  const issues = checkCandidateFields(candidate, [], {
    baseResume: candidate, analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] },
    alignment: { rows: [] }, evidence: [],
  });
  expect(issues.some(x => x.path === 'profile.name' && x.severity === 'block')).toBe(true);
});

