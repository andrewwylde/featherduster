import { describe, expect, it } from 'vitest';
import { MaterialContentSchema, MaterialRevisionSchema, MaterialSaveRequestSchema, materialJsonSchema, materialStaleReasons, CLAIM_MARK, POSTING_AS_EXPERIENCE, POSTING_JOINED_TO_CLAIM, POSTING_REFERENCE_MARK, unboundMaterialWords } from '../src/jobs/materials.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ref = { id: uuid, fingerprint: 'captured' };
const binding = { workspace_id: 'fixture', job_id: uuid, posting: ref, input: ref, sources_fingerprint: 'sources', privacy_fingerprint: 'privacy', resume: null };
const paragraph = { id: 'opening', text: 'I contributed to API maintenance.', claims: [{ text: 'I contributed to API maintenance.', sources: [{ evidence_id: 'ev-001', evidence_fingerprint: 'source', quote: 'Contributed to API maintenance.' }] }] };
const letter = { kind: 'cover_letter', paragraphs: [paragraph] };
const revision = () => ({ schema_version: 1, id: uuid, ...binding, revision: 0, parent_revision_id: null, generation_id: other, content: letter, content_fingerprint: 'content', created_at: '2026-10-16T00:00:00.000Z', validation: { authority: 'server', version: 'materials-v1', content_fingerprint: 'content', input_fingerprint: 'captured', status: 'needs_review', issues: [] }, review: null });

