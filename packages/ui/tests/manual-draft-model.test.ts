import { describe, it, expect } from 'vitest';
import { ManualDraftPayloadSchema, type ResumeSpec } from '@featherduster/core';
import { manualFromSpec, manualToSpec } from '../src/tailoring-drafts/manual-model';

describe('manual recovery model', () => {
  it('round trips the whole unfinished editor without regenerating identities or losing excluded bullets', () => {
    const spec: ResumeSpec = { profile: { name: 'Alex', title: 'Engineer', email: 'alex@example.com' }, summary: '', experiences: [{ company: 'Company', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Keep me', citations: ['ev-1'] }, { text: 'Excluded' }] }], education: [], skills: [] };
    let id = 0;
    const draft = manualFromSpec(spec, 'second-variant', () => `stable-${++id}`);
    draft.experiences[0].bullets[1].included = false;
    draft.experiences.push({ id: 'unfinished', company: '', role: '', startDate: '', endDate: '', bullets: [] });
    draft.education.push({ institution: '', degree: 'Work in progress', year: '' });
    draft.skills.push({ category: '', skills: ['Learning'] });
    draft.jobDescription = 'Unfinished target posting';
    draft.squeezeMode = true;
    const recovered = ManualDraftPayloadSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(recovered).toEqual(draft);
    expect(recovered.selectedResumeId).toBe('second-variant');
    expect(recovered.experiences[0].bullets[1].text).toBe('Excluded');
    expect(manualToSpec(recovered).experiences[0].bullets).toEqual([{ text: 'Keep me', citations: ['ev-1'] }]);
    expect(recovered.experiences[0].bullets).toHaveLength(2);
    expect(id).toBe(3);
  });
});
