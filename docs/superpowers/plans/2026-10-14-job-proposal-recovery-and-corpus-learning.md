# Job Proposal Recovery and Corpus Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user recover, correct, and resume blocked job proposals, and remember confirmed evidence/skill corrections so applicable subsequent jobs avoid the same grounding failure.

**Architecture:** Persist model generations separately from append-only proposal review revisions and server-derived validation results. Store feedback and corpus knowledge in companion tables in the existing workspace SQLite database so Save and remember can atomically save a correction and its reusable knowledge without rewriting consolidated ledgers. Capture corpus knowledge in immutable job snapshots and use the same supported relationships in retrieval, prompts, and deterministic validation.

**Tech Stack:** TypeScript, Zod, better-sqlite3, Hono, React, Vitest, React Testing Library, existing immutable job bundles and SSE transport.

---

## Approved scope and execution constraints

Source: `docs/superpowers/specs/2026-10-14-job-proposal-recovery-brainstorm.md`, approved on 2026-10-14 after addition of reusable corpus learning.

Deliver the following as one usable feature, with separately testable increments:

1. Durable proposal generation and recoverable review.
2. Wording edits, citation selection, rejection, grounding decisions, local recheck, and explicit continuation.
3. Reusable feedback, factual amendments, skill/evidence relationships, withdrawal, and use in subsequent jobs.

Bounded AI repair suggestions, automatic style-preference inference, one-job runs that override Stop, and stage-specific dependency caching are outside this delivery. Retain explicit job/role relevance feedback without inferring global facts from it.

Work in the existing workspace unless isolation is required. The tree already contains uncommitted runner-default fixes, worker/state-machine fixes, and job UI changes. Read the current versions before editing; preserve those changes. Do not stage `.taskmaster`, `adws`, sessions, unrelated UI changes, or the private career corpus. Do not run generation or modify actual career evidence in automated tests.

Use TDD for each behavior below: add the listed failing test, run it and inspect the expected failure, implement that behavior, then rerun the focused test. Commit completed, verified units with explicit file lists and verify HEAD advanced. The final acceptance task is required before treating the feature as shipped.

## File and responsibility map

| File | Responsibility |
| --- | --- |
| Create `packages/core/src/corpus/schemas.ts` | Feedback, source bindings, skill relationships, evidence amendments, scope, and immutable corpus snapshot schemas. |
| Create `packages/core/src/corpus/knowledge.ts` | Pure source-binding checks, effective evidence assembly, relationship applicability, and corpus search enrichment. |
| Create `packages/core/src/jobs/proposal-review.ts` | Review schemas, patch application, issue normalization, target-conflict checks, and validation bindings. |
| Modify `packages/core/src/tailoring/validators.ts` | Optional explicit evidence-bound term-grounding input; preserve current manual semantics. |
| Modify `packages/core/src/jobs/preparation.ts` | Consume approved grounding without trusting model alignment; retain independent hard checks. |
| Modify `packages/core/src/tailoring/context.ts` | Render applicable learned support as redacted source data in alignment/proposal prompts. |
| Modify `packages/core/src/jobs/schemas.ts` | Backward-compatible snapshot, blocker, review, and attempt-selection bindings. |
| Modify `packages/core/src/index.ts` | Export the new public domain contracts. |
| Modify `packages/cli/src/jobs/database.ts` | Add ordered, transactional migrations for corpus and review companion tables. |
| Create `packages/cli/src/corpus/repository.ts` | Corpus revisions, feedback receipts, updates, withdrawal, and conflict detection using a supplied JobsDatabase connection. |
| Create `packages/cli/src/corpus/service.ts` | Validate proposed learning against actual sources and assemble the effective corpus. |
| Create `packages/cli/src/corpus/routes.ts` | Read, remember, and withdraw corpus knowledge through strict localhost routes. |
| Create `packages/cli/src/corpus/load.ts` | Read-only effective corpus loading for callers that do not own a jobs runtime. |
| Create `packages/cli/src/jobs/proposal-repository.ts` | Immutable generations, append-only review revisions, active-review pointers, attempt bindings, and idempotent saves. |
| Create `packages/cli/src/jobs/proposal-service.ts` | Review read/save/recheck, grounded learning, continuation admission, and historical recovery. |
| Modify `packages/cli/src/jobs/preparation.ts` | Persist generations before semantic failure and consume a frozen validated review on resume. |
| Modify `packages/cli/src/jobs/artifacts.ts` | Capture/verify corpus snapshots and expose verified preparation context. |
| Modify `packages/cli/src/jobs/runtime.ts` | Construct services, atomically capture effective inputs, and expose review details. |
| Modify `packages/cli/src/jobs/repository.ts` | Reuse the existing receipt and revision machinery through narrow public helpers. |
| Modify `packages/cli/src/jobs/service.ts` | Admit a review-bound continuation without losing worker/Stop fencing. |
| Modify `packages/cli/src/jobs/worker.ts` | Persist typed blockers and retain saved output on cancellation/failure. |
| Modify `packages/cli/src/jobs/routes.ts` | Strict review/recovery/continue routes with exact input and revision binding. |
| Modify `packages/cli/src/server.ts` | Merge effective corpus reads, mount corpus routes, preserve raw-source loading. |
| Modify `packages/cli/src/tailoring/orchestrator.ts` | Pass the effective corpus's verified support into manual prompt/recheck paths without changing approval semantics. |
| Modify `packages/ui/src/api/client.ts` | Typed corpus and proposal-review requests/responses. |
| Create `packages/ui/src/views/jobs/JobProposalReview.tsx` | Review workspace and explicit save/recheck/continue actions. |
| Create `packages/ui/src/views/jobs/JobProposalEditor.tsx` | Per-proposal editor, diff, citations, grounding, and memory preview. |
| Create `packages/ui/src/views/jobs/JobEvidenceChooser.tsx` | Search captured evidence and show exact passages/confidence. |
| Create `packages/ui/src/components/CorpusKnowledgePanel.tsx` | Inspect source support, amendments, provenance, conflicts, and withdrawal. |
| Modify `packages/ui/src/views/jobs/JobDetail.tsx` | Contextual Resolve proposals or Recover proposal review action. |
| Modify `packages/ui/src/views/jobs/JobResumeReview.tsx` | Show proposal review before artifacts exist and retain existing PDF review. |
| Modify `packages/ui/src/views/jobs/JobAnswers.tsx` | Route typed non-fact blockers to their actual resolver. |
| Modify `packages/ui/src/views/jobs/WorkerControls.tsx` | Explain idle review counts and prevented starts. |
| Modify `packages/ui/src/components/EvidenceDetailModal.tsx` | Show effective/source differences and remembered knowledge for an entry. |
| Modify `packages/ui/src/views/RubricGapMatrix.tsx` | Expose remembered skill relationships without counting them as new accomplishments. |
| Modify `packages/ui/src/views/desk/EvidenceStrengthener.tsx` | Save a reviewed companion amendment for consolidated-ledger entries. |