describe('material revision contract', () => {
  it('keeps a cover letter separate from a practical interview brief and dossier', () => {
    expect(MaterialContentSchema.parse(letter).kind).toBe('cover_letter');
    expect(MaterialContentSchema.safeParse({ kind: 'interview_brief', paragraphs: [paragraph] }).success).toBe(false);
    expect(MaterialContentSchema.safeParse({ kind: 'dossier', markdown: 'Sources' }).success).toBe(false);
    expect(MaterialContentSchema.safeParse({ ...letter, ready: true }).success).toBe(false);
  });
  it('requires practical claim defense, contribution, tradeoffs, questions and honest gaps', () => {
    const brief = { kind: 'interview_brief', stories: [{ id: 'story', resume_claim: { path: 'experiences.0.bullets.0.text', text: 'Maintained APIs' }, situation: paragraph, contribution: paragraph, outcome: paragraph, tradeoffs: paragraph }], questions: [{ question: 'What did you personally change?', answer: paragraph }], gaps: [{ requirement_quote: 'Kubernetes', framing: 'I have not operated Kubernetes in production.', transferable_evidence: [] }] };
    expect(MaterialContentSchema.safeParse(brief).success).toBe(true);
    expect(MaterialContentSchema.safeParse({ ...brief, stories: [{ ...brief.stories[0], contribution: undefined }] }).success).toBe(false);
    expect(MaterialRevisionSchema.safeParse({ ...revision(), content: brief }).success).toBe(false);
    expect(MaterialRevisionSchema.safeParse({ ...revision(), content: brief, resume: ref }).success).toBe(true);
  });
  it('rejects mismatched checks and forged reviewed state', () => {
    const value = revision();
    expect(MaterialRevisionSchema.safeParse(value).success).toBe(true);
    expect(MaterialRevisionSchema.safeParse({ ...value, validation: { ...value.validation, content_fingerprint: 'old' } }).success).toBe(false);
    expect(MaterialRevisionSchema.safeParse({ ...value, validation: { ...value.validation, input_fingerprint: 'old' } }).success).toBe(false);
    const review = { reviewer_id: 'user', reviewed_at: value.created_at, revision_id: uuid, content_fingerprint: 'content', input_fingerprint: 'captured' };
    expect(MaterialRevisionSchema.safeParse({ ...value, review }).success).toBe(false);
    const checked = { ...value, validation: { ...value.validation, status: 'checked' }, review };
    expect(MaterialRevisionSchema.safeParse(checked).success).toBe(true);
    expect(MaterialRevisionSchema.safeParse({ ...checked, review: { ...review, revision_id: other } }).success).toBe(false);
    expect(MaterialRevisionSchema.safeParse({ ...checked, validation: { ...checked.validation, issues: [{ passage_id: 'opening', severity: 'block', kind: 'privacy', message: 'Private name' }] } }).success).toBe(false);
  });
  it('accepts edits with CAS but never client checks, fingerprints or review authority', () => {
    const request = { expected_revision_id: uuid, idempotency_key: 'save-once', content: letter };
    expect(MaterialSaveRequestSchema.safeParse(request).success).toBe(true);
    for (const field of ['validation', 'review', 'job_id', 'content_fingerprint', 'input_fingerprint', 'resume', 'ready']) {
      expect(MaterialSaveRequestSchema.safeParse({ ...request, [field]: 'forged' }).success).toBe(false);
    }
    expect(MaterialSaveRequestSchema.safeParse({ content: letter }).success).toBe(false);
  });
  it('requires immutable lineage for subsequent revisions', () => {
    expect(MaterialRevisionSchema.safeParse({ ...revision(), revision: 1 }).success).toBe(false);
    expect(MaterialRevisionSchema.safeParse({ ...revision(), revision: 1, parent_revision_id: uuid }).success).toBe(false);
    expect(MaterialRevisionSchema.safeParse({ ...revision(), revision: 1, parent_revision_id: other }).success).toBe(true);
  });
  it('rejects duplicate passage identities and empty source quotes', () => {
    expect(MaterialContentSchema.safeParse({ ...letter, paragraphs: [paragraph, paragraph] }).success).toBe(false);
    expect(MaterialContentSchema.safeParse({ ...letter, paragraphs: [{ ...paragraph, claims: [{ ...paragraph.claims[0], sources: [{ ...paragraph.claims[0].sources[0], quote: ' ' }] }] }] }).success).toBe(false);
  });
  it('reports every changed dependency without changing captured content', () => {
    const material = MaterialRevisionSchema.parse(revision());
    const before = JSON.stringify(material);
    expect(materialStaleReasons(material, binding)).toEqual([]);
    expect(materialStaleReasons(material, { ...binding, posting: { ...ref, fingerprint: 'new' }, input: { ...ref, id: other }, sources_fingerprint: 'new', privacy_fingerprint: 'new', resume: ref })).toEqual(['posting', 'input', 'sources', 'privacy', 'resume']);
    expect(JSON.stringify(material)).toBe(before);
    expect(() => materialStaleReasons(material, { ...binding, job_id: other })).toThrow(/different job/);
    expect(() => materialStaleReasons(material, { ...binding, workspace_id: 'other' })).toThrow(/different job/);
  });
});

