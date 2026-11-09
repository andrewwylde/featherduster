import { expect, it } from 'vitest';
import { PROPOSALS_JSON_SCHEMA, ALIGNMENT_JSON_SCHEMA, normalizeGenerationProposals, originalPassagePath, proposalForPassage, synthesizeExperienceBullets } from '../src/index.js';
import { replaceSelectedPassages, restoreAccomplishmentInDraft, undoProposalInDraft, tightenResumeWording, clarificationCorrections, knownClarificationConflicts } from '../src/index.js';
import { DEFAULT_STARTER_RESUME, ProposalSchema, applyProposals, applyProposalPatches, detectProposalConflicts, validateProposal, validateProposalClaimCoverage, reusableClarifications, correctedClarificationIds, type CorpusSnapshot } from '../src/index.js';

const base = structuredClone(DEFAULT_STARTER_RESUME);
base.experiences[0].bullets = ['Built configuration APIs.', 'Built configuration UI.', 'Maintained database tooling.'].map(text => ({ text }));
const consolidation = () => ProposalSchema.parse({ id: 'merge', type: 'bullet.consolidate', target: { experience_index: 0, bullet_index: 0 },
  source_bullets: [0, 1].map(bullet_index => ({ bullet_index, before: base.experiences[0].bullets[bullet_index].text })),
  after: 'Built connector configuration across APIs and UI.', citations: ['api', 'ui'], decision: 'accepted' });
it('resolves original targets after consolidation and scopes repeated wording to its experience', () => {
  expect(originalPassagePath(base, 'experiences.0.bullets.1.text', 'Maintained database tooling.')).toBe('experiences.0.bullets.2.text');
  const duplicate = structuredClone(base); duplicate.experiences[0].bullets.push({ text: 'Maintained database tooling.' });
  expect(originalPassagePath(duplicate, 'experiences.0.bullets.1.text', 'Maintained database tooling.')).toBeUndefined();
  const one = consolidation(), two = { ...consolidation(), id: 'other', target: { ...consolidation().target, experience_index: 1 } };
  expect(proposalForPassage([one, two], 'experiences.1.bullets.0.text', one.after)?.id).toBe('other');
  expect(proposalForPassage([one, two], 'summary', one.after)).toBeUndefined();
});
it('applies and undoes consolidation atomically while preserving unrelated wording', () => {
  const merged = applyProposals(base, [consolidation()]);
  expect(merged.experiences[0].bullets.map(b => b.text)).toEqual(['Built connector configuration across APIs and UI.', 'Maintained database tooling.']);
  expect(base.experiences[0].bullets).toHaveLength(3);
  const undone = applyProposalPatches([consolidation()], [], [{ proposal_id: 'merge', decision: 'rejected' }]);
  expect(applyProposals(base, undone.proposals)).toEqual(base);
});
it('rejects overlapping rewrites and consolidations independent of operation order', () => {
  const rewrite = ProposalSchema.parse({ id: 'edit', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 1 }, after: 'Other UI.', decision: 'accepted' });
  for (const ops of [[rewrite, consolidation()], [consolidation(), rewrite]]) {
    expect(detectProposalConflicts(ops)).toHaveLength(2);
    expect(applyProposals(base, ops)).toEqual(base);
  }
});
it('uses original indices across reorder and never partially applies stale targets', () => {
  const reorder = ProposalSchema.parse({ id: 'order', type: 'bullet.reorder', target: { experience_index: 0 }, order: [2, 1, 0], decision: 'accepted' });
  expect(applyProposals(base, [reorder, consolidation()]).experiences[0].bullets.map(b => b.text)).toEqual(['Maintained database tooling.', 'Built connector configuration across APIs and UI.']);
  const stale = structuredClone(base); stale.experiences[0].bullets.reverse();
  expect(applyProposals(stale, [consolidation()])).toEqual(stale);
  const checked = validateProposal(consolidation(), { baseResume: stale, evidence: [], analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] }, alignment: { rows: [] } });
  expect(checked.checks.some(c => c.kind === 'invalid_target')).toBe(true);
});
it('keeps old proposals readable without new fields', () => {
  const old = ProposalSchema.parse({ id: 'old', type: 'bullet.rewrite', target: {}, after: 'Original shape' });
  expect(old.source_bullets).toBeUndefined(); expect(old.claim_bindings).toBeUndefined();
});
it('requires consolidation and claim bindings in the runner proposal contract and retains them on capture', () => {
  const proposal = (PROPOSALS_JSON_SCHEMA as any).properties.proposals.items;
  expect(proposal.required).toEqual(expect.arrayContaining(['source_bullets', 'claim_bindings']));
  expect((ALIGNMENT_JSON_SCHEMA as any).properties.rows.items.properties).not.toHaveProperty('source_bullets');
  expect(normalizeGenerationProposals([consolidation()])[0].source_bullets).toEqual(consolidation().source_bullets);
});

