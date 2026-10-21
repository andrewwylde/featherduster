import { expect, it } from 'vitest';
import { ProposalSchema, ResumeSpecSchema, applyProposals } from '@featherduster/core';
import { repairAutomaticStructure, supportedNarrowerWording, isTransientPreparationFailure } from '../src/jobs/automatic-repair.js';
it('narrows unsupported leadership only to an exact captured supported sentence', () => {
  expect(supportedNarrowerWording('Led implementation of caching.', ['Implemented caching.'])).toBe('Implemented caching.');
  expect(supportedNarrowerWording('Led implementation of caching.', ['Worked on another project.'])).toBeNull();
  expect(supportedNarrowerWording('Built caching and saved money.', ['Built caching.'])).toBeNull();
  expect(isTransientPreparationFailure('missing citation')).toBe(false);
  expect(isTransientPreparationFailure('temporarily offline')).toBe(true);
});
it('reorders original bullets, repairs the intended target, and deduplicates only existing skills', () => {
  const base = ResumeSpecSchema.parse({ profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Original caching' }, { text: 'Original queues' }] }], education: [], skills: [{ category: 'Tools', skills: ['TypeScript', 'SQL'] }] });
  const proposals = [
    ProposalSchema.parse({ id: 'order', type: 'bullet.reorder', target: { experience_index: 0 }, order: [1, 0] }),
    ProposalSchema.parse({ id: 'repair', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0 }, before: 'Original caching', after: 'Implemented caching' }),
    ProposalSchema.parse({ id: 'skills', type: 'skills.reorder', target: { skill_group_index: 0 }, skills: ['SQL', 'SQL', 'Imaginary skill'] }),
  ];
  const fixed = repairAutomaticStructure(base, proposals);
  const candidate = applyProposals(base, fixed.proposals.map(p => ({ ...p, decision: 'accepted' })));
  expect(candidate.experiences[0].bullets.map(b => b.text)).toEqual(['Original queues', 'Implemented caching']);
  expect(candidate.skills[0].skills).toEqual(['SQL', 'TypeScript']);
  expect(fixed.changes).toHaveLength(1);
});

it('removes a supported narrower qualifier from the captured base before asking, without rewriting shared inputs', async () => {
  const { automaticPreparationFixture, installAutomaticContent } = await import('./fixtures/automatic-preparation-fixture.js');
  let cleanup!: () => Promise<void>;
  const f = automaticPreparationFixture(fn => { cleanup = fn; }); installAutomaticContent(f, 'base-qualifier');
  try {
    const job = await f.add(), r = f.runtime(), batch = r.prepareBatch({ members: [{ job_id: job.id, expected_revision: job.revision }], idempotency_key: 'base-qualifier' }).result;
    const { vi } = await import('vitest');
    await vi.waitFor(() => expect(r.readBatch(batch.id).counts.ready).toBe(1), { timeout: 10000 });
    expect(r.questions.read(batch.id)).toEqual([]);
    const view = r.artifacts.review(job.id, r.readBatch(batch.id).queue[0].artifact_id);
    expect(view.draft.candidate.experiences[0].bullets[0].text).toBe('Implemented caching.');
    expect(r.artifacts.capturedContext(view.artifact.input_snapshot_id).base_resume.experiences[0].bullets[0].text).toBe('Led implementation of caching.');
    expect(r.readBatch(batch.id).repairs[0]).toMatchObject({ provenance: 'worker', before: 'Led implementation of caching.', after: 'Implemented caching.' });
    expect(r.corpus.repository.snapshot().revision).toBe(0);
  } finally { await cleanup(); }
}, 15000);
it('removes internal citation labels without removing their source bindings', () => {
  const base = ResumeSpecSchema.parse({ profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [], education: [], skills: [] });
  const proposal = ProposalSchema.parse({ id: 'summary', type: 'summary.rewrite', target: {}, after: 'Implemented caching. [ev-001]', citations: ['ev-001'] });
  const result = repairAutomaticStructure(base, [proposal]);
  expect(result.proposals[0].edited_after).toBe('Implemented caching.');
  expect(result.proposals[0].citations).toEqual(['ev-001']);
  expect(proposal.after).toBe('Implemented caching. [ev-001]');
});
