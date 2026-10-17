import { z } from 'zod';
import { ImmutableReferenceSchema } from './schemas.js';
import { ValidationIssueSchema } from '../tailoring/schemas.js';

const text = z.string().trim().min(1).max(100000);
const uuid = z.string().uuid();

/** Source quotes are evidence to inspect, never authority to waive factual checks. */
export const MaterialSourceSchema = z.object({
  evidence_id: text, evidence_fingerprint: text, quote: text,
}).strict();
export const MaterialPassageSchema = z.object({
  id: text,
  text,
  claims: z.array(z.object({ text, sources: z.array(MaterialSourceSchema).min(1) }).strict()),
}).strict();

/** Public letter prose and private interview preparation are separate documents.
 * Neither is the deterministic evidence dossier. Claims and source quotes are
 * metadata, not text to append to application-facing exports.
 */
export const MaterialContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cover_letter'), paragraphs: z.array(MaterialPassageSchema).min(1).max(30) }).strict(),
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
  const passage = object({ id: string, text: string, claims: array(object({ text: string, sources: array(source) })) });
  return kind === 'cover_letter'
    ? object({ kind: { type: 'string', enum: [kind] }, paragraphs: array(passage) })
    : object({ kind: { type: 'string', enum: [kind] }, stories: array(object({ id: string, resume_claim: object({ path: string, text: string }), situation: passage, contribution: passage, outcome: passage, tradeoffs: passage })), questions: array(object({ question: string, answer: passage })), gaps: array(object({ requirement_quote: string, framing: string, transferable_evidence: array(source) })) });
}