it('restores consolidated content from a finalized draft without reverting unrelated edits', () => {
  const merged = applyProposals(base, [consolidation()]);
  merged.profile.title = 'My edited title';
  merged.experiences[0].bullets[1].text = 'My unrelated database wording.';
  const undone = undoProposalInDraft(merged, base, consolidation());
  expect(undone.experiences[0].bullets.map(b => b.text)).toEqual(['Built configuration APIs.', 'Built configuration UI.', 'My unrelated database wording.']);
  expect(undone.profile.title).toBe('My edited title');
  expect(() => undoProposalInDraft(undone, base, consolidation())).toThrow(/wording changed/);
});
it('restores omitted generated additions and consolidations as one accomplishment', () => {
  const current = structuredClone(base);
  current.experiences[0].bullets = [{ text: 'My unrelated database wording.' }];
  const restored = restoreAccomplishmentInDraft(current, base, consolidation());
  expect(restored.experiences[0].bullets.map(b => b.text)).toEqual(['My unrelated database wording.', consolidation().after]);
  expect(restored.experiences[0].bullets[1].citations).toEqual(['api', 'ui']);
  expect(() => restoreAccomplishmentInDraft(restored, base, consolidation())).toThrow(/already present/);
  expect(() => restoreAccomplishmentInDraft(base, base, consolidation())).toThrow(/already present/);
  const addition = ProposalSchema.parse({ id: 'new', type: 'bullet.add', target: { experience_index: 0, bullet_index: 2 }, after: 'Added validation.', citations: ['validation'] });
  const added = restoreAccomplishmentInDraft(base, base, addition);
  expect(added.experiences[0].bullets.map(b => b.text)).toEqual(['Built configuration APIs.', 'Built configuration UI.', 'Added validation.', 'Maintained database tooling.']);
  const append = { ...addition, target: { ...addition.target, bullet_index: -1 } };
  expect(restoreAccomplishmentInDraft(base, base, append).experiences[0].bullets.at(-1)?.text).toBe(addition.after);
  expect(current.experiences[0].bullets).toEqual([{ text: 'My unrelated database wording.' }]);
  const moved = structuredClone(current); moved.experiences[0].startDate = '2030';
  expect(() => restoreAccomplishmentInDraft(moved, base, consolidation())).toThrow(/experience changed/);
  expect(() => undoProposalInDraft(moved, base, consolidation())).toThrow(/experience changed/);
});
it('selectively changes exact captured passages and tightens wording without removing distinct claims', () => {
  const edits = [{ path: 'experiences.0.bullets.0.text', before: base.experiences[0].bullets[0].text, after: 'Built configuration APIs in order to validate input.' }];
  const changed = replaceSelectedPassages(base, edits);
  expect(changed.experiences[0].bullets[1]).toEqual(base.experiences[0].bullets[1]);
  expect(() => replaceSelectedPassages(changed, edits)).toThrow(/wording changed/);
  expect(() => replaceSelectedPassages(base, [...edits, ...edits])).toThrow(/once/);
  expect(tightenResumeWording(changed).experiences[0].bullets[0].text).toBe('Built configuration APIs to validate input.');
});
it('preserves technical names, decimals, and punctuation while tightening restored content', () => {
  const draft = structuredClone(base);
  draft.summary = 'Built Node.js APIs and .NET services in order to validate input.';
  draft.experiences[0].bullets[0].text = 'Migrated to v2.1 for the purpose of compatibility. Kept p95 below 1.5 ms.';
  draft.experiences[0].bullets[1].text = 'Built API/UI setup (incl. validation), with tenant-scoped APIs.';
  const tightened = tightenResumeWording(draft);
  expect(tightened.summary).toBe('Built Node.js APIs and .NET services to validate input.');
  expect(tightened.experiences[0].bullets[0].text).toBe('Migrated to v2.1 for compatibility. Kept p95 below 1.5 ms.');
  expect(tightened.experiences[0].bullets[1]).toEqual(draft.experiences[0].bullets[1]);
  expect(draft.summary).toContain('in order to');
});
it('restores nonadjacent sources without moving intervening accomplishments', () => {
  const original = structuredClone(base);
  original.experiences[0].bullets = ['API work.', 'Unrelated tooling.', 'UI work.', 'Other work.'].map(text => ({ text }));
  const merge = ProposalSchema.parse({ ...consolidation(), source_bullets: [0, 2].map(bullet_index => ({ bullet_index, before: original.experiences[0].bullets[bullet_index].text })) });
  const current = applyProposals(original, [merge]);
  current.experiences[0].bullets[2].text = 'Edited other work.';
  expect(undoProposalInDraft(current, original, merge).experiences[0].bullets.map(b => b.text)).toEqual(['API work.', 'Unrelated tooling.', 'UI work.', 'Edited other work.']);
});