## Task 1: Define feedback and supported-skill contracts

**Files:** Create `packages/core/src/corpus/schemas.ts`; modify `packages/core/src/index.ts`; create `packages/core/tests/corpus-knowledge.test.ts`.

- [ ] **Step 1: Add the schema contract and its failing tests.** Use the following complete building blocks; validate records strictly and keep user-origin provenance server-owned.

```ts
import { z } from 'zod';
import { EvidenceEntrySchema } from '../schemas/evidence.js';

const id = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().trim().min(1);
export const CorpusScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }).strict(),
  z.object({ kind: z.enum(['employer', 'project', 'role', 'job']), key: text }).strict(),
]);
export const SourceSupportSchema = z.object({
  evidence_id: text, evidence_fingerprint: hash, quote: text,
}).strict();
export const SkillSupportSchema = z.object({
  skill: text, facet: text, permitted_terms: z.array(text).min(1),
  support: z.enum(['direct', 'transferable', 'unsupported']),
  scope: CorpusScopeSchema, sources: z.array(SourceSupportSchema).min(1),
  explanation: text,
}).strict();
export const EvidenceAmendmentSchema = z.object({
  evidence_id: text, base_fingerprint: hash,
  entry: EvidenceEntrySchema, narrative: z.string(),
  confirmation_basis: z.literal('user_confirmed'), explanation: text,
}).strict().refine(a => a.entry.id === a.evidence_id, 'Evidence identity cannot change');
export const CorpusChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill_support'), value: SkillSupportSchema }).strict(),
  z.object({ kind: z.literal('evidence_amendment'), value: EvidenceAmendmentSchema }).strict(),
  z.object({ kind: z.literal('withdrawal'), update_id: id, reason: text }).strict(),
]);
export const FeedbackEventSchema = z.object({
  schema_version: z.literal(1), id, workspace_id: text,
  job_id: id.nullable(), proposal_id: text.nullable(), review_revision: z.number().int().nonnegative().nullable(),
  kind: z.enum(['wording', 'citation', 'grounding', 'fact', 'unsupported', 'relevance', 'rejection']),
  before: z.string(), after: z.string(), explanation: z.string(),
  scope: CorpusScopeSchema, recorded_by: text, recorded_at: z.string().datetime(),
}).strict();
export type CorpusScope = z.infer<typeof CorpusScopeSchema>;
export type SourceSupport = z.infer<typeof SourceSupportSchema>;
export type SkillSupport = z.infer<typeof SkillSupportSchema>;
export type EvidenceAmendment = z.infer<typeof EvidenceAmendmentSchema>;
export type CorpusChange = z.infer<typeof CorpusChangeSchema>;
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;
```

Tests must parse a source-backed backend relationship; reject an empty quote, missing source, forged provenance in the strict change payload, and an amendment that changes the evidence ID. A rejected proposal without a reason creates feedback only, never an inferred skill update.

- [ ] **Step 2: Run the failing tests.** `npm test -- packages/core/tests/corpus-knowledge.test.ts`. Expected: missing exports before the schema is implemented; then assertion failures for missing validation, not unrelated fixture failures.
- [ ] **Step 3: Add public immutable update/snapshot contracts.** Define `CorpusUpdate` as `{schema_version:1,id,workspace_id,revision,feedback_id,supersedes:string|null,change:CorpusChange,recorded_at}`. Define `CorpusSnapshot` as `{schema_version:1,revision:number,updates:CorpusUpdate[]}`. Add Zod schemas with UUIDs, finite nonnegative integer revisions, strict objects, and date-time validation; export them and the building blocks from core.
- [ ] **Step 4: Run the focused tests and core build.** `npm test -- packages/core/tests/corpus-knowledge.test.ts`; `npm run build:core`. Expected: all contract tests pass and TypeScript exits 0.
- [ ] **Step 5: Commit only these contract files.** Message: `feat(corpus): define feedback and evidence support contracts`.

## Task 2: Resolve effective evidence and source-bound knowledge

**Files:** Create `packages/core/src/corpus/knowledge.ts`; modify `packages/core/src/index.ts`; extend `packages/core/tests/corpus-knowledge.test.ts`.

- [ ] **Step 1: Add failing source-binding tests.** Construct a `verified` evidence entry whose narrative says `Built APIs and fixed BFF authentication.` and a confirmed relationship permitting only `backend` and `backend development`. Assert it applies only when the cited ID, source version, quote, direct-support level, and scope match. Assert it does not ground Kafka, a new metric, or a transferable relationship.

The pure function contracts are:

```ts
export interface CorpusContext {
  job_id?: string;
  employer?: string;
  project?: string;
  role?: string;
}
export interface EffectiveCorpus {
  evidence: EvidenceStore;
  support: SkillSupport[];
  issues: { update_id: string; code: 'source_changed' | 'source_missing' | 'quote_missing' | 'conflict'; message: string }[];
}
export interface CorpusVersioning {
  fingerprint(record: EvidenceRecord): string;
}
export function applyCorpusSnapshot(source: EvidenceStore, snapshot: CorpusSnapshot, versioning: CorpusVersioning): EffectiveCorpus;
export function applicableSkillSupport(support: SkillSupport[], context: CorpusContext): SkillSupport[];
export function supportsTerm(term: string, citationIds: string[], evidence: EvidenceRecord[], support: SkillSupport[]): boolean;
```

`EvidenceStore` and `EvidenceRecord` are existing core exports. Import the new corpus contracts from Task 1. `applicableSkillSupport` returns workspace support plus exact matching scoped support; missing context never matches a non-workspace scope.

- [ ] **Step 2: Inject deterministic source fingerprinting.** Keep the pure corpus resolver synchronous so existing EvidenceStore loaders and tailoring dependency callbacks do not require a broad asynchronous refactor. Add `CorpusVersioning` above, and supply this adapter from the CLI corpus service. Core tests supply the same SHA-256 algorithm using `node:crypto` in the test environment. Never compute trust from a client-supplied hash alone.

