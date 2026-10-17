import { z } from 'zod';
import { ImmutableReferenceSchema } from './schemas.js';
import { ValidationIssueSchema } from '../tailoring/schemas.js';

const text = z.string().trim().min(1).max(100000);
const uuid = z.string().uuid();

/** Source quotes are evidence to inspect, never authority to waive factual checks. */
export const MaterialSourceSchema = z.object({
  evidence_id: text, evidence_fingerprint: text, quote: text,
}).strict();
/** Exact posting wording (company, role, a requirement). It describes the job,
 * never the candidate's experience. */
export const MaterialPostingReferenceSchema = z.object({ text }).strict();
export const MaterialPassageSchema = z.object({
  id: text,
  text,
  claims: z.array(z.object({ text, sources: z.array(MaterialSourceSchema).min(1) }).strict()),
  // Optional so revisions saved before references existed parse to the same
  // JSON; their content fingerprints cover the original shape.
  references: z.array(MaterialPostingReferenceSchema).max(20).optional(),
}).strict();

/** A posting requirement the selected evidence does not establish. It has no
 * free text, so it can state neither ability nor inability. It is review
 * context for the user and is never exported as letter prose. */
export const LetterGapNoteSchema = z.object({
  requirement_quote: text,
  transferable_evidence: z.array(MaterialSourceSchema).max(10),
}).strict();

/** Words allowed between bound claims and posting references. There is no
 * copula, possession verb, number or skill word, so connectives alone cannot
 * assert an employer, credential, metric, outcome or ability. */
const CONNECTIVES = new Set([
  'a', 'an', 'and', 'as', 'at', 'also', 'for', 'from', 'i', 'in', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'the', 'their', 'this', 'that', 'these', 'to', 'which', 'with', 'you', 'your',
  'dear', 'hiring', 'team', 'role', 'position', 'posting', 'opportunity', 'apply', 'applying', 'application',
  'asks', 'seeks', 'describes', 'mentions', 'lists', 'requires',
  'thank', 'considering', 'consideration', 'would', 'like', 'welcome', 'discuss', 'look', 'forward', 'hearing', 'sincerely', 'regards',
]);
/** A sentence quoting the posting must say so; otherwise it is a fragment like "At <posting>." */
const ATTRIBUTION_WORDS = new Set(['dear', 'asks', 'seeks', 'describes', 'mentions', 'lists', 'requires', 'apply', 'applying', 'would', 'welcome', 'discuss', 'thank', 'considering']);
/** The only words that may directly precede posting wording; each attributes it to the job. */
const REFERENCE_INTRODUCERS = new Set(['dear', 'the', 'at', 'for', 'your', 'requires', 'seeks', 'asks', 'describes', 'mentions', 'lists']);
/** Words that turn "the <posting wording>" into a claim about the candidate ("as the …", "with the …"). */
const SELF_BEFORE_THE = new Set(['as', 'with', 'i', 'me', 'my', 'also']);
/** Marks where the validator removed a verified posting reference or a bound claim. */
export const POSTING_REFERENCE_MARK = '\u0000posting\u0000';
export const CLAIM_MARK = '\u0000claim\u0000';
export const POSTING_AS_EXPERIENCE = 'posting wording presented as your experience';
export const POSTING_JOINED_TO_CLAIM = 'posting wording joined to an evidence claim';

/** Problems left in passage text after the caller replaced bound claims with
 * CLAIM_MARK and verified posting references with POSTING_REFERENCE_MARK:
 * unbound words plus the two rule messages above. Empty means the remainder
 * is purely connective. Any letter or digit in any script that is not a
 * connective is reported, so unexpected input fails closed. Posting wording
 * must directly follow, in the same sentence, a word attributing it to the job, and never shares a sentence with a claim, so it cannot complete or stand in for experience. Sentences end only at a terminator followed by a capitalized word, so abbreviations such as "U.S." or "Inc." cannot detach posting wording from a claim. A sentence quoting the posting must contain a word attributing it to the job (asks, requires, apply…); a semicolon followed by a lowercase word does not end a sentence. Callers must reject raw control characters first; the internal sentinels are stripped from input defensively. */