const fact = { work_id: 'project-a', predicate: 'built', qualifiers: ['configuration'] };
const answer = { schema_version: 1, id: '11111111-1111-4111-8111-111111111111', job_id: '22222222-2222-4222-8222-222222222222', input_snapshot_id: '33333333-3333-4333-8333-333333333333', revision: 1, kind: 'confirmation', fact, claim_ids: ['claim'], question: 'What did you build?', assertion: 'I built the setup UI.', actor: 'local-human', recorded_at: '2026-11-05T00:00:00.000Z', source_ids: ['ui'], confirmed: true, supersedes: null } as const;
const snapshot = { schema_version: 1, revision: 1, updates: [{ id: 'update', revision: 1, supersedes: null, change: { kind: 'clarification', value: { scope: { kind: 'project', key: fact.work_id }, clarification: answer, sources: [{ evidence_id: 'ui', evidence_fingerprint: 'version', quote: 'Setup UI' }], explanation: 'Answered' } } }] } as unknown as CorpusSnapshot;
const sources = [{ evidence_id: 'ui', evidence_fingerprint: 'version', work_id: 'ui', field: 'summary' as const, start: 0, text: 'Setup UI' }];
it('reuses only the same work, qualifiers and unchanged supporting sources', () => {
  expect(reusableClarifications(snapshot, [fact], sources)).toHaveLength(1);
  expect(reusableClarifications(snapshot, [{ ...fact, work_id: 'other' }], sources)).toEqual([]);
  expect(reusableClarifications(snapshot, [{ ...fact, qualifiers: ['entire platform'] }], sources)).toEqual([]);
  expect(reusableClarifications(snapshot, [fact], [{ ...sources[0], evidence_fingerprint: 'changed' }])).toEqual([]);
});
it('never reuses conflicting answers or withdrawn facts', () => {
  const conflict = structuredClone(snapshot);
  const next = structuredClone(conflict.updates[0]); next.id = 'new'; next.revision = 2;
  if (next.change.kind === 'clarification') next.change.value.clarification.assertion = 'I reviewed the UI only.';
  conflict.updates.push(next);
  expect(reusableClarifications(conflict, [fact], sources)).toEqual([]);
  next.supersedes = 'update';
  expect(correctedClarificationIds(conflict).has(answer.id)).toBe(true);
  expect(reusableClarifications(conflict, [fact], sources)).toHaveLength(1);
});
it('finds every affected original answer through successive corrections', () => {
  const history = structuredClone(snapshot);
  const second = structuredClone(history.updates[0]); second.id = 'second'; second.supersedes = 'update';
  const third = structuredClone(second); third.id = 'third'; third.supersedes = 'second';
  if (second.change.kind === 'clarification') second.change.value.clarification.id = 'second-answer';
  if (third.change.kind === 'clarification') third.change.value.clarification.id = 'third-answer';
  history.updates.push(second, third);
  expect(clarificationCorrections(history).map(c => [c.before.id, c.after.id])).toEqual([['second-answer', 'third-answer'], [answer.id, 'third-answer']]);
});
it('keeps a changed claim flagged when another claim in the same answer remains valid', () => {
  const history = structuredClone(snapshot);
  const original = history.updates[0];
  if (original.change.kind !== 'clarification') throw Error('Expected clarification');
  original.change.value.clarification.confirmed_claims = ['Built the UI.', 'Owned the platform.'];
  const correction = structuredClone(original); correction.id = 'correction'; correction.supersedes = original.id;
  if (correction.change.kind !== 'clarification') throw Error('Expected clarification');
  correction.change.value.clarification.confirmed_claims = ['Built the UI.', 'Contributed to the platform.'];
  history.updates.push(correction);
  const passage = { work_id: fact.work_id, text: 'Built the UI. Owned the platform.', subject: { path: 'experiences.0.bullets.0.text' } } as any;
  expect(knownClarificationConflicts(history, [passage])).toHaveLength(1);
  expect(knownClarificationConflicts(history, [{ ...passage, text: 'Built the UI. Contributed to the platform.' }])).toEqual([]);
});

it('flags exact uncovered span offsets when connective text is missing evidence binding', () => {
  const proposal = {
    text: 'Experience spans leading frontend migrations and observability pipelines.',
    claims: [
      { text: 'leading frontend migrations', source_ids: ['src-1'], span: [17, 44] as [number, number] },
      { text: 'observability pipelines', source_ids: ['src-2'], span: [49, 72] as [number, number] },
    ],
  };

  const validation = validateProposalClaimCoverage(proposal.text, proposal.claims);
  expect(validation.valid).toBe(false);
  expect(validation.gaps).toEqual([
    { span: [0, 17], text: 'Experience spans ' },
    { span: [44, 49], text: ' and ' },
    { span: [72, 73], text: '.' },
  ]);
  expect(validation.issues[0].message).toContain('Uncovered wording: "Experience spans "');
});