```ts
import * as C from '@featherduster/core';
import { fingerprint } from '../jobs/files.js';

export const corpusVersioning: C.CorpusVersioning = {
  fingerprint: record => fingerprint(C.serializeEvidenceMarkdown(record.entry, record.narrative)),
};
```

- [ ] **Step 3: Fold immutable updates into the effective corpus.** Apply explicit withdrawals/supersessions first. An amendment replaces only its matching evidence identity and base version; mismatches produce issues and do not apply. User-confirmed factual amendments are effective provisional evidence and newly changed metrics remain unverified; preserve the original record as source history. Apply relationships only after their bound evidence versions and literal passages are verified. Retraction, withdrawal, contradictory active updates, and changed support passages prevent automatic reuse. If an unrelated source edit preserves every bound passage and its confidence/in-flight status, retain a relationship with an updated derived binding; otherwise mark it for review.
- [ ] **Step 4: Implement the term predicate.** Compare normalized complete permitted terms, require `support === 'direct'`, require every supporting source to be non-retracted, and require the proposal's citations to include the relationship's sources. `unsupported` relationships veto reuse of the same relationship; they do not retract the candidate's skill globally. Use explicit supersession to resolve contradictory mappings.
- [ ] **Step 5: Enrich search without duplicating evidence.** Extend the effective corpus search path to match applicable canonical skill/facet/permitted terms and return the original evidence IDs. Do not synthesize new accomplishment records for skill relationships. Tests assert one evidence record and one coverage contribution after adding multiple terms.
- [ ] **Step 6: Verify.** `npm test -- packages/core/tests/corpus-knowledge.test.ts packages/core/tests/evidence-parser.test.ts packages/core/tests/rubric-parser.test.ts`; `npm run build:core`.
- [ ] **Step 7: Commit the pure corpus implementation and tests.** Message: `feat(corpus): resolve versioned evidence amendments and skills`.

## Task 3: Persist corpus changes and feedback atomically

**Files:** Modify `packages/cli/src/jobs/database.ts` and `packages/cli/src/jobs/repository.ts`; create `packages/cli/src/corpus/repository.ts`; create `packages/cli/tests/corpus-repository.test.ts`.

- [ ] **Step 1: Add failing migration/transaction tests.** Open an existing version-1 database, migrate, close/reopen, and verify the old jobs/control are unchanged. Test stale corpus revision, duplicate operation replay, conflicting replay payload, rollback, and withdrawal history.
- [ ] **Step 2: Append migration 2, preserving migration 1 byte-for-byte.** Use these tables; keep JSON payloads schema-validated at every read boundary.

```sql
CREATE TABLE corpus_heads (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace_metadata(workspace_id),
  revision INTEGER NOT NULL
);
CREATE TABLE corpus_feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id),
  payload TEXT NOT NULL
);
CREATE TABLE corpus_updates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id),
  revision INTEGER NOT NULL,
  feedback_id TEXT NOT NULL REFERENCES corpus_feedback(id),
  supersedes TEXT REFERENCES corpus_updates(id),
  payload TEXT NOT NULL,
  UNIQUE(workspace_id, revision)
);
INSERT INTO corpus_heads SELECT workspace_id,0 FROM workspace_metadata;
```

For a newly created workspace, create its corpus-head row after inserting workspace metadata. Tests must cover both new initialization and migration of a populated workspace.

- [ ] **Step 3: Expose a narrow public receipt helper on JobsRepository.** `withReceipt<T>(operation:string,key:string,request:unknown,fn:()=>T)` delegates to the existing private `receipt` implementation. Do not duplicate receipt hashing or weaken workspace checks.
- [ ] **Step 4: Implement CorpusRepository.** Constructor: `new CorpusRepository(jobsRepository)`. Methods: `snapshot():CorpusSnapshot`, `feedback(id):FeedbackEvent`, `saveFeedback(event):FeedbackEvent`, `apply({expected_revision,feedback,change,supersedes?,idempotency_key}):{snapshot,update,replayed}`, and `withdraw({expected_revision,feedback,update_id,reason,idempotency_key})` implemented as an append-only withdrawal change. Use the supplied database's immediate transaction and `withReceipt`; check workspace IDs and the corpus head before inserting. A successful apply increments the head once. Replay returns the recorded result even if the live head later advanced.
- [ ] **Step 5: Deduplicate and reconcile.** Canonicalize the change plus scope/source bindings to detect the same active update through a different save key. Return the existing active update instead of creating another fact; still retain the new feedback history. A contradictory update to the same skill/source/scope needs an explicit `supersedes` value matching the current record or returns `revision_conflict`.
- [ ] **Step 6: Verify and commit.** `npm test -- packages/cli/tests/corpus-repository.test.ts packages/cli/tests/jobs-repository.test.ts`; `npm run build:cli`. Message: `feat(corpus): persist feedback with transactional revisions`.

## Task 4: Expose one effective corpus to readers and editors

**Files:** Create `packages/cli/src/corpus/service.ts`, `packages/cli/src/corpus/load.ts`, and `packages/cli/src/corpus/routes.ts`; modify `packages/cli/src/server.ts` and `packages/cli/src/jobs/runtime.ts`; create `packages/cli/tests/corpus-routes.test.ts`.

- [ ] **Step 1: Add failing API tests.** A consolidated-ledger fixture accepts a companion amendment without rewriting its file. The evidence API shows effective and original content; search finds the remembered backend link. Wrong source hash, quote not in the source, missing/retracted source, foreign workspace, client-supplied verification flags, and stale source versions fail concretely.
- [ ] **Step 2: Separate raw source loading from effective loading.** Retain the current directory/parser logic as exported `loadSourceEvidenceStore(workspaceDir)`. Export `loadEvidenceStore(workspaceDir)` as the synchronous effective wrapper. `corpus/load.ts` reads the existing SQLite corpus tables read-only when present and returns an empty snapshot for a legacy/no-database workspace; reading evidence alone must not migrate or create a jobs database. It uses `applyCorpusSnapshot` and the synchronous corpusVersioning adapter from Task 2. Open read-only handles in a bounded try/finally and close them after loading.
- [ ] **Step 3: Implement CorpusService around raw sources plus CorpusRepository.** Methods: `read(context?)`, `preview(change,context)`, `remember(request)`, and `withdraw(request)`. Preview checks actual source bytes and returns the exact effective diff and affected support. Remember repeats those checks inside the admitted operation, assigns local-human provenance on the server, and never wakes a worker. The raw source loader does not call the effective loader recursively.
- [ ] **Step 4: Mount strict routes.** Add GET `/api/corpus`, POST `/api/corpus/preview`, POST `/api/corpus/updates`, and POST `/api/corpus/updates/:id/withdraw`. All write requests carry `expected_revision` and `idempotency_key`; preview has no durable effect. Return source/effective evidence and active/withdrawn/conflicted knowledge separately. Reuse the server's existing localhost and JSON protections.
- [ ] **Step 5: Make readers consistent.** Use the effective loader in evidence filtering, rubric analysis, manual tailoring evidence loads, and job capture while preserving their existing synchronous callback signatures. For JobsRuntime, assemble effective evidence using its own database connection and a raw-source callback, so a capture transaction sees one corpus revision. Preserve injected test dependencies with an empty default knowledge snapshot. Keep manual Tailor's human approval semantics unchanged. In prompt and validation paths that need relationships as well as evidence, pass the complete EffectiveCorpus view rather than trying to recover relationship provenance from added themes.
- [ ] **Step 6: Verify and commit.** `npm test -- packages/cli/tests/corpus-routes.test.ts packages/cli/tests/server.test.ts packages/cli/tests/evidence-writes.test.ts packages/cli/tests/tailoring.test.ts`; `npm run build`. Message: `feat(corpus): expose effective evidence and remembered support`.