export function unboundMaterialWords(residue: string): string[] {
  const text = residue.replace(/[\u0001\u0002]/g, ' ')
    .replaceAll(POSTING_REFERENCE_MARK, ' \u0001 ').replaceAll(CLAIM_MARK, ' \u0002 ')
    .normalize('NFKC').replace(/\p{Cf}/gu, '');
  const issues: string[] = [];
  // Symbols and emoji are not connective; report each distinct one first.
  for (const symbol of new Set(text.match(/\p{S}/gu) ?? [])) issues.push(symbol);
  const tokens: { word: string; sentence: number }[] = [];
  // Split before lowercasing: a sentence ends only at a terminator followed by a capital.
  text.split(/[.!?;]+(?=\s+["'“‘(\[]*\s*[\p{Lu}\u0001\u0002])|[.!?;]+\s*$|\n/u).forEach((raw, index) => {
    const sentence = raw.toLowerCase().replace(/[’‘]/g, "'");
    for (const match of sentence.match(/[\p{L}\p{N}']+|[\u0001\u0002]/gu) ?? []) {
      const word = match.replace(/^'+|'+$/g, '');
      if (word) tokens.push({ word, sentence: index });
    }
  });
  const before = (i: number, sentence: number) => (tokens[i]?.sentence === sentence ? tokens[i].word : undefined);
  tokens.forEach(({ word, sentence }, i) => {
    if (word === '\u0002') return;
    if (word === '\u0001') {
      const previous = before(i - 1, sentence);
      if (previous === undefined || !REFERENCE_INTRODUCERS.has(previous) || ((previous === 'the' || previous === 'your') && SELF_BEFORE_THE.has(before(i - 2, sentence) ?? '')) || !tokens.some(t => t.sentence === sentence && ATTRIBUTION_WORDS.has(t.word))) issues.push(POSTING_AS_EXPERIENCE);
      if (tokens.some(t => t.sentence === sentence && t.word === '\u0002')) issues.push(POSTING_JOINED_TO_CLAIM);
      return;
    }
    // "my" is only connective in "my application"; "my role at …" would claim a job.
    if (word === 'my' && tokens[i + 1]?.word !== 'application') issues.push('my');
    else if (!CONNECTIVES.has(word)) issues.push(word);
  });
  return issues;
}

/** Public letter prose and private interview preparation are separate documents.
 * Neither is the deterministic evidence dossier. Claims and source quotes are
 * metadata, not text to append to application-facing exports.
 */
export const MaterialContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cover_letter'),
    paragraphs: z.array(MaterialPassageSchema).min(1).max(30),
    gap_notes: z.array(LetterGapNoteSchema).max(10).optional(),
  }).strict(),
  z.object({
    kind: z.literal('interview_brief'),
    stories: z.array(z.object({
      id: text,
      resume_claim: z.object({ path: text, text }).strict(),
      situation: MaterialPassageSchema,
      contribution: MaterialPassageSchema,
      outcome: MaterialPassageSchema,
      tradeoffs: MaterialPassageSchema,
    }).strict()).min(1).max(30),
    questions: z.array(z.object({ question: text, answer: MaterialPassageSchema }).strict()).min(1).max(50),
    gaps: z.array(z.object({
      requirement_quote: text, framing: text,
      transferable_evidence: z.array(MaterialSourceSchema),
    }).strict()).max(50),
  }).strict(),
]).superRefine((content, ctx) => {
  // Interview sections may reuse the same passage as supporting context. Letter
  // paragraph IDs must uniquely identify the editable passage.
  if (content.kind === 'cover_letter' && new Set(content.paragraphs.map(p => p.id)).size !== content.paragraphs.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate letter passage identity' });
  }
  if (content.kind === 'interview_brief' && new Set(content.stories.map(s => s.id)).size !== content.stories.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate interview story identity' });
  }
});
export type MaterialContent = z.infer<typeof MaterialContentSchema>;

/** Untrusted edit payload: ownership, hashes, checks and review are server-owned. */
export const MaterialSaveRequestSchema = z.object({
  expected_revision_id: uuid,
  idempotency_key: z.string().trim().min(1).max(200),
  content: MaterialContentSchema,
}).strict();
export type MaterialSaveRequest = z.infer<typeof MaterialSaveRequestSchema>;

export const MaterialBindingSchema = z.object({
  workspace_id: text, job_id: uuid,
  posting: ImmutableReferenceSchema,
  input: ImmutableReferenceSchema,
  sources_fingerprint: text,
  privacy_fingerprint: text,
  // Null explicitly records generation without a resume, so adding a resume
  // also invalidates that dependency. Interview claim defense requires a resume.
  resume: ImmutableReferenceSchema.nullable(),
}).strict();
export type MaterialBinding = z.infer<typeof MaterialBindingSchema>;