describe('letter structure and connective prose', () => {
  it('keeps saved letters byte-identical and accepts posting references and gap notes', () => {
    expect(JSON.stringify(MaterialContentSchema.parse(letter))).toBe(JSON.stringify(letter));
    const structured = { kind: 'cover_letter', paragraphs: [{ ...paragraph, references: [{ text: 'Platform Engineer' }] }], gap_notes: [{ requirement_quote: 'Kubernetes production operations', transferable_evidence: [] }] };
    expect(MaterialContentSchema.safeParse(structured).success).toBe(true);
    // Gap notes carry no free text, so neither ability nor inability can be asserted.
    expect(MaterialContentSchema.safeParse({ ...structured, gap_notes: [{ requirement_quote: 'Kubernetes', framing: 'I lack Kubernetes.', transferable_evidence: [] }] }).success).toBe(false);
  });
  it('allows only connective words between bound claims and posting references', () => {
    const P = POSTING_REFERENCE_MARK, C = CLAIM_MARK;
    expect(unboundMaterialWords(`Dear hiring team, I would like to apply for the ${P} role at ${P}.`)).toEqual([]);
    expect(unboundMaterialWords(`Your posting asks for ${P}. I ${C}.`)).toEqual([]);
    expect(unboundMaterialWords(`Your posting asks for ${P}. ${C}.`)).toEqual([]);
    expect(unboundMaterialWords(`${C}. "Your posting asks for ${P}."`)).toEqual([]);
    expect(unboundMaterialWords(`${C}. (Your posting asks for ${P}.)`)).toEqual([]);
    expect(unboundMaterialWords(`Your posting asks for ${P}. " ${C}."`)).toEqual([]);
    expect(unboundMaterialWords(`Dear ${P} hiring team,`)).toEqual([]);
    expect(unboundMaterialWords('Thank you for considering my application. Sincerely,')).toEqual([]);
    expect(unboundMaterialWords('')).toEqual([]);
    expect(unboundMaterialWords('I led a team of 12.')).toEqual(['led', '12']);
    expect(unboundMaterialWords('I am an expert.')).toEqual(['am', 'expert']);
    expect(unboundMaterialWords('I’m applying.')).toEqual(["i'm"]);
    expect(unboundMaterialWords('The supplied sources do not establish this.')).toEqual(['supplied', 'sources', 'do', 'not', 'establish']);
  });
  it('fails closed on any script and on full-width or compatibility forms', () => {
    expect(unboundMaterialWords('我领导了一个团队')).not.toEqual([]);
    expect(unboundMaterialWords('Я руководил командой из 12 человек.')).toEqual(expect.arrayContaining(['руководил', '12']));
    expect(unboundMaterialWords('ｌｅｄ ａ ｔｅａｍ of １２')).toEqual(['led', '12']);
  });
  it('only lets posting wording describe the job, never the candidate or a claim', () => {
    const P = POSTING_REFERENCE_MARK, C = CLAIM_MARK;
    for (const text of [`My ${P}.`, `I also ${P}.`, `As a ${P}, I would like to apply.`, `I apply with ${P}.`, `I, ${P}, would like to apply.`, `As the ${P}, I would like to apply.`, `With the ${P}, I would like to apply.`, `As your ${P}, I would like to apply.`, `With your ${P}, I would like to apply.`, `${P}.`, `I would like to apply for the role. ${P}.`, `${C} for Example Inc. At ${P}.`, `At ${P}.`]) {
      expect(unboundMaterialWords(text)).toContain(POSTING_AS_EXPERIENCE);
    }
    expect(unboundMaterialWords(`My role at ${P}.`)).toContain('my');
    expect(unboundMaterialWords(`${C} the ${P}.`)).toContain(POSTING_JOINED_TO_CLAIM);
    expect(unboundMaterialWords(`${P} I ${C}.`)).toContain(POSTING_JOINED_TO_CLAIM);
    for (const text of [`${C}, at ${P}.`, `${C}: the ${P}.`, `${C} (the ${P}).`, `${C} — for the ${P}.`, `${C} "the ${P}"`, `Your posting asks for ${P}, and I ${C}.`, `${C} in the U.S. at ${P}.`, `${C} for Example Inc. at ${P}.`]) {
      expect(unboundMaterialWords(text)).toContain(POSTING_JOINED_TO_CLAIM);
    }
    expect(unboundMaterialWords('me\u200ban')).toEqual(['mean']);
  });
  it('requires posting references and gap notes in structured output', () => {
    const schema = materialJsonSchema('cover_letter') as { required: string[]; properties: { paragraphs: { items: { required: string[] } }; gap_notes: { items: { required: string[] } } } };
    expect(schema.required).toEqual(['kind', 'paragraphs', 'gap_notes']);
    expect(schema.properties.paragraphs.items.required).toEqual(['id', 'text', 'claims', 'references']);
    expect(schema.properties.gap_notes.items.required).toEqual(['requirement_quote', 'transferable_evidence']);
  });
});

describe('unboundMaterialWords symbols', () => {
  it('reports symbols and emoji instead of dropping them as separators', () => {
    expect(unboundMaterialWords('I would like to apply + $ 🚀.')).toEqual(['+', '$', '🚀']);
  });
});