## Task 5: Use remembered support in prompts and validation

**Files:** Modify `packages/core/src/tailoring/context.ts`, `packages/core/src/tailoring/validators.ts`, `packages/core/src/jobs/preparation.ts`, `packages/cli/src/tailoring/orchestrator.ts`, and `packages/cli/src/server.ts`; extend `packages/core/tests/corpus-knowledge.test.ts`, `packages/core/tests/job-preparation.test.ts`, `packages/core/tests/tailoring.test.ts`, and `packages/cli/tests/tailoring.test.ts`.

- [ ] **Step 1: Add the incident's failing validator test.** A proposal says `Built backend APIs.` and cites evidence containing APIs/BFF but not backend. It fails without support, passes with the exact approved direct backend relationship, and still fails with a missing citation, retracted source, an unrelated relationship, or a source/version mismatch. Changing the text to add `Kafka`, `music`, `architected`, or a new unsupported number must not gain support from the backend relationship. Include the non-numeric terms in the fixture's requirement vocabulary: this proves that a relationship resolves only its permitted terms, not that the deterministic validator can establish arbitrary natural-language factual accuracy.
- [ ] **Step 2: Add an explicit grounding input to ProposalValidationContext.** `skillSupport?:SkillSupport[]` contains only server-verified/applicable snapshot support. Use `supportsTerm` in both the delegated ledger-ceiling term test and the candidate `unsupported_experience` term test. Do not mutate alignment classifications or feed a forged `candidate_confirmed` flag to bypass checks. Retain metric, dangling-citation, privacy, and target checks independently.
- [ ] **Step 3: Prevent sticky machine errors on recheck.** At the proposal review service boundary, start each revalidation from canonical generation fields plus allowed human patches and `checks:[]`. Preserve human grounding as separate records. Do not change the core validator's existing treatment of explicitly supplied pre-existing checks for other callers.
- [ ] **Step 4: Add support context to prompts.** Extend existing ContextOptions with optional `skillSupport`. Add a named, bounded section to alignment/proposal prompts containing applicable skill, facet, permitted wording, support level, and cited passages. Feed all prose through the existing locality/privacy redaction path. Treat this as source data, not instructions or approval. Keep ordinary feedback history and private audit metadata out of model prompts.
- [ ] **Step 5: Wire manual readers explicitly.** Add optional `loadSkillSupport:()=>SkillSupport[]` to OrchestratorDeps. In createApp, supply it from the same effective corpus view as loadEvidence; in buildInput and revalidateProposals, pass it as skillSupport alongside the existing evidence. Tests without that callback use an empty list. Keep analysis/alignment/proposals approval and staleness behavior unchanged. Job preparation consumes its captured knowledge instead of this live callback.
- [ ] **Step 6: Verify and commit.** `npm test -- packages/core/tests/corpus-knowledge.test.ts packages/core/tests/job-preparation.test.ts packages/core/tests/tailoring.test.ts packages/cli/tests/tailoring.test.ts`; `npm run build`. Message: `feat(tailoring): share learned support with prompts and validators`.

## Task 6: Capture corpus knowledge in immutable job inputs

**Files:** Modify `packages/core/src/jobs/schemas.ts`, `packages/cli/src/jobs/artifacts.ts`, and `packages/cli/src/jobs/runtime.ts`; extend `packages/cli/tests/job-artifacts.test.ts` and `packages/cli/tests/jobs-routes.test.ts`.

- [ ] **Step 1: Add failing snapshot tests.** Capture with a remembered backend relationship, withdraw it live, and verify the historical snapshot is byte-identical while a new capture has a different fingerprint. A legacy snapshot without corpus knowledge still loads. A tampered knowledge bundle fails before a model call.
- [ ] **Step 2: Add optional `corpus_knowledge: ImmutableReference` to InputSnapshotSchema.** Do not default the field into old stored manifests: `getInputSnapshot` compares canonical metadata byte-for-byte. Missing means an empty knowledge snapshot for old jobs. A new capture always writes `corpus-knowledge.json` using the canonical serialization and includes that reference in the manifest/fingerprint.
- [ ] **Step 3: Extend CaptureInputsRequest with optional `corpus_knowledge:CorpusSnapshot`.** At capture, resolve effective evidence and applicable knowledge from the same corpus revision. Never include a relationship whose sources are not selected; do not treat live knowledge as an implicit dependency during a frozen run.
- [ ] **Step 4: Load and verify captured knowledge in preparation.** Read through JobFiles.readSnapshot, validate the schema, check bindings against captured evidence, and pass applicable support to prompts and validators. Current consent/tool/ownership checks remain fresh on every attempt.
- [ ] **Step 5: Verify and commit.** `npm test -- packages/cli/tests/job-artifacts.test.ts packages/cli/tests/jobs-routes.test.ts packages/core/tests/jobs.test.ts`; `npm run build`. Message: `feat(jobs): bind corpus knowledge to immutable inputs`.

## Task 7: Define durable generations, review revisions, and typed blockers

**Files:** Create `packages/core/src/jobs/proposal-review.ts`; modify `packages/core/src/jobs/schemas.ts` and `packages/core/src/index.ts`; create `packages/core/tests/job-proposal-review.test.ts`.