it('ranks frontend visualization higher for frontend role and narrows unsupported component coupling claims', () => {
  const candidate = synthesizeExperienceBullets({
    role_requirements: ['frontend observability', 'data visualization', 'test isolation'],
    experience: {
      employer: 'Parable',
      accomplishments: [
        { id: 'acc-1', topic: 'general administration', evidence_supported: true },
        { id: 'acc-2', topic: 'time spend visualization and drilldown', evidence_supported: true },
        { id: 'acc-3', topic: 'internal build scripting', evidence_supported: true },
      ],
    },
  });

  // Visualization accomplishment ranked first
  expect(candidate.bullets[0].accomplishment_id).toBe('acc-2');
  // Does not claim adoption/metrics without cited support
  expect(candidate.bullets[0].text).not.toMatch(/improved team velocity by \d+%/);
});

it('narrows unsupported pluralizations and unproven speculative metrics', () => {
  const result = synthesizeExperienceBullets({
    role_requirements: ['SDK development'],
    experience: {
      employer: 'Parable',
      accomplishments: [
        {
          id: 'acc-sdk',
          topic: 'client SDK development',
          text: 'Developed client SDKs across platforms, improved team velocity by 40%.',
          evidence_supported: true,
          evidence: [{ text: 'Built client SDK', count: 1, verified: true }],
          unsupported_qualifiers: ['SDKs', 'platforms'],
          metrics: [{ metric: 'improved team velocity by 40%', supported: false }],
        },
      ],
    },
  });

  expect(result.bullets[0].accomplishment_id).toBe('acc-sdk');
  expect(result.bullets[0].text).not.toMatch(/improved team velocity by \d+%/);
  expect(result.bullets[0].text).not.toMatch(/SDKs/);
  expect(result.bullets[0].text).toMatch(/client SDK/);
});

it('calibrates accomplishment selection for frontend-focused fullstack roles (SL-FEAT-002)', () => {
  const result = synthesizeExperienceBullets({
    role_requirements: [
      'React interfaces and frontend architecture',
      'UI-facing APIs and fullstack product lifecycle',
      'data analytics and product telemetry',
      'automated testing and production support',
    ],
    experience: {
      employer: 'Parable',
      accomplishments: [
        {
          id: 'acc-build-script',
          topic: 'internal build scripting and editor tools',
          text: 'Maintained internal build scripting and local editor dev dependencies.',
          evidence_supported: true,
          evidence: [{ text: 'build scripts', verified: true }],
        },
        {
          id: 'acc-lifecycle-api',
          topic: 'UI-facing API lifecycle and React integration',
          text: 'Engineered UI-facing APIs and React components across multiple products, owned and led production rollout.',
          evidence_supported: true,
          evidence: [{ text: 'Built product UI and API', verified: true, count: 1 }],
          unsupported_qualifiers: ['products', 'ownership'],
        },
        {
          id: 'acc-analytics',
          topic: 'analytics and product telemetry visualization',
          text: 'Built React analytics dashboard with real-time product telemetry visualization, enterprise-grade architecture.',
          evidence_supported: true,
          evidence: [{ text: 'telemetry dashboard', verified: true }],
          unsupported_qualifiers: ['enterprise'],
        },
        {
          id: 'acc-testing',
          topic: 'automated testing and test isolation',
          text: 'Implemented automated end-to-end testing in React application.',
          evidence_supported: true,
          evidence: [{ text: 'test suite', verified: true }],
        },
      ],
    },
  });

  // Top two positions belong to lifecycle/API or analytics proof
  const topTwoIds = [result.bullets[0].accomplishment_id, result.bullets[1].accomplishment_id];
  expect(topTwoIds).toContain('acc-lifecycle-api');
  expect(topTwoIds).toContain('acc-analytics');

  // Auxiliary internal build scripting is ranked lowest
  expect(result.bullets[result.bullets.length - 1].accomplishment_id).toBe('acc-build-script');

  // Scope narrowing: multiple products -> the product, owned and led -> developed, enterprise-grade -> production
  const lifecycleBullet = result.bullets.find(b => b.accomplishment_id === 'acc-lifecycle-api');
  expect(lifecycleBullet?.text).not.toMatch(/multiple products/);
  expect(lifecycleBullet?.text).toMatch(/the product/);
  expect(lifecycleBullet?.text).not.toMatch(/owned and led/);
  expect(lifecycleBullet?.text).toMatch(/developed/);

  const analyticsBullet = result.bullets.find(b => b.accomplishment_id === 'acc-analytics');
  expect(analyticsBullet?.text).not.toMatch(/enterprise-grade/);
  expect(analyticsBullet?.text).toMatch(/production/);
});