/** Only the service may create validation/review metadata. Never use this schema
 * as a client save payload: clients submit content and expected revision only.
 * Parsing verifies consistency, not the truth of claims or the supplied hashes.
 */
export const MaterialRevisionSchema = MaterialBindingSchema.extend({
  schema_version: z.literal(1), id: uuid,
  revision: z.number().int().nonnegative(), parent_revision_id: uuid.nullable(),
  generation_id: uuid,
  content: MaterialContentSchema, content_fingerprint: text,
  created_at: z.string().datetime(),
  validation: z.object({
    authority: z.literal('server'), version: text,
    content_fingerprint: text, input_fingerprint: text,
    status: z.enum(['blocked', 'needs_review', 'checked']),
    issues: z.array(ValidationIssueSchema.extend({ passage_id: text }).strict()),
  }).strict(),
  review: z.object({
    reviewer_id: text, reviewed_at: z.string().datetime(), revision_id: uuid,
    content_fingerprint: text, input_fingerprint: text,
  }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if ((value.revision === 0) !== (value.parent_revision_id === null) || value.parent_revision_id === value.id) invalid('Material revision lineage mismatch');
  if (value.content.kind === 'interview_brief' && !value.resume) invalid('A current resume is required for interview claim defense');
  const checks = value.validation;
  if (checks.content_fingerprint !== value.content_fingerprint || checks.input_fingerprint !== value.input.fingerprint) invalid('Material validation binding mismatch');
  const blocked = checks.issues.some(issue => issue.severity === 'block');
  if (blocked !== (checks.status === 'blocked')) invalid('Material blocking checks and status disagree');
  if (value.review && (checks.status !== 'checked' || value.review.revision_id !== value.id || value.review.content_fingerprint !== value.content_fingerprint || value.review.input_fingerprint !== value.input.fingerprint)) invalid('Material review binding mismatch');
});
export type MaterialRevision = z.infer<typeof MaterialRevisionSchema>;

/** Pure freshness comparison; never discards historical content or invokes work.
 * Callers must resolve current fingerprints from authoritative persisted inputs,
 * including pending current resume edits, rather than trusting client values.
 */
export function materialStaleReasons(material: MaterialBinding, current: MaterialBinding): string[] {
  const captured = MaterialBindingSchema.strip().parse(material);
  const latest = MaterialBindingSchema.parse(current);
  if (captured.job_id !== latest.job_id || captured.workspace_id !== latest.workspace_id) throw new Error('Material belongs to a different job or workspace');
  const same = (a: MaterialBinding['resume'], b: MaterialBinding['resume']) => a === null || b === null ? a === b : a.id === b.id && a.fingerprint === b.fingerprint;
  return [
    ...(!same(captured.posting, latest.posting) ? ['posting'] : []),
    ...(!same(captured.input, latest.input) ? ['input'] : []),
    ...(captured.sources_fingerprint !== latest.sources_fingerprint ? ['sources'] : []),
    ...(captured.privacy_fingerprint !== latest.privacy_fingerprint ? ['privacy'] : []),
    ...(!same(captured.resume, latest.resume) ? ['resume'] : []),
  ];
}

/** Strict structured-output shapes for permitted runners; Zod remains authority. */
export function materialJsonSchema(kind: MaterialContent['kind']): Record<string, unknown> {
  const string = { type: 'string' };
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const array = (items: unknown) => ({ type: 'array', items });
  const source = object({ evidence_id: string, evidence_fingerprint: string, quote: string });
  const passage = object({ id: string, text: string, claims: array(object({ text: string, sources: array(source) })), references: array(object({ text: string })) });
  return kind === 'cover_letter'
    ? object({ kind: { type: 'string', enum: [kind] }, paragraphs: array(passage), gap_notes: array(object({ requirement_quote: string, transferable_evidence: array(source) })) })
    : object({ kind: { type: 'string', enum: [kind] }, stories: array(object({ id: string, resume_claim: object({ path: string, text: string }), situation: passage, contribution: passage, outcome: passage, tradeoffs: passage })), questions: array(object({ question: string, answer: passage })), gaps: array(object({ requirement_quote: string, framing: string, transferable_evidence: array(source) })) });
}