- [ ] **Step 1: Add failing contract tests.** Distinguish saved output from completed-stage checkpoints. Reject client patches that change a proposal's ID, type, target, original generation text, or validation flags. Editing wording/citations must stale the prior grounding decision.
- [ ] **Step 2: Define and export these strict schemas and types.** Use the existing ProposalSetSchema, ResumeSpecSchema, ValidationIssueSchema, ImmutableReferenceSchema, and SourceSupportSchema.

```ts
export interface ProposalGeneration {
  schema_version: 1; id: string; workspace_id: string; job_id: string;
  attempt_id: string; input_snapshot_id: string; input_fingerprint: string;
  raw_output: ImmutableReference; proposals: ProposalSet; created_at: string;
}
export interface ClaimGrounding {
  proposal_id: string; claim_fingerprint: string; term: string;
  sources: SourceSupport[]; explanation: string;
  recorded_by: string; recorded_at: string;
}
export interface ProposalIssue {
  id: string; proposal_id: string | null; field_path: string | null;
  severity: 'block' | 'warn'; kind: string; message: string;
  requirement_ids: string[]; evidence_ids: string[];
  actions: ('edit' | 'citations' | 'reject' | 'ground' | 'refresh_inputs')[];
}
export interface ProposalReviewRevision {
  schema_version: 1; id: string; revision: number; workspace_id: string; job_id: string;
  generation_id: string; input_snapshot_id: string; input_fingerprint: string;
  proposals: ProposalSet; groundings: ClaimGrounding[]; candidate: ResumeSpec;
  issues: ProposalIssue[]; validation_fingerprint: string;
  status: 'needs_review' | 'ready_to_continue' | 'stale';
  feedback_ids: string[]; corpus_update_ids: string[]; created_at: string;
}
export interface ProposalPatch {
  proposal_id: string; edited_after?: string; citations?: string[];
  decision?: 'pending' | 'rejected';
}
```

`ProposalSet` is the existing inferred ProposalSetSchema type; export it if needed rather than defining a second shape. Server code assigns IDs, fingerprints, provenance, statuses, issue actions, and timestamps. Request schemas omit those fields.

- [ ] **Step 3: Add a backward-compatible `recovery` field to JobSchema.** Optional nullable strict value: `{kind:'proposals'|'candidate'|'setup'|'fact'|'render'|'stale_inputs', review_id:string|null, generation_id:string|null}`. Existing keys/reasons remain readable. UI dispatches on this typed field, not message regexes. Use a distinct `proposal_review` event payload containing review ID/revision and status, plus a `corpus_updated` payload containing corpus revision/update IDs; keep those events in the existing ordered SSE stream.
- [ ] **Step 4: Implement pure review helpers.** `applyProposalPatches(generation,patches)` preserves canonical IDs/targets and strips old machine checks. `normalizeProposalIssues(validated,candidateIssues)` assigns stable IDs from subject/kind/message, groups related term-grounding messages for display without deleting their check details, and gives candidate-wide failures a field path. `detectProposalConflicts(proposals)` blocks multiple included text replacements/drops of one original target and conflicting reorders of one group. Keep valid reorder/add combinations supported by the existing application algorithm.
- [ ] **Step 5: Verify and commit.** `npm test -- packages/core/tests/job-proposal-review.test.ts packages/core/tests/job-preparation.test.ts packages/core/tests/jobs.test.ts`; `npm run build:core`. Message: `feat(jobs): define revisioned proposal review and recovery issues`.

## Task 8: Persist output before failure and bind review to attempts

**Files:** Modify `packages/cli/src/jobs/database.ts`; create `packages/cli/src/jobs/proposal-repository.ts`; create `packages/cli/tests/job-proposal-repository.test.ts`.

- [ ] **Step 1: Add failing persistence tests.** Save a generation under an ownership fence, reopen the database, and read it without requiring a successful proposals checkpoint. Append a review revision; verify stale concurrent saves, foreign job/input bindings, inactive worker writes, and tampered generation bytes are rejected.
- [ ] **Step 2: Append migration 3.** Use the following table contracts and schema-validated JSON payloads.

```sql
CREATE TABLE proposal_generations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), payload TEXT NOT NULL
);
CREATE TABLE proposal_review_revisions (
  id TEXT NOT NULL, revision INTEGER NOT NULL,
  workspace_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
  generation_id TEXT NOT NULL REFERENCES proposal_generations(id),
  input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), payload TEXT NOT NULL,
  PRIMARY KEY(id,revision)
);
CREATE TABLE job_proposal_reviews (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id), review_id TEXT NOT NULL, revision INTEGER NOT NULL,
  FOREIGN KEY(review_id,revision) REFERENCES proposal_review_revisions(id,revision)
);
CREATE TABLE attempt_proposal_reviews (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), review_id TEXT NOT NULL, revision INTEGER NOT NULL,
  validation_fingerprint TEXT NOT NULL,
  FOREIGN KEY(review_id,revision) REFERENCES proposal_review_revisions(id,revision)
);
```

- [ ] **Step 3: Implement ProposalRepository around JobsRepository.** Methods: `saveGeneration(value,fence)`, `getGeneration(id)`, `getActive(jobId)`, `getRevision(id,revision)`, `appendReview(value,expectedRevision)`, `bindAttempt(attemptId,reviewId,revision,validationFingerprint)`, and `getAttemptReview(attemptId)`. New review IDs start at revision 0; updates append revision N+1. Validate generation/input/attempt/workspace bindings on every write. Read generation bytes through the existing JobFiles hash checks. Never choose active review by querying the latest unrelated draft.
- [ ] **Step 4: Retain revision provenance transactionally.** CorpusRepository and ProposalRepository use the same connection. Save and remember writes feedback, a corpus update, the review revision, and its event in one immediate transaction and one receipt. Fail the whole operation if any source/revision check fails.
- [ ] **Step 5: Verify and commit.** `npm test -- packages/cli/tests/job-proposal-repository.test.ts packages/cli/tests/corpus-repository.test.ts packages/cli/tests/jobs-repository.test.ts`; `npm run build:cli`. Message: `feat(jobs): persist generated proposals and review selections`.

## Task 9: Implement review read/save/recheck and remembered corrections

**Files:** Create `packages/cli/src/jobs/proposal-service.ts`; modify `packages/cli/src/jobs/runtime.ts`; create `packages/cli/tests/job-proposal-service.test.ts`.

