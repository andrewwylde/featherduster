import { expect, it } from 'vitest';
import { applyProposalPatches, applyProposals, makeAccomplishmentOmission, validateOmissionTargets, overlappingProposalIds, ProposalSchema, computeArtifactChanges, type ProposalPatch, type ResumeSpec } from '../src/index.js';
const base: ResumeSpec = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Migrated LinkedUp tests.' }, { text: 'Kept separate work.' }] }], skills: [], education: [] };
const rewrite = ProposalSchema.parse({ id: 'rewrite', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0 }, before: base.experiences[0].bullets[0].text, after: 'Migrated tests for the LinkedUp reference application.', citations: [] });
const omission = { proposal_id: 'user-omission:test', omission: { experience_index: 0, anchor: { company: 'Acme', role: 'Engineer', startDate: '2020' }, text: rewrite.after, replaces_proposal_id: rewrite.id, source_bullets: [{ bullet_index: 0, before: rewrite.before }] } } as unknown as ProposalPatch;
const candidate = (patches: ProposalPatch[]) => applyProposals(base, applyProposalPatches([rewrite], [], patches).proposals.filter(p => p.decision !== 'rejected').map(p => ({ ...p, decision: 'accepted', checks: [] })));
it('leaves out a rewritten accomplishment without restoring its original and restores it atomically', () => {
  expect(candidate([omission]).experiences[0].bullets.map(b => b.text)).toEqual(['Kept separate work.']);
  expect(candidate([{ ...omission, decision: 'rejected' }]).experiences[0].bullets.map(b => b.text)).toEqual([rewrite.after, 'Kept separate work.']);
  expect(base.experiences[0].bullets).toHaveLength(2);
});
it('retains unrelated edits when restoring a user omission', () => {
  const edit: ProposalPatch = { proposal_id: 'rewrite', edited_after: 'Migrated LinkedUp UI tests.' };
  const local = { ...omission, omission: { ...(omission as any).omission, text: edit.edited_after } } as ProposalPatch;
  const overlay = applyProposalPatches([rewrite], [edit, local], [{ proposal_id: local.proposal_id, decision: 'rejected' }]);
  expect(overlay.proposals.find(p => p.id === 'rewrite')?.edited_after).toBe(edit.edited_after);
});


it('omits an unchanged original bullet and validates its captured employer and text', () => {
  const omit = makeAccomplishmentOmission(base, [], 'experiences.0.bullets.0.text', base.experiences[0].bullets[0].text, 'original');
  expect(() => validateOmissionTargets(base, [omit])).not.toThrow();
  const changed = structuredClone(base); changed.experiences[0].bullets.reverse();
  expect(() => validateOmissionTargets(changed, [omit])).toThrow(/targets changed/);
  const moved = structuredClone(base); moved.experiences[0].company = 'Different employer';
  expect(() => validateOmissionTargets(moved, [omit])).toThrow(/targets changed/);
  const overlay = applyProposalPatches([], [], [omit]);
  expect(applyProposals(base, overlay.proposals.map(p => ({ ...p, decision: 'accepted' }))).experiences[0].bullets).toHaveLength(1);
  expect(applyProposalPatches([], [omit], [{ proposal_id: omit.proposal_id, decision: 'rejected' }]).proposals).toEqual([]);
});
it('omits and restores a consolidation atomically without reviving its source bullets', () => {
  const merge = ProposalSchema.parse({ id: 'merge', type: 'bullet.consolidate', target: { experience_index: 0, bullet_index: 0 }, source_bullets: base.experiences[0].bullets.map((b, bullet_index) => ({ bullet_index, before: b.text })), after: 'Consolidated work.', citations: [] });
  const omit = makeAccomplishmentOmission(base, [merge], 'experiences.0.bullets.0.text', merge.after, 'merge');
  const apply = (patches: ProposalPatch[]) => applyProposals(base, applyProposalPatches([merge], [], patches).proposals.filter(p => p.decision !== 'rejected').map(p => ({ ...p, decision: 'accepted' })));
  expect(apply([omit]).experiences[0].bullets).toEqual([]);
  expect(apply([{ ...omit, decision: 'rejected' }]).experiences[0].bullets.map(b => b.text)).toEqual([merge.after]);
  expect(() => applyProposalPatches([merge], [], [{ ...omit, omission: { ...omit.omission!, source_bullets: omit.omission!.source_bullets.slice(0, 1) } }])).toThrow(/exactly/);
});
it('omits an addition without dropping the original bullet at its insertion position', () => {
  const add = ProposalSchema.parse({ id: 'add', type: 'bullet.add', target: { experience_index: 0, bullet_index: 0 }, after: 'New work.', citations: [] });
  const omit = makeAccomplishmentOmission(base, [add], 'experiences.0.bullets.0.text', add.after, 'add');
  const overlay = applyProposalPatches([add], [], [omit]);
  expect(applyProposals(base, overlay.proposals.map(p => ({ ...p, decision: p.decision === 'rejected' ? 'rejected' : 'accepted' }))).experiences).toEqual(base.experiences);
});
it('rejects overlapping omissions and does not confuse displayed positions with original targets', () => {
  const reorder = ProposalSchema.parse({ id: 'order', type: 'bullet.reorder', target: { experience_index: 0 }, order: [1, 0] });
  const omit = makeAccomplishmentOmission(base, [reorder], 'experiences.0.bullets.0.text', base.experiences[0].bullets[1].text, 'ordered');
  expect(omit.omission?.source_bullets[0].bullet_index).toBe(1);
  const duplicate = { ...omit, proposal_id: 'user-omission:duplicate' };
  expect(overlappingProposalIds(applyProposalPatches([reorder], [], [omit, duplicate]).proposals).size).toBe(2);
});


it('binds omission to the current job-local base correction while retaining the original operation targets', () => {
  const corrected = structuredClone(base); corrected.experiences[0].bullets[0].text = 'Migrated LinkedUp browser tests.';
  const omit = makeAccomplishmentOmission(corrected, [rewrite], 'experiences.0.bullets.0.text', rewrite.after, 'corrected');
  expect(() => validateOmissionTargets(corrected, [omit])).not.toThrow();
  expect(() => validateOmissionTargets(base, [omit])).toThrow(/targets changed/);
  const operations = applyProposalPatches([rewrite], [], [omit]).proposals;
  expect(applyProposals(corrected, operations.map(p => ({ ...p, decision: p.decision === 'rejected' ? 'rejected' : 'accepted' }))).experiences[0].bullets.map(b => b.text)).toEqual(['Kept separate work.']);
});

it('computes full diff against immutable original capture when inherited bullets have job-local corrections', () => {
  const originalSnapshot = {
    experience: [{ id: 'kong', bullets: ['Engineered accessible UI components across apps.'] }],
  };
  const baseCorrections = [
    { target: 'Engineered accessible UI components across apps.', replacement: 'Engineered accessible web forms for internal admin tools.' },
  ];
  const generatedOperations = [
    { op: 'replace', before: 'Engineered accessible web forms for internal admin tools.', after: 'Delivered WCAG 2.1 accessible form controls in React.' },
  ];

  const changes = computeArtifactChanges(originalSnapshot, baseCorrections, generatedOperations);
  expect(changes.passages[0].original_text).toBe('Engineered accessible UI components across apps.');
  expect(changes.passages[0].final_text).toBe('Delivered WCAG 2.1 accessible form controls in React.');
  expect(changes.passages[0].stages).toHaveLength(2);
  expect(changes.passages[0].stages[0].kind).toBe('job_local_correction');
  expect(changes.passages[0].stages[1].kind).toBe('tailored_proposal');
});
