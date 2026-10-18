import { expect, it } from 'vitest';
import { DraftResumeSpecSchema, ResumeSpecSchema, DEFAULT_STARTER_RESUME } from '../src/index.js';
it('persists incomplete text without weakening finalized resume requirements', () => {
  const candidate = structuredClone(DEFAULT_STARTER_RESUME);
  candidate.profile.name = '';
  candidate.experiences[0].bullets[0].text = '';
  expect(DraftResumeSpecSchema.parse(candidate)).toEqual(candidate);
  expect(ResumeSpecSchema.safeParse(candidate).success).toBe(false);
  expect(DraftResumeSpecSchema.safeParse({ ...candidate, experiences: 'wrong' }).success).toBe(false);
});