- [ ] **Step 1: Add failing zero-model-call tests.** Seed a schema-valid backend proposal plus saved analysis/alignment/evidence. Read it, edit wording, change citations, reject it, save/reload, and verify the derived candidate and errors. A corrected proposal loses obsolete machine errors. Tests assert no runner construction or model request during these operations.
- [ ] **Step 2: Implement the service contract.** Construct `ProposalService` with JobsRepository, ProposalRepository, JobArtifactsService, and CorpusService. Public methods: `read(jobId)`, `save(request)`, `recheck(request)`, `continue(request)`, and `recover(request)`. `read` returns generation, active review, captured base/analysis/alignment/evidence, and applicable knowledge. Missing output returns `{availability:'missing_output',recoverable:boolean}` instead of inventing proposal text.

The save request is:

```ts
export interface SaveProposalReviewRequest {
  job_id: string; review_id: string; expected_job_revision: number;
  expected_review_revision: number; input_fingerprint: string;
  patches: ProposalPatch[];
  groundings: Omit<ClaimGrounding,'recorded_by'|'recorded_at'>[];
  feedback_kind: FeedbackEvent['kind']; explanation: string;
  remember?: { expected_corpus_revision: number; change: CorpusChange; supersedes?: string };
  idempotency_key: string;
}
```

- [ ] **Step 3: Canonicalize and validate saves.** Resolve the immutable generation and current review, check job/input/review revisions and no active attempt, apply allowed patches, verify selected passages, assign local-human grounding provenance, and recompute candidate checks from clean canonical proposals. Job-local grounding may resolve only its bound claim and term; promoting a reusable mapping additionally checks current corpus sources. User factual additions absent from the captured input return a typed `stale_inputs` result requiring explicit refresh; never inject changed facts invisibly into the old snapshot.
- [ ] **Step 4: Save feedback and optional memory in the same transaction.** Job-only feedback never changes active corpus knowledge. A remembered correction calls CorpusService validation and CorpusRepository apply on the same connection. Return review status, remaining issues, updated job revision, and new corpus revision. Preserve empty/negative feedback without inventing a reusable capability judgment.
- [ ] **Step 5: Produce a versioned validation fingerprint.** Hash canonical `{generation_id,input_fingerprint,review_revision,proposals,groundings,validator_version:1}` and store it with the server-derived candidate/issues. Recheck uses the identical inputs and produces the identical fingerprint; it does not append duplicate feedback/events for an unchanged revision. `ready_to_continue` requires no blocking proposal, target conflict, or retained candidate issue.
- [ ] **Step 6: Add conflict and undo tests.** Stale review saves preserve server state; unsupported forged grounding fails; removing or changing a claim invalidates its old grounding; remembering the same change twice does not duplicate corpus knowledge; withdrawal changes later corpus reads but not this generation's frozen inputs.
- [ ] **Step 7: Verify and commit.** `npm test -- packages/cli/tests/job-proposal-service.test.ts packages/cli/tests/job-proposal-repository.test.ts packages/core/tests/job-proposal-review.test.ts`; `npm run build:cli`. Message: `feat(jobs): save and recheck reviewed proposals with corpus feedback`.

## Task 10: Resume the exact reviewed revision and recover older jobs

**Files:** Modify `packages/cli/src/jobs/preparation.ts`, `packages/cli/src/jobs/worker.ts`, `packages/cli/src/jobs/service.ts`, and `packages/cli/src/jobs/repository.ts`; extend `packages/cli/tests/jobs-worker.test.ts` and `packages/cli/tests/job-proposal-service.test.ts`.

- [ ] **Step 1: Add the failing incident reproduction.** Return valid analysis and alignment, then a schema-valid unsupported-backend proposal. Assert the job enters `needs_input` with typed proposal recovery, a readable generation/review, and zero proposals checkpoints. Fix/reject the proposal, continue, and assert `resume_ready` with unchanged analysis/alignment, no second proposals-generation call, and an artifact containing the reviewed text.
- [ ] **Step 2: Persist before semantic validation.** In the proposals-stage execution, normalize model-supplied decisions/flags, write raw output as a unique immutable artifact bundle, and save generation plus initial review under the current ownership fence. Perform semantic validation after saving generation. Throw PreparationBlocked with structured recovery when invalid; do not create a completed proposals checkpoint for blocked content.
- [ ] **Step 3: Extend PreparationBlocked with optional recovery data.** Preserve the existing message-only constructor for setup/tool callers. Carry `{kind,review_id,generation_id,issues}` for proposal/candidate failures. Worker catch persists those fields and chooses an actionable missing-input key instead of mapping every failure to a generic answer. Continue emitting meaningful changes through the current SSE reconciliation path.
- [ ] **Step 4: Admit continuation atomically.** ProposalService.continue accepts `{job_id,review_id,expected_job_revision,expected_review_revision,input_fingerprint,validation_fingerprint,idempotency_key}`. Recheck all bindings and readiness; reject stopped, paused, stale, or worker-busy admissions with an actionable result. Extend the internal JobsService request transaction with an attempt-binding callback that runs before commit; notifications and worker launch remain after that commit. Use that callback to persist the selected review binding before any model work can start. Do not wrap an existing launch-and-notify method in an outer transaction that could emit events before commit. A replay returns its original attempt and cannot launch another model request.
- [ ] **Step 5: Consume the frozen selection.** Preparation first checks `getAttemptReview(attempt.id)`. If present, read exactly that revision, verify its fingerprint and captured source support, use its reviewed proposals, and complete a valid proposals checkpoint. Reuse only the valid contiguous earlier checkpoints bound to the same input snapshot. Recompute brief/cleanup/compile/verification from the reviewed candidate. Never substitute the latest mutable review after a run starts. Keep fresh consent/tool/ownership checks.
- [ ] **Step 6: Implement historical recovery.** For a needs-input job stopped at proposals with no generation, recover uses the saved input snapshot and existing valid analysis/alignment prefix, creates one explicit new attempt, and runs proposal generation once. The newly generated output is retained regardless of semantic pass/failure. A repeated recovery key cannot generate twice. An interrupted generation with uncertain completion remains interrupted until an explicit action.
- [ ] **Step 7: Retain render failures and test stop/cancel behavior.** If compilation/page verification fails, retain its source and diagnostics as a uniquely identified failed stage output under the current fence; link a typed render/candidate issue to the saved review. Do not mark that output passed or complete a successful checkpoint. Cover Stop between save and continue, cancellation before generation persistence, a late ignored-abort result, revoked consent, missing tools, timeout, tampered output, worker contention, and duplicate continuation. Assert bounded calls and no ready artifact without passed PDF validation. Existing global Stop semantics are preserved, with an explicit prevented-start response.
- [ ] **Step 8: Verify and commit.** `npm test -- packages/cli/tests/jobs-worker.test.ts packages/cli/tests/job-proposal-service.test.ts packages/cli/tests/job-artifacts.test.ts`; `npm run build:cli`. Message: `feat(jobs): resume validated proposal revisions and recover lost output`.

## Task 11: Add strict review transport and typed UI clients

**Files:** Modify `packages/cli/src/jobs/routes.ts`, `packages/cli/src/jobs/runtime.ts`, and `packages/ui/src/api/client.ts`; extend `packages/cli/tests/jobs-routes.test.ts` and `packages/cli/tests/corpus-routes.test.ts`.

- [ ] **Step 1: Add failing route tests for the whole contract.** Use temporary workspaces and injected fake runners/renderers. GET reads and save/recheck make no model calls. Save and remember returns persisted corpus state; continue consumes the saved revision. Reject malformed JSON, unknown fields, forged provenance, cross-job review IDs, foreign snapshots, stale revisions, and a client-supplied ready flag.
- [ ] **Step 2: Mount these endpoints using the existing error and localhost wrappers.**

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/api/jobs/:id/proposals` | None | Availability, generation/review, captured context, corpus revision. |
| PUT `/api/jobs/:id/proposals/:reviewId` | SaveProposalReviewRequest without path IDs | Updated job/review; optional remembered update and corpus revision. |
| POST `/api/jobs/:id/proposals/:reviewId/recheck` | Expected job/review revisions and input fingerprint | Stable validation result and remaining typed issues. |
| POST `/api/jobs/:id/proposals/:reviewId/continue` | Exact continuation binding from Task 10 | Admitted attempt; or explicit actionable prevented-start error. |
| POST `/api/jobs/:id/proposals/recover` | Expected job revision, saved input ID, idempotency key | Explicit new recovery attempt. |

- [ ] **Step 3: Expose review summary and worker counts.** Extend jobDetail with optional `{proposal_review:{availability,review_id,revision,status,blocking_count}|null}`. Extend control status with `{queued_count,needs_review_count}`. Existing clients tolerate absent new fields; an idle worker explains pending review without polling models. Remove no owner-token filtering.
- [ ] **Step 4: Add corresponding ApiClient methods.** Names: `getJobProposals`, `saveJobProposals`, `recheckJobProposals`, `continueJobProposals`, `recoverJobProposals`, `getCorpus`, `previewCorpusChange`, `rememberCorpusChange`, and `withdrawCorpusChange`. Use the existing JSON request and ApiError behavior. Export shared response types with discriminated availability and no worker credentials.
- [ ] **Step 5: Verify and commit.** `npm test -- packages/cli/tests/jobs-routes.test.ts packages/cli/tests/corpus-routes.test.ts`; `npm run build`. Message: `feat(api): expose proposal recovery and corpus learning actions`.

## Task 12: Build the proposal resolution workspace

**Files:** Create `packages/ui/src/views/jobs/JobProposalReview.tsx`, `JobProposalEditor.tsx`, and `JobEvidenceChooser.tsx`; modify `packages/ui/src/views/jobs/JobDetail.tsx`, `JobResumeReview.tsx`, `JobAnswers.tsx`, and `WorkerControls.tsx`; create `packages/ui/tests/job-proposal-review.test.tsx`; extend `packages/ui/tests/jobs-ui.test.tsx`.

- [ ] **Step 1: Add failing user-flow tests.** A needs-input job without any PDF shows Resolve proposals and the actual blocked proposal. Editing/removing backend or choosing appropriate evidence can save/recheck; rejecting retains original text. Tests inspect resulting API payloads and visible candidate text, not only mocked call counts.
- [ ] **Step 2: Render review before artifact-empty handling.** JobResumeReview accepts optional proposal-review availability and renders JobProposalReview above the existing artifact picker. Missing old output renders Recover proposal review with an explanation that one generation is needed. JobDetail's contextual action navigates to this view; it does not blindly call generic resume for unresolved proposal errors.
- [ ] **Step 3: Implement the editor from shared primitives.** Reuse `wordDiff`, `CitationChip`, `IssueList`, `cardClass`, and field/button styles, but keep candidate-mode inclusion separate from manual Tailor's human-approval semantics. Show proposal type/target, original and effective wording, requirement text, current source passages, grouped issues, and include/reject actions. Blocked edits remain editable and inspectable.
- [ ] **Step 4: Search captured evidence in JobEvidenceChooser.** Search canonical terms, title/narrative, and approved skill relationships. Show entry confidence, direct/transferable support, exact passage, and a selected-citation list. Do not mix newer live evidence into the frozen review; offer explicit refresh when a needed source is outside the snapshot.
- [ ] **Step 5: Implement save controls and memory preview.** Maintain an editor draft separate from server data. Save for this job sends patches, review grounding, feedback, and no remember field. Save and remember shows and sends the specific typed corpus change plus expected corpus revision. Continue remains a separate action enabled only for a saved, current, ready revision. Neither save path calls prepare/continue implicitly.
- [ ] **Step 6: Preserve drafts across refresh/reload.** Keep dirty field state on SSE reconciliation. Persist unsaved editor patches under a workspace/job/review/revision key in local storage, with a visible unsaved indicator. Clear only after acknowledgement of that exact save. On stale revision, retain the editor and offer compare/reconcile rather than replace. Do not reuse saved patches on another review generation. While an attempt is active, disable review saves server-side and show the selected frozen revision.
- [ ] **Step 7: Route other blockers honestly.** Typed proposal/setup/render blockers get resolver links, never JSON fact editors. Genuine candidate facts retain their form. WorkerControls displays `Idle — N jobs need review` when applicable and reports prevented starts using returned error details.
- [ ] **Step 8: Test keyboard and narrow layouts.** Label every editor and citation control; associate issues with fields using aria-describedby; announce save/recheck outcomes; focus the first blocking field after a failed recheck. Verify Escape/focus return for the evidence chooser. Add a 375px viewport check without horizontal overflow.
- [ ] **Step 9: Verify and commit.** `npm test -- packages/ui/tests/job-proposal-review.test.tsx packages/ui/tests/jobs-ui.test.tsx packages/ui/tests/tailoring-ui.test.tsx`; `npm run build:ui`. Message: `feat(ui): resolve blocked proposals and remember feedback`.

## Task 13: Make learned corpus knowledge visible and reversible

**Files:** Create `packages/ui/src/components/CorpusKnowledgePanel.tsx`; modify `packages/ui/src/components/EvidenceDetailModal.tsx`, `packages/ui/src/views/RubricGapMatrix.tsx`, and `packages/ui/src/views/desk/EvidenceStrengthener.tsx`; create `packages/ui/tests/corpus-learning.test.tsx`; extend `packages/cli/tests/corpus-routes.test.ts`.

- [ ] **Step 1: Add failing corpus-view tests.** After remembered feedback, an evidence detail shows the supported backend concept, exact source, confirmation/provenance, and originating correction. Skills exposes the same link without an additional accomplishment count. Withdrawal stops future applicability and preserves the history. A job-only rejection never removes a skill.
- [ ] **Step 2: Implement CorpusKnowledgePanel.** Accept evidence/skill filters and render active, withdrawn, superseded, or source-conflicted records. Show original/effective evidence differences and the correction's explanation. Withdraw is an append-only operation with expected revision and an optional explanatory field; it is not deletion. A source conflict offers reconcile against current passages, not a silent overwrite.
- [ ] **Step 3: Connect evidence amendment saving.** Keep direct standalone source-file editing behavior. For consolidated ledgers, preview a companion amendment and save it through the corpus API instead of returning only a refusal. Clearly distinguish user-confirmed provisional changes from existing verified assertions and metric status. Support withdrawal of amendments and show the restored effective source view.
- [ ] **Step 4: Refresh read models after successful corpus updates.** Evidence and Skills refresh after acknowledged saves/withdrawals and on corpus_updated SSE events. Existing active job reviews show that newer corpus knowledge exists and require explicit refresh to use it; no event automatically starts preparation.
- [ ] **Step 5: Verify and commit.** `npm test -- packages/ui/tests/corpus-learning.test.tsx packages/ui/tests/desk-strengthen.test.tsx packages/ui/tests/rubric-gaps.test.tsx packages/cli/tests/corpus-routes.test.ts`; `npm run build`. Message: `feat(ui): inspect and revise remembered evidence knowledge`.

## Task 14: Prove the cross-job learning loop and ship the usable slice

**Files:** Create `packages/cli/tests/job-proposal-learning.test.ts`; extend `packages/ui/tests/job-proposal-review.test.tsx`; update `README.md` with proposal recovery and Save and remember behavior.

- [ ] **Step 1: Add the cross-job integration regression.** In a temporary workspace, generate the backend mismatch for Job A, save a source-bound grounding decision with Save and remember, continue to a validated candidate, then create Job B from a different posting requiring backend work. Assert Job B retrieves the same evidence, includes the applicable relationship in its prompts, and passes deterministic grounding without another user decision. Assert Job A's captured inputs remain unchanged.
- [ ] **Step 2: Add negative recurrence tests.** Withdraw the mapping before Job C: it must not reuse it. Retract/change the supporting source: it must require review. Add Kafka/unsupported metric wording: backend support must not validate it. Remember a role-scoped irrelevant decision: another role still sees the evidence. Save the same feedback twice: one reusable change. Amend a consolidated-ledger source: raw file bytes stay unchanged, effective evidence changes, and source-version conflicts are explicit.
- [ ] **Step 3: Add a controlled UI walkthrough.** Use a temporary workspace and fake runner/renderer, never the private career workspace. Verify recovery without a PDF, actual proposal edits, Save for this job versus Save and remember, readiness/continuation, correct PDF diff, learned support in Evidence/Skills, withdrawal, stale-tab reconciliation, and Stop behavior. Capture a screenshot of the completed review state and a screenshot of remembered support.
- [ ] **Step 4: Run the required release checks.** `npm test`; `npm run build`; `git -c core.whitespace=cr-at-eol diff --check -- packages/core packages/cli packages/ui README.md docs/superpowers`. Expected: all tests/build pass; separate any unrelated pre-existing failures from regressions and fix feature regressions before shipping. Run further checks only if new changes or failures require them.
- [ ] **Step 5: Document and verify the change.** README explains that saving does not run models, remembered learning is explicit/local/versioned, old snapshots remain historical, recovery of pre-feature lost output needs one generation, and unsupported claims still block. Review the diff against the coverage matrix below and commit explicit paths with message `test(jobs): verify proposal recovery learns across runs`.
- [ ] **Step 6: Verify the reported job after deployment.** Load the rebuilt server using the existing authorized local startup flow. Before any real recovery model call, confirm the current job state and worker controls. Use Recover proposal review once for `1fe3d32d-3cc7-4d8b-a829-6ccc9e3683ff`, inspect the actual regenerated proposal, and let the user choose a truthful correction. Do not infer or silently record backend experience on the user's behalf from the error text. If a server restart is blocked by automatic approval review, report that concrete action/reason and provide the verified build and restart instructions without claiming the live UI is updated.

## Coverage and completion review

| Approved requirement | Tasks |
| --- | --- |
| Preserve blocked generations without successful checkpoints | 7, 8, 10 |
| Inspect wording, requirements, citations, and grouped issues before a PDF exists | 7, 11, 12 |
| Edit, change citations, reject, ground, locally recheck, explicitly continue | 5, 9, 10, 12 |
| Save feedback and reusable knowledge without model calls | 1–4, 9, 12 |
| Learn factual corrections, skill support, and citation associations | 1–5, 9, 13 |
| Use learned knowledge in search, prompts, and validation | 2, 4–6, 14 |
| Preserve confidence/metric boundaries and avoid duplicated accomplishments | 2, 5, 13, 14 |
| Support consolidated ledgers without destructive rewriting | 2, 4, 13, 14 |
| Version, invalidate, reconcile, withdraw, and undo | 2, 3, 6, 8, 9, 13 |
| Resume a frozen review and retain historical artifacts | 6, 8–10, 14 |
| Recover the pre-feature job with one explicit proposal generation | 10, 12, 14 |
| Preserve Stop/cancellation/ownership/resource limits | 10–12, 14 |
| Honest idle/setup/fact/render/stale-input routing | 7, 10–12 |
| Two-tab and reload recovery; accessible narrow-screen controls | 8, 9, 12–14 |
| Existing manual Tailor and exact artifact approval remain valid | 4, 5, 10, 14 |

Before implementation, confirm file paths and current signatures against this workspace. During execution, keep the schemas and service contracts above synchronized rather than adding ad hoc flags or parsing joined error strings. Any scope change to generation assistance, broad semantic inference, or worker Stop semantics requires a separate design decision.
