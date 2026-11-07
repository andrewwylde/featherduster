# Draft-first Resume Tailoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a posting and a user-supplied resume into a supported, tailored PDF with no mandatory fact interview or manual save/check/continue sequence, followed by one explicit artifact approval.

**Architecture:** Keep the existing preparation coordinator, input snapshots, corpus, revisions, renderer, and approval services. Add explicit assertion support and one persisted completion decision, then move progression into the backend and make the UI consume a PDF-centered review projection. Preserve the legacy policy for existing saved revisions until explicit preparation under the new policy.

**Tech Stack:** TypeScript, Zod, Node.js, Hono, SQLite through the existing repository, React, Vitest, Testing Library, Playwright, and the existing LaTeX/PDF renderer.

---

## Approved specification and execution rules

Read `docs/superpowers/specs/2026-11-06-draft-first-tailoring-design.md` before executing. The user approved the written specification on 2026-11-06. This plan does not itself change application behavior.

This is one dependent workflow, not several independently deployable products. Deliver the slices in order; activate new captures in Task 7 and release the new flow only after the end-to-end acceptance gate passes. New identifiers and contracts below are proposed implementation contracts, not claims that those APIs already exist.

- Use the configured runner, current consent, and captured budgets. Do not silently reset budgets after an edit, reload, or crash.
- Do not change the real career ledger, submit answers, or approve an artifact while testing. Write tests in disposable workspaces. Real preparation requires an explicit user preparation action.
- Preserve the current dirty working tree. The accomplishment synthesis, omission controls, clarification work, and layout changes are prerequisites, not disposable changes.
- No global `git add .`, reset, stash, or cleanup. Stage explicit paths or reviewed hunks per task. On Windows, use UTF-8 and LF for text edits.
- Each task follows test, demonstrated failure, implementation, passing focused checks, then a scoped commit. Run broader checks once at the final integration gate; repeat only for a changed or failing area.
- Treat test code below as the first regression for each seam. The named additional cases are required; do not substitute tests that only mirror the implementation.

## File and responsibility map

| Files | Responsibility |
| --- | --- |
| New `packages/core/src/jobs/tailoring-completion.ts` | Pure completion decision, binding, checks, and artifact gate |
| New `packages/core/src/jobs/assertion-support.ts` | Explicit baseline/human/documentary support; complete claim coverage |
| New `packages/core/src/corpus/career-identity.ts` | Stable employment/work identity and matching boundaries |
| Existing `packages/core/src/corpus/schemas.ts`, `packages/core/src/corpus/clarifications.ts`, `packages/core/src/corpus/knowledge.ts` | Persist identities and source-free human confirmations using the corpus |
| Existing `packages/core/src/jobs/semantic-evidence.ts`, `packages/core/src/jobs/semantic-policy.ts`, `packages/core/src/jobs/semantic-transport.ts` | Versioned classifier and fact/support transport |
| Existing `packages/core/src/jobs/preparation.ts`, `packages/core/src/jobs/candidate-checks.ts`, `packages/core/src/jobs/proposal-review.ts`, `packages/core/src/tailoring/validators.ts` | One factual support path; retain structural/privacy validation |
| New `packages/cli/src/jobs/tailoring-repository.ts` | Immutable baseline/support/completion snapshots and current binding reads |
| New `packages/cli/src/jobs/tailoring-support.ts` | Server-owned baseline capture, source checks, and support resolution |
| Existing CLI corpus/semantic/proposal services | Atomic human answers, reuse, corrections, and persisted support |
| New `packages/cli/src/jobs/tailoring-repair.ts` | Bounded repair planning and supported fallback |
| New `packages/cli/src/jobs/tailoring-review.ts` | Current PDF, completion, changes, optional suggestions, and compatibility projection |
| Existing `preparation.ts`, `packages/cli/src/jobs/preparation-coordinator.ts`, `packages/cli/src/jobs/draft-finalization.ts`, `packages/cli/src/jobs/artifacts.ts` | Backend progression and exact artifact approval binding |
| New `packages/ui/src/views/jobs/draft-autosave.ts` | Serialized writes and durable local recovery, independent of React |
| New `packages/ui/src/views/jobs/JobTailoringReview.tsx` | One main review surface consuming the server projection |
| Existing job editors, artifact review, and API client | Integrate automatic saving and reuse existing PDF/actions |
| New `scripts/verify-draft-first-tailoring.mjs` | Disposable browser acceptance workflow and evidence report |

Avoid putting another coordinator in `packages/ui/src/views/jobs/JobProposalReview.tsx`. Its current `autoChecked` and `autoContinued` effects remain legacy-only and are removed from the new-policy path.

## Task 0: Record the working baseline and lock the failing workflow

**Files:** Inspect `git status`, existing task 41–49 work, `packages/cli/tests/fixtures/automatic-preparation-fixture.ts`, and `scripts/verify-accomplishment-review.mjs`. Create `packages/cli/tests/draft-first-preparation.test.ts`.

- [ ] Record the current branch, commit, changed paths, and a binary diff under ignored `walkthrough-output/draft-first-baseline/`. Save a separate copy of untracked prerequisite source files; `git diff` does not capture them. Do not move or delete originals.

```powershell
New-Item -ItemType Directory -Force walkthrough-output/draft-first-baseline | Out-Null
git rev-parse HEAD > walkthrough-output/draft-first-baseline/commit.txt
git status --short > walkthrough-output/draft-first-baseline/status.txt
git diff --binary --output=walkthrough-output/draft-first-baseline/tracked.patch
```

- [ ] Add the regression below. This first fixture deliberately contains a truthful baseline metric and no documentary sources. Use the existing fixture API, not a new fake repository.

```ts
import { afterEach, expect, it, vi } from 'vitest';
import { automaticPreparationFixture } from './fixtures/automatic-preparation-fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

it('produces a PDF from supplied resume facts without an interview', async () => {
  const f = automaticPreparationFixture(close => cleanups.push(close));
  f.spec.summary = 'Built 3 production APIs.';
  f.spec.experiences = [{ company: 'Acme', role: 'Senior Engineer',
    startDate: '2020', endDate: 'Present',
    bullets: [{ text: 'Built 3 production APIs.' }] }];
  const job = await f.add(), runtime = f.runtime();
  const request = { members: [{ job_id: job.id, expected_revision: job.revision }],
    idempotency_key: 'baseline-only' };
  const batch = runtime.prepareBatch(request).result;
  await vi.waitFor(() => {
    expect(runtime.repository.getJob(job.id).preparation_state).toBe('resume_ready');
  }, { timeout: 15000, interval: 100 });
  expect(runtime.questions.read(batch.id)).toEqual([]);
  expect(runtime.repository.listEvents(job.id)
    .some(event => event.payload.kind === 'resume_review')).toBe(false);
  expect(runtime.prepareBatch(request).replayed).toBe(true);
}, 20000);
```

- [ ] Run `npx vitest run packages/cli/tests/draft-first-preparation.test.ts --reporter=verbose`. Record the actual failure before implementation. Do not make it pass by removing the metric, adding a citation, increasing the budget, or pre-confirming the fact.
- [ ] Keep this regression pending until Task 7. Establish current pass/fail results for the existing proposal, semantic, omission, and automatic-preparation suites. If a lease/timing test fails, inspect it separately; do not label it unrelated without evidence.

## Task 1: Define one versioned completion decision

**Create:** `packages/core/src/jobs/tailoring-completion.ts`, `packages/core/tests/tailoring-completion.test.ts`.
**Modify:** `packages/core/src/index.ts`, `packages/core/src/jobs/schemas.ts`, `packages/core/src/jobs/synthesis.ts`.

- [ ] Add a test proving that answered facts cannot imply a ready PDF:

```ts
import { expect, it } from 'vitest';
import { decideCompletion, type CompletionInput } from '../src/jobs/tailoring-completion.js';
const input: CompletionInput = {
  binding: { input_id: 'input', candidate: 'candidate', support: 'support',
    policy: 'draft-first-1', draft_revision: 2 },
  activity: 'idle', required: [
    { id: 'support', state: 'passed', recovery: 'automatic', message: 'Supported' },
    { id: 'pdf', state: 'pending', recovery: 'automatic', message: 'PDF not rendered' },
  ],
};
it('does not declare readiness before the matching PDF passes', () => {
  expect(decideCompletion(input).state).toBe('needs_retry');
  expect(decideCompletion({ ...input, activity: 'running' }).state).toBe('preparing');
});
it('does not infer completion from an empty check list', () => {
  expect(decideCompletion({ ...input, required: [] }).state).toBe('needs_retry');
});
```

- [ ] Run `npx vitest run packages/core/tests/tailoring-completion.test.ts`; expect missing-module failure.
- [ ] Implement the complete pure decision below. Add Zod equivalents for persisted/request boundaries in this same file; reject extra keys and invalid revisions. Export both schemas and types from core.

```ts
export const DRAFT_FIRST_POLICY = 'draft-first-1' as const;
export const TAILORING_REVIEW_CONTRACT = 1;
export interface CompletionBinding {
  input_id: string; candidate: string; support: string;
  policy: typeof DRAFT_FIRST_POLICY; draft_revision: number;
}
export interface CompletionCheck {
  id: string; state: 'passed' | 'pending' | 'failed';
  recovery: 'automatic' | 'answer' | 'retry'; message: string;
}
export interface CompletionInput {
  binding: CompletionBinding;
  activity: 'idle' | 'queued' | 'running';
  required: CompletionCheck[];
  artifact?: { id: string; fingerprint: string; binding: CompletionBinding; passed: boolean };
  approved_fingerprint?: string;
}
export interface CompletionDecision {
  binding: CompletionBinding;
  state: 'preparing' | 'ready' | 'needs_answer' | 'needs_retry' | 'approved';
  action_id?: string; artifact_id?: string;
}
export function sameCompletionBinding(a: CompletionBinding, b: CompletionBinding): boolean {
  return a.input_id === b.input_id && a.candidate === b.candidate &&
    a.support === b.support && a.policy === b.policy && a.draft_revision === b.draft_revision;
}
export function decideCompletion(input: CompletionInput): CompletionDecision {
  const base = { binding: input.binding };
  if (input.activity !== 'idle') return { ...base, state: 'preparing' };
  const incomplete = input.required.filter(check => check.state !== 'passed');
  const action = incomplete.find(check => check.recovery === 'answer') ?? incomplete[0];
  if (action) return { ...base,
    state: action.recovery === 'answer' ? 'needs_answer' : 'needs_retry', action_id: action.id };
  const requiredIds = ['support', 'structure', 'privacy', 'layout', 'export'];
  if (requiredIds.some(id => !input.required.some(check => check.id === id && check.state === 'passed')))
    return { ...base, state: 'needs_retry', action_id: 'evaluate' };
  const artifact = input.artifact;
  if (!artifact?.passed || !sameCompletionBinding(artifact.binding, input.binding))
    return { ...base, state: 'needs_retry', action_id: 'render-current-draft' };
  return { ...base, artifact_id: artifact.id,
    state: input.approved_fingerprint === artifact.fingerprint ? 'approved' : 'ready' };
}
```

- [ ] Add `tailoring_policy: z.literal(DRAFT_FIRST_POLICY).optional()` to the preparation policy. Do not give the schema a default: old snapshots must remain distinguishable. Newly captured inputs opt in at Task 7; the live release gate remains Task 12. Keep `accomplishments-1` readable; add a predicate accepting either generation policy where the shared accomplishment UI/operations require it.
- [ ] Add cases for stale support, different draft revision, old approved PDF, failed export, real unanswered decision, and running/queued versus stopped work. Pause/stop belongs in the projection's suspension field; do not fabricate a running operation.
- [ ] Run the new test and `packages/core/tests/job-preparation.test.ts`. Commit explicit paths with `feat(core): define draft-first completion decisions`.

## Task 2: Persist baseline assertions and stable career identities

**Create:** `packages/core/src/corpus/career-identity.ts`, `packages/core/src/jobs/assertion-support.ts`, `packages/cli/src/jobs/tailoring-repository.ts`, `packages/cli/src/jobs/tailoring-support.ts`, and `packages/core/tests/career-identity.test.ts`, `packages/core/tests/assertion-support.test.ts`, `packages/cli/tests/tailoring-repository.test.ts`.
**Modify:** CLI `packages/cli/src/jobs/database.ts`, `packages/cli/src/jobs/artifacts.ts`, `packages/cli/src/corpus/repository.ts`, `packages/cli/src/corpus/service.ts`; core `packages/core/src/corpus/schemas.ts`, `packages/core/src/jobs/evidence-discovery.ts`, and `index.ts`.

- [ ] Define these records before writing capture code. IDs are server-issued; client/model output can reference them but cannot manufacture authoritative support.

```ts
export interface CareerIdentity {
  id: string;
  kind: 'employment' | 'work';
  parent_id: string | null;
  aliases: { input_id: string; path: string; text: string }[];
  employer: string;
  start_date: string;
}
export type AssertionBasis =
  | { kind: 'baseline'; input_id: string; path: string; exact_text: string }
  | { kind: 'human'; clarification_id: string; clarification_revision: number }
  | { kind: 'document'; evidence_id: string; evidence_fingerprint: string;
      field: 'title' | 'summary' | 'impact' | 'narrative'; start: number; end: number; quote: string };
export interface SupportedAssertion {
  id: string; work_id: string; predicate: string; qualifiers: string[];
  text: string; basis: AssertionBasis[];
}
export interface CheckedClaim {
  start: number; end: number; text: string;
  assertion_ids: string[];
  result: 'supported' | 'unsupported' | 'conflict' | 'unavailable';
}
export function coversWording(text: string, claims: CheckedClaim[]): boolean {
  const covered = new Set<number>();
  for (const claim of claims) {
    if (claim.result !== 'supported' || !claim.assertion_ids.length ||
        claim.start < 0 || claim.end <= claim.start || claim.end > text.length ||
        text.slice(claim.start, claim.end) !== claim.text) continue;
    for (let i = claim.start; i < claim.end; i++) covered.add(i);
  }
  // Offsets are UTF-16 offsets, as in the existing source-span protocol.
  for (let i = 0; i < text.length; i++) {
    const point = text.codePointAt(i)!;
    const char = String.fromCodePoint(point);
    if (/[\p{L}\p{N}]/u.test(char) && !covered.has(i)) return false;
    if (point > 0xffff) i++;
  }
  return text.trim().length > 0 && claims.length > 0;
}
```

- [ ] Add the first coverage test and run it before implementing the function:

```ts
it('does not let a supported title cover an added leadership claim', () => {
  const text = 'Senior Engineer who led the global migration';
  expect(coversWording(text, [{ start: 0, end: 15, text: 'Senior Engineer',
    assertion_ids: ['title'], result: 'supported' }])).toBe(false);
});
```

- [ ] Add Zod schemas for the records above. Add an internal `career_identity` corpus change variant; keep it out of `ClientCorpusChange` and `CorpusRequestSchema`. Use existing corpus revision, feedback, and transaction infrastructure. Update the corpus materializer to retain identity records as metadata; an identity record grants no skill, evidence, or factual support on its own. `CorpusService.prepare` must reject internal-only variants rather than trusting an actor string from a client.
- [ ] Implement identity rules in `career-identity.ts`: reuse a persisted explicit alias first; identify employment by an unambiguous normalized employer and start date; never use role or end date as identity. Multiple matching employment records remain ambiguous. Work identity follows an explicit source-bullet lineage or a previously recorded alias; employer and shared citations alone never merge separate projects. Ambiguous cross-job work remains job-local without prompting during ordinary preparation.
- [ ] Append migration 7 (migration 6 is current at planning time; reread before editing) for immutable snapshots:

```sql
CREATE TABLE tailoring_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id),
  kind TEXT NOT NULL CHECK(kind IN ('baseline','support','completion','suggestion')),
  binding_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(job_id,kind,binding_fingerprint)
);
CREATE TRIGGER tailoring_records_no_update BEFORE UPDATE ON tailoring_records
BEGIN SELECT RAISE(ABORT,'immutable tailoring record'); END;
CREATE TRIGGER tailoring_records_no_delete BEFORE DELETE ON tailoring_records
BEGIN SELECT RAISE(ABORT,'immutable tailoring record'); END;
```

- [ ] Implement `TailoringRepository` with `put(jobId, inputId, kind, bindingFingerprint, payload)` and `get(jobId, kind, bindingFingerprint)`. Reuse `JobsRepository.database`, validate schemas per kind, verify input/job/workspace lineage, reject conflicting content at an existing key, and return an identical existing record on retry. No write may occur in `get`.
- [ ] Capture baseline assertions only during an explicit new-policy input capture. Read the immutable captured resume bytes through `JobArtifactsService`; record exact profile title, summary, employment titles, bullets, skills, and education fields. A whole original passage can be retained as an exact assertion, but paraphrase reuse requires Task 3's checked mapping. Do not mark legacy content confirmed merely by opening a job.
- [ ] Test repeated capture, role/end-date edits, reordered bullets, repeated tenures, shared evidence across unrelated bullets, foreign input IDs, immutable records, and unchanged ledger bytes. Run `npx vitest run packages/core/tests/career-identity.test.ts packages/core/tests/assertion-support.test.ts packages/cli/tests/tailoring-repository.test.ts`. Commit `feat: capture user-supplied resume assertions with stable lineage`.

## Task 3: Check changed meaning instead of re-questioning the baseline

**Modify:** `packages/cli/src/jobs/tailoring-support.ts`, `packages/cli/src/jobs/semantic-service.ts`, `packages/cli/src/jobs/semantic-classifier.ts`, `packages/cli/src/jobs/semantic-evaluation.ts`; core `assertion-support.ts`, `packages/core/src/jobs/semantic-evidence.ts`, `packages/core/src/jobs/semantic-policy.ts`, `packages/core/src/jobs/semantic-transport.ts`; tests `packages/cli/tests/job-semantic-service.test.ts`, `packages/cli/tests/job-semantic-classifier.test.ts`, `packages/cli/tests/semantic-evaluation.test.ts`, new `packages/cli/tests/tailoring-support.test.ts`, and the existing `packages/cli/tests/fixtures/semantic-fixture.ts`.

- [ ] Add service tests before changing resolution: an exact baseline passage resolves with provenance `baseline` and no runner call; a faithful paraphrase can reference its original assertion; adding ownership, a number, a causal link, or another employer cannot inherit that result.

```ts
it('retains exact baseline wording without calling the classifier', async () => {
  const f = semanticFixture({ tailoringPolicy: 'draft-first-1' });
  try {
    const store = new TailoringRepository(f.jobs);
    const resolver = new TailoringSupportService(f.jobs, f.artifacts, store);
    resolver.captureBaseline(f.job.id, f.input.id);
    const result = resolver.exact(f.job.id, f.input.id, 'summary', f.candidate.summary!);
    expect(result?.basis[0].kind).toBe('baseline');
    expect(resolver.exact(f.job.id, f.input.id, 'summary',
      f.candidate.summary! + ' I owned the company-wide rollout.')).toBeNull();
  } finally { f.cleanup(); }
});
```

Extend `semanticFixture` with `options: { tailoringPolicy?: 'draft-first-1' } = {}` and add `...(options.tailoringPolicy ? { tailoring_policy: options.tailoringPolicy } : {})` to its captured policy. Existing callers remain legacy. Import `semanticFixture`, `TailoringRepository`, and `TailoringSupportService` from their mapped files in the new test. Baseline capture rejects an old-policy snapshot, so the positive test must explicitly opt in.

`captureBaseline(jobId, inputId)` and `exact(jobId, inputId, path, text)` are the public methods of the new `TailoringSupportService`. `exact` returns a matching persisted `SupportedAssertion` or `null`; it never does inference or writes. Inject the existing configured semantic classifier for the separate changed-meaning path, not into `exact`.

- [ ] Extend the classifier batch with opaque assertion references. Its new result uses `CheckedClaim` plus referenced assertion IDs and literal source spans. Add a constrained relation `equivalent | narrower | added | conflict` to the provider output. The server maps opaque references to persisted assertions and rejects unknown IDs, wrong work, invalid spans, missing qualifier coverage, or stale support. A model cannot emit `human` or `baseline` provenance.
- [ ] Split current passage processing into three concrete branches:

```ts
type PassageResolutionPlan =
  | { kind: 'retain'; assertion: SupportedAssertion }
  | { kind: 'check-change'; assertions: SupportedAssertion[] }
  | { kind: 'check-addition'; assertions: SupportedAssertion[] };
```

`retain` requires exact current text at its bound original target and no active correction conflict. `check-change` receives only original-target lineage plus relevant evidence and compatible confirmations. `check-addition` receives relevant sources without pretending the entire baseline supports it. Both checked branches require complete supported wording coverage before they become resolved. Cached decisions bind current candidate, sources, identities, and policy.

- [ ] Extend `JobFact.resolution.provenance` to include `baseline` and return the concrete basis references. In `SemanticService.read`, do not derive success solely from `facts.every(f => f.resolution)`: the persisted support report must cover all current factual wording. Retain observational reads.
- [ ] Version the new classifier contract and evaluation suite separately from the legacy `SEMANTIC_VERSION = '1'`. Dispatch the correct schema by captured policy. Add evaluation cases for retained metrics, paraphrases, title-to-leadership inflation, unsupported relationships in consolidations, matching words in a different employment, uncovered qualifiers, and Unicode offsets.
- [ ] Run the named tests. Expected: exact baseline no longer asks a question; unavailable classification of new meaning remains unavailable. Commit `feat: validate factual additions while preserving baseline support`.

## Task 4: Persist and reuse human confirmation without fake evidence

**Modify:** core `packages/core/src/jobs/semantic-evidence.ts`, `packages/core/src/jobs/semantic-transport.ts`, `packages/core/src/corpus/schemas.ts`, `packages/core/src/corpus/clarifications.ts`, `packages/core/src/corpus/knowledge.ts`; CLI `packages/cli/src/jobs/semantic-service.ts`, `packages/cli/src/jobs/semantic-repository.ts`, `packages/cli/src/jobs/clarification-updates.ts`, `packages/cli/src/corpus/repository.ts`, `packages/cli/src/corpus/service.ts`; UI `packages/ui/src/views/jobs/JobFacts.tsx` only for new confirmation/correction fields. Tests: `packages/cli/tests/shared-clarification-workflow.test.ts`, `packages/cli/tests/job-semantic-service.test.ts`, `packages/core/tests/semantic-evidence.test.ts`.

- [ ] Preserve the legacy source-required reader. Add a v2 clarification record with an explicit correction target, and a v2 shared-support record with at least one support basis. Do not simply remove `.min(1)` from legacy documentary sources.

```ts
type CorrectionTarget =
  | { kind: 'human-answer'; clarification_id: string; previous_assertion: string }
  | { kind: 'document'; evidence_id: string; evidence_fingerprint: string;
      previous_assertion: string; effective_date: string };
interface HumanSupportReference {
  kind: 'human'; clarification_id: string; clarification_revision: number;
}
```

For `human-answer`, validate the referenced earlier answer, same work/predicate/scope, and exact previous assertion; do not require a source ID or invented effective date. For `document`, retain existing source and valid-calendar-date checks. Represent promotion/changed period through distinct effective scope rather than overwriting a valid historical fact.

- [ ] Add the decisive transaction regression to the existing shared clarification fixture: explicitly confirm a formal title with `source_ids: []`, `supporting_quotes: []`, `reuse: 'project'`, and the current corpus revision; reread after reopening the database; verify a server-issued human reference exists and the ledger hash is unchanged. Follow the same saved title into a second input with changed summary wording and assert no question.

```ts
const requestFields = {
  assertion: 'Senior Engineer was my formal title at Acme.',
  confirmed: true,
  kind: 'confirmation' as const,
  source_ids: [],
  supporting_quotes: [],
  reuse: 'project' as const,
  supersedes: null,
};
```

Use the existing test's current target, claim IDs, fact, revisions, and idempotency key; `requestFields` does not replace those bindings.

- [ ] In `SemanticService.clarify`, validate the request against the current claim, mint provenance server-side, and save local clarification plus shared corpus revision in one existing SQLite transaction. The generic corpus endpoint continues to reject human-provenance creation. A shared-save failure cannot report local success.
- [ ] Update `reusableClarifications` to accept active human references after dereferencing the recorded answer and identity. Keep documentary fingerprint checks for documentary bases. Conflicting values for the same predicate/scope require explicit correction; a different library contribution must not supersede a job title.
- [ ] Update affected-draft detection to follow identity/reference lineage, not just old exact text. Preserve `Update selected`, revision checks, selective rewrite, undo, and historical artifact conflicts. Unconfirmed or job-only answers never become shared support.
- [ ] Run the three named suites. Add tests for generic endpoint forgery, ambiguous identity, wrong employer, unsupported qualifiers, correction chains, withdrawal, and duplicate retry. Commit `feat: support reusable human confirmations without ledger quotations`.

## Task 5: Make all factual validators consume the same support result

**Modify:** core `packages/core/src/tailoring/validators.ts`, `jobs/preparation.ts`, `packages/core/src/jobs/candidate-checks.ts`, `packages/core/src/jobs/proposal-review.ts`, `packages/core/src/jobs/semantic-policy.ts`; CLI `packages/cli/src/jobs/proposal-service.ts`, `packages/cli/src/jobs/draft-finalization.ts`; tests `packages/core/tests/job-preparation.test.ts`, `packages/core/tests/job-proposal-review.test.ts`, `packages/cli/tests/job-proposal-service.test.ts`, `packages/ui/tests/job-draft-checks.test.tsx`.

- [ ] Add a core regression with a fully supported generated passage and a legacy claim-binding gap: the result must request internal re-binding/repair, not a new human answer. Add another with only the title span supported: the added leadership claim must still block.
- [ ] Use one new-policy `AssertionSupportReport` at every call site. Define it in `assertion-support.ts`:

```ts
export interface AssertionSupportReport {
  candidate_fingerprint: string;
  policy: 'draft-first-1';
  passages: {
    path: string; proposal_id?: string; text: string;
    claims: CheckedClaim[]; complete: boolean;
  }[];
  assertion_ids: string[];
}
export function supportedPassage(report: AssertionSupportReport, path: string, text: string): boolean {
  const passage = report.passages.find(p => p.path === path && p.text === text);
  return !!passage?.complete && coversWording(text, passage.claims);
}
```

- [ ] Add optional `assertionSupport` to `ProposalValidationContext`. Under the new captured policy, resolve each factual check against exact spans/bases instead of separately requiring ledger words or verified metric strings. Map proposal targets and candidate paths through the existing operation lineage. Retain original validation for legacy contexts without the new report.
- [ ] Preserve checks for actual missing/retracted citation references, placeholders, required fields, duplicate content, privacy, schema validity, and artifact verification. Never solve duplicate blockers with a broad filter that discards `claim_binding`, `metric_unverified`, or `unsupported_experience` regardless of coverage.
- [ ] Treat support-mapping defects as internally repairable. `ProposalService.evaluate` and `JobDraftFinalization.check` use the same report and completion classification. They cannot each create a second factual approval gate.
- [ ] Run the named suites plus `packages/core/tests/accomplishment-synthesis.test.ts`. Commit `fix: unify factual support across resume validators`.

## Task 6: Add bounded semantic repair and deterministic fallback

**Create:** `packages/cli/src/jobs/tailoring-repair.ts`, `packages/core/src/jobs/tailoring-fallback.ts`, `packages/core/tests/tailoring-fallback.test.ts`, `packages/cli/tests/tailoring-repair.test.ts`.
**Modify:** `packages/cli/src/jobs/automatic-repair.ts`, `packages/cli/src/jobs/proposal-service.ts`; core `packages/core/src/jobs/synthesis.ts`, `packages/core/src/jobs/proposal-review.ts`, `packages/core/src/tailoring/schemas.ts`, and `index.ts`.

- [ ] Add a pure fallback test that rejects only a generated rewrite and leaves its original accomplishment in the candidate. Include additions and consolidations, and protect explicit user edits.

```ts
import { expect, it } from 'vitest';
import { fallbackPatch } from '../src/jobs/tailoring-fallback.js';
import { ProposalSchema } from '../src/tailoring/schemas.js';
it('reverts unsupported generated wording but protects explicit user edits', () => {
  const proposal = ProposalSchema.parse({ id: 'p', type: 'bullet.rewrite',
    target: { experience_index: 0, bullet_index: 0 },
    before: 'Built APIs.', after: 'Owned the global API platform.', citations: [] });
  expect(fallbackPatch(proposal, false, true)).toEqual({ proposal_id: 'p', decision: 'rejected' });
  expect(fallbackPatch(proposal, true, true)).toBeNull();
  expect(fallbackPatch(proposal, false, false)).toBeNull();
});
```

- [ ] Run the new core test; implement the complete fallback function:

```ts
import type { Proposal } from '../tailoring/schemas.js';
import type { ProposalPatch } from './proposal-review.js';
export function fallbackPatch(proposal: Proposal, userEdited: boolean,
  originalSupported: boolean): ProposalPatch | null {
  if (userEdited || proposal.decision === 'rejected') return null;
  if (proposal.type === 'bullet.add') return { proposal_id: proposal.id, decision: 'rejected' };
  if (originalSupported && ['summary.rewrite', 'bullet.rewrite', 'bullet.consolidate'].includes(proposal.type))
    return { proposal_id: proposal.id, decision: 'rejected' };
  return null;
}
```

- [ ] Implement the repair coordinator in the new CLI file with this ordered procedure, keeping the existing `repairAutomaticReview` callable for legacy generations:

```ts
import { fallbackPatch, type Proposal, type ProposalPatch } from '@featherduster/core';
type NarrowResult =
  | { state: 'supported'; text: string; support_fingerprint: string }
  | { state: 'unsupported' | 'unavailable' | 'budget_exhausted' };
interface RepairOperations {
  guard(): void;
  narrowAndValidate(proposal: Proposal): Promise<NarrowResult>;
  saveNarrow(proposal: Proposal, text: string, supportFingerprint: string): Promise<void>;
  saveFallback(patch: ProposalPatch): Promise<void>;
}
export async function repairOne(proposal: Proposal, userEdited: boolean,
  originalSupported: boolean, operations: RepairOperations):
  Promise<'changed' | 'decision' | 'retry'> {
  operations.guard();
  if (userEdited) return 'decision';
  const narrower = await operations.narrowAndValidate(proposal);
  operations.guard();
  if (narrower.state === 'supported') {
    await operations.saveNarrow(proposal, narrower.text, narrower.support_fingerprint);
    return 'changed';
  }
  const fallback = fallbackPatch(proposal, false, originalSupported);
  if (fallback) {
    await operations.saveFallback(fallback);
    return 'changed';
  }
  return narrower.state === 'unsupported' ? 'decision' : 'retry';
}
```

`narrowAndValidate` first reserves the operation, then calls the configured runner and the support resolver; its `supported` result is server-validated, never copied from a model's assertion. `saveNarrow` and `saveFallback` call revision-bound proposal writes with before/after records. The caller persists a specific decision/retry for those outcomes and rechecks the affected candidate once. Iterate only current unsupported generated passages; skip excluded targets and already supported passages. If no repair budget remains, return `budget_exhausted` without dispatching, so the function can still use a validated original fallback.

Make each runner call use `PreparationBatchRepository.reserve(member, operationKey, 'repair')` plus existing model-call accounting. The attempt key includes input, candidate, affected targets, and proposed repair fingerprint. A repeated equivalent candidate does not get another repair attempt. A technical checker failure is not an `unsupported` result.

- [ ] Persist user edit provenance with the job overlay instead of inferring it from `edited_after`: system repairs also use that field. New metadata is server-issued (`actor: 'user' | 'worker'`, original targets, input ID, previous/current wording). Legacy ambiguous edits are protected conservatively. Existing human omissions remain excluded before asking the generator or repair model to write anything.
- [ ] Use a strict repair response containing target ID, narrower text, and assertion references. Do not let the repair response create a human confirmation, new job/experience, or approval. Rebinding source claims is automatic server work. Optional enrichment prompts are recorded separately in Task 9.
- [ ] Test narrowed ownership, unsupported metric removal, whole-addition omission, consolidation fallback, budget exhaustion with safe original fallback, actual contradiction, unavailable checker, stale result, repeat repair, and user-protected wording. Run `npx vitest run packages/core/tests/tailoring-fallback.test.ts packages/cli/tests/tailoring-repair.test.ts packages/cli/tests/automatic-repair.test.ts packages/core/tests/review-omissions.test.ts`. Commit `feat: repair or revert unsupported generated resume wording`.

## Task 7: Make backend preparation own progression through the PDF

**Modify:** CLI `jobs/preparation.ts`, `packages/cli/src/jobs/preparation-coordinator.ts`, `packages/cli/src/jobs/preparation-batch-repository.ts`, `packages/cli/src/jobs/proposal-service.ts`, `packages/cli/src/jobs/draft-finalization.ts`, `packages/cli/src/jobs/runtime.ts`, `packages/cli/src/jobs/artifacts.ts`; core `packages/core/src/jobs/synthesis.ts`, `schemas.ts`, `packages/core/src/jobs/automatic-preparation.ts`; tests `draft-first-preparation.test.ts`, `automatic-preparation.test.ts`, `packages/cli/tests/automatic-resume-http.test.ts`, `packages/cli/tests/job-artifacts.test.ts`.

- [ ] Run Task 0's failing test again. Add a test that all fact results can resolve while a generated claim-binding defect is automatically repaired/reverted and the PDF still completes. No test may call `refreshFacts`, `recheck`, `continue`, or `finalize` manually to make the normal workflow pass.
- [ ] During explicit fresh input capture, assign `tailoring_policy: 'draft-first-1'` and emit the matching generation policy. Preserve old snapshots and legacy generations. This is the backend activation point; the new UI is integrated in Task 10. Existing legacy fixtures that test old-policy behavior must capture old-policy inputs explicitly.
- [ ] Replace the new-policy branch that throws `PreparationBlocked('Resolve saved proposal or candidate issues', ...)` immediately after semantic checking with Task 6's repair/fallback operation. Feed its persisted results into `decideCompletion`. Continue to layout/render/export automatically when content checks pass; only essential decisions or technical failure stop the coordinator.
- [ ] Extend `TailoringRepository.put` completion payloads with the exact binding and recorded time. Write the support/completion snapshot in the same transition as the corresponding review/draft revision. Use a unique fingerprint for each full result, including activity, checks, and artifact; do not reuse only the candidate fingerprint for several different completion states.
- [ ] Include the captured tailoring policy, classifier schema/evaluation version, generation policy, and support fingerprint in the relevant stage/cache keys. A legacy checkpoint cannot satisfy a new-policy stage solely because its text is equal.
- [ ] After publishing the verified PDF, persist a passed export check and artifact binding. On read, only select a completion snapshot whose input, candidate, support, policy, and draft revision are still current. Old snapshots remain historical. A fresh support correction makes the previous artifact non-current for approval.
- [ ] Make `PreparationCoordinator.tick` use completion decisions for new-policy jobs rather than guessing whether all `needs_input` cases are questions. Keep stop/pause/archive/ownership fences around every asynchronous phase. A pending repair remains Preparing; an exhausted repair with a safe fallback completes; a failed required operation becomes Needs retry.
- [ ] Coalesce successive autosaved revisions in the same existing cycle. Remove the unconditional new-cycle creation in the new-policy `edited` branch. Budget renewal occurs only through the existing explicit retry/new preparation action, with the configured cap visible in Details. Restart/reload never renews a budget.
- [ ] Test crash after dispatch receipt, crash after result persistence, stopped process, explicit retry, two quick revisions, exhausted model budget, renderer failure, and final approval remaining absent. Run the four named suites. Task 0 must now pass. Commit `feat: complete draft-first preparation without manual check steps`.

## Task 8: Serialize automatic saves and preserve browser recovery

**Create:** `packages/ui/src/views/jobs/draft-autosave.ts`, `packages/ui/src/hooks/useJobDraftAutosave.ts`, `packages/ui/tests/draft-autosave.test.ts`.
**Modify:** UI `packages/ui/src/api/client.ts`, `packages/ui/src/views/jobs/JobProposalReview.tsx`, `packages/ui/src/views/jobs/JobProposalEditor.tsx`, `packages/ui/src/views/jobs/JobStartingResumeCorrection.tsx`, artifact draft editor; CLI `packages/cli/src/jobs/routes.ts`, `repository.ts`, and `packages/cli/src/jobs/proposal-service.ts` for idempotent writes/protected-user edits.

- [ ] Add the writer below after a regression asserting that a second edit made during the first request is not lost. The core writer has no React, DOM, timer, or API dependency.

```ts
export interface SaveItem<T> { key: string; value: T }
export interface SaveState<T> {
  revision: number; active?: SaveItem<T>; latest?: SaveItem<T>;
}
export class DraftAutosave<T> {
  private running?: Promise<void>;
  constructor(public state: SaveState<T>,
    private persist: (state: SaveState<T>) => void,
    private send: (item: SaveItem<T>, revision: number) => Promise<number>) {}
  edit(value: T, key: string) {
    this.state = { ...this.state, latest: { value: structuredClone(value), key } };
    this.persist(this.state);
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    const run = async () => {
      while (this.state.active || this.state.latest) {
        if (!this.state.active) {
          this.state = { ...this.state, active: this.state.latest, latest: undefined };
          this.persist(this.state);
        }
        const active = this.state.active!;
        // A failed request leaves active and its original key intact for retry/recovery.
        const revision = await this.send(active, this.state.revision);
        this.state = { ...this.state, revision, active: undefined };
        this.persist(this.state);
      }
    };
    this.running = run().finally(() => { this.running = undefined; });
    return this.running;
  }
}
```

```ts
import { expect, it, vi } from 'vitest';
import { DraftAutosave } from '../src/views/jobs/draft-autosave.js';
it('saves the latest text using the revision acknowledged by the older write', async () => {
  let finish!: (revision: number) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<number>(r => { finish = r; }))
    .mockResolvedValueOnce(3);
  const saved: unknown[] = [];
  const queue = new DraftAutosave<string>({ revision: 1 }, state => saved.push(structuredClone(state)), send);
  queue.edit('first', 'one');
  const flushing = queue.flush();
  queue.edit('newer', 'two');
  finish(2);
  await flushing;
  expect(send.mock.calls).toEqual([
    [{ key: 'one', value: 'first' }, 1], [{ key: 'two', value: 'newer' }, 2],
  ]);
  expect(queue.state).toEqual({ revision: 3, active: undefined, latest: undefined });
});
```

- [ ] Run `npx vitest run packages/ui/tests/draft-autosave.test.ts`. Add tests for failure retaining both active/latest, retry using the same key, restored in-flight state, revision conflict retaining text, and no overlapping sends.
- [ ] Implement the hook with a 600 ms quiet-period debounce, a per-window queue registry keyed by job/input/draft identity, and subscriber notifications. Unmount only detaches the subscriber: an active acknowledged write must still update durable recovery state. Multiple tabs rely on server revision conflicts, not last-write-wins. Store input ID, policy/contract, draft/review ID, base revision, active request, and latest value in local recovery storage. Validate recovered data before using it.
- [ ] Adapt proposal and starting-resume edits to their existing endpoints and response bindings. Add an optional `idempotency_key` to the existing job-draft PUT route and API method; old clients without it retain legacy behavior, while new-policy saves require it. Wrap new writes in `JobsRepository.withReceipt`. Do not bypass current expected revisions or original-target checks.
- [ ] On a timed-out write, query/replay the same mutation receipt before issuing a different request. A changed payload gets a new key; a retry of the same active request retains its key. A stale revision error pauses the queue and displays current versus local wording for reconciliation. Do not auto-rebase by dropping newer text or resubmitting against a guessed revision.
- [ ] Apply the hook to wording/citation/exclusion editing, not to the explicit `confirmed` action. Typed factual answers can be retained locally or saved as unconfirmed, but cannot become confirmed or project-shared on a debounce.
- [ ] Disable current-version approval while active/latest local edits exist. Display only a small Saving/Saved state and one actionable save failure. Run existing `job-proposal-review`, `job-starting-resume-correction`, `job-draft-navigation`, and `job-draft-actions` UI suites plus the new writer suite. Commit `feat(ui): autosave resume edits without losing newer changes`.

## Task 9: Add nonblocking improvement suggestions and a review projection

**Create:** `packages/core/src/jobs/tailoring-review.ts`, `packages/cli/src/jobs/tailoring-review.ts`, `packages/cli/tests/tailoring-review.test.ts`.
**Modify:** core `index.ts`; CLI `packages/cli/src/jobs/runtime.ts`, `routes.ts`, `tailoring-repository.ts`, `packages/cli/src/jobs/preparation-questions.ts`; UI `packages/ui/src/api/client.ts`.

- [ ] Define the projection contract below using the already defined completion types; add strict Zod schemas at the HTTP boundary. Include a small example test where an unanswered suggestion coexists with Ready to review.

```ts
import type { CompletionDecision } from './tailoring-completion.js';
export interface ImprovementSuggestion {
  id: string; work_id: string; predicate: string; qualifiers: string[];
  question: string; benefit: string;
  disposition: 'available' | 'dismissed' | 'answered';
}
export interface TailoringReview {
  contract_version: 1;
  policy: 'draft-first-1' | 'legacy';
  completion: CompletionDecision | null;
  suspension: 'paused' | 'stopped' | null;
  artifact: { id: string; fingerprint: string; current: boolean } | null;
  changes: { id: string; before: string; after: string; reason: string;
    kind: 'rewrite' | 'addition' | 'omission' | 'consolidation' }[];
  improvements: ImprovementSuggestion[];
  required_action: { id: string; kind: 'answer' | 'edit' | 'retry' | 'replace-content';
    message: string; target_path?: string } | null;
}
export function visibleImprovements(items: ImprovementSuggestion[], omittedWorkIds: Set<string>) {
  return items.filter(item => item.disposition === 'available' && !omittedWorkIds.has(item.work_id));
}
```

- [ ] Persist suggestion dispositions as immutable `suggestion` records using job/work/fact identity and content fingerprint. The latest compatible disposition controls display. Dismissal is job-local. Answered suggestions reuse the explicit clarification transaction. Different wording of the same already-answered question must not create a new active suggestion.
- [ ] Initially populate suggestions from useful unresolved enrichment discovered during generation/repair. Additional model generation is optional, uses the same captured budget, and never blocks readiness. If there is no remaining budget or generation fails, return no extra suggestions without changing completion. Optional suggestion work must not set the main completion activity to running or disable approval of the supported current PDF.
- [ ] Add `GET /api/jobs/:id/tailoring-review` as an observational projection over current records. Add `PUT /api/jobs/:id/tailoring-improvements/:suggestionId` for disposition with expected job revision, input ID, and idempotency key. Use the existing fact clarification endpoint for actual answers; do not create a second confirmation system.
- [ ] The projection emits one required action from the persisted completion decision. It never emits an unanswered-fact list as the main experience. Protect the legacy projection: old jobs remain readable and offer explicit preparation under the new policy without generating on GET.
- [ ] Test no model call on GET, suggestion failure leaving readiness intact, dismissal persistence, answered prompt deduplication, omission suppressing suggestions, stale disposition rejection, and corrected facts flagging artifacts. Run `npx vitest run packages/cli/tests/tailoring-review.test.ts packages/cli/tests/preparation-questions.test.ts`. Commit `feat: project a finished resume with optional improvements`.

## Task 10: Replace the normal review path with one PDF-centered surface

**Create:** `packages/ui/src/views/jobs/JobTailoringReview.tsx`, `packages/ui/tests/job-tailoring-review.test.tsx`.
**Modify:** `packages/ui/src/views/jobs/JobDetail.tsx`, `packages/ui/src/views/jobs/JobResumeReview.tsx`, `packages/ui/src/views/jobs/JobProposalReview.tsx`, `packages/ui/src/views/jobs/JobFacts.tsx`, `packages/ui/src/views/jobs/JobArtifactChanges.tsx`, `packages/ui/src/views/jobs/JobsView.tsx`, API client and relevant tests.

- [ ] Write the UI regression around the projection instead of mocking several independent status systems. The ready fixture includes an available optional question; there must still be exactly one primary Approve resume action and no required factual form or check button.

```ts
it('keeps optional questions outside the primary approval flow', async () => {
  const view = readyTailoringReview();
  view.improvements = [{ id: 'scope', work_id: 'api', predicate: 'rollout-scope',
    qualifiers: [], question: 'How many teams used these APIs?',
    benefit: 'A rollout scope could strengthen this accomplishment.', disposition: 'available' }];
  render(<JobTailoringReview view={view} actions={reviewActions()} preview={<div aria-label="Resume PDF" />} />);
  expect(screen.getByRole('button', { name: 'Approve resume' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Check evidence' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  expect(screen.getByText('Improve this version').closest('details')).not.toHaveAttribute('open');
});
```

Define the test helpers in that file; import `TailoringReview` from core, `vi` from Vitest, and render/screen from Testing Library:

```ts
function readyTailoringReview(): TailoringReview {
  return {
    contract_version: 1, policy: 'draft-first-1', suspension: null,
    completion: { state: 'ready', artifact_id: 'pdf', binding: {
      input_id: 'input', candidate: 'candidate', support: 'support',
      policy: 'draft-first-1', draft_revision: 1,
    } },
    artifact: { id: 'pdf', fingerprint: 'pdf-fingerprint', current: true },
    changes: [], improvements: [], required_action: null,
  };
}
function reviewActions() {
  return { approve: vi.fn(), retry: vi.fn(), resume: vi.fn(), edit: vi.fn(), answer: vi.fn() };
}
```

The callbacks are passed by `JobResumeReview` using existing API/editor actions. The new component does not dispatch preparation on mount.

- [ ] Implement `JobTailoringReview` as a controlled component receiving `view: TailoringReview`, `preview: ReactNode`, and the five callbacks above in an `actions` object. It renders the supplied current-artifact preview; extracts that preview from `JobResumeReview` if necessary without duplicating its loaded/error/current-artifact checks. Use this exact state copy and primary action map:

```ts
export const tailoringStateCopy = {
  preparing: { title: 'Preparing your resume', action: null },
  ready: { title: 'Your tailored resume is ready', action: 'Approve resume' },
  needs_answer: { title: 'One detail needs your input', action: 'Resolve this detail' },
  needs_retry: { title: 'Preparation needs another try', action: 'Retry preparation' },
  approved: { title: 'Resume approved', action: null },
} as const;
```

Paused/stopped projection overrides the main preparation action with Resume preparation. Before any new-policy preparation, show Tailor resume consistently. For a content-fit or required-input decision, render the specific action label from its payload instead of misleadingly showing a factual confirmation.

- [ ] Keep the brief meaningful change summary visible. Put detailed Changes, Evidence, editing, and Improve this version behind secondary controls. Completed factual questions remain collapsed history. Remove the normal-flow exception sidebar, separate fact progress bars, and manual check/continue buttons; keep diagnostics under Details for troubleshooting.
- [ ] In `JobDetail` and the resume route, select this surface for new-policy inputs. Old saved jobs use a read-only legacy-compatible projection until explicitly updated. Remove new-policy progression from `autoChecked`/`autoContinued`; backend progression must work when the browser is closed.
- [ ] Wire wording editors to Task 8. A previous PDF remains visible with “Earlier version — updating your PDF” while current content is preparing; it cannot be approved as the new content. Failure retains the editor and prior PDF, with one recovery action.
- [ ] Test all five main states, initial state, pause/stop, save failure, optional question dismissal, keyboard focus, no horizontal overflow at 390 px, and late artifact response. Run `npx vitest run packages/ui/tests/job-tailoring-review.test.tsx packages/ui/tests/job-resume-details.test.tsx packages/ui/tests/jobs-ui.test.tsx packages/ui/tests/job-facts.test.tsx`. Commit `feat(ui): make the tailored PDF the primary review experience`.

## Task 11: Preserve exclusions, restoration, and artifact approval

**Modify:** core `packages/core/src/jobs/restoration.ts`, `packages/core/src/jobs/proposal-review.ts`, `packages/core/src/jobs/selective-corrections.ts`, `schemas.ts`; CLI `packages/cli/src/jobs/artifacts.ts`, `packages/cli/src/jobs/draft-finalization.ts`, `packages/cli/src/jobs/exports.ts`, `packages/cli/src/jobs/clarification-updates.ts`, `routes.ts`; UI `packages/ui/src/api/client.ts`, `packages/ui/src/views/jobs/JobResumeReview.tsx`, `packages/ui/src/views/jobs/JobArtifactChanges.tsx`, `packages/ui/src/views/jobs/SharedFactUpdates.tsx`; tests `packages/core/tests/review-omissions.test.ts`, `packages/cli/tests/job-artifacts.test.ts`, `packages/cli/tests/shared-clarification-workflow.test.ts`, `packages/ui/tests/job-draft-actions.test.tsx`.

- [ ] Extend omission persistence from revision-bound operation IDs to a durable job exclusion intent containing original work/assertion IDs and scope. Keep the existing `ProposalPatch.omission` target validation and atomic expansion. Before regeneration, rebind the intent to current compatible original targets; ambiguous mappings need a focused decision, never silent reinsertion.
- [ ] Add a regression: omit a generated consolidation, regenerate for the same posting, reopen the job, and verify neither the consolidation nor its source bullets return. Restoring reverses the whole intent and preserves an unrelated manual edit.
- [ ] Reuse `tightenResumeWording` and the existing layout renderer before offering replacement. Revalidate supported wording after tightening. If still over budget, return a `replace-content` required action with concrete candidate accomplishments, their text, and the impact on inclusion. Do not auto-select a unique accomplishment to delete during restoration.
- [ ] Gate `approveResume` server-side on the current completion and artifact binding, in addition to existing export checks. The approval request binds input, draft, support, policy, artifact fingerprint, and change-summary fingerprint. Add optional `completion_binding` and `change_summary_fingerprint` fields to the request/record schemas and API client; require and validate them for new-policy artifacts. Compare active support/correction references at approval time without running models. Legacy approvals remain historical and readable.
- [ ] Add the binding regression below and the real approval-route test described immediately afterward:

```ts
it('does not reuse approval after the draft revision changes', () => {
  const old = { input_id: 'input', candidate: 'old', support: 'support',
    policy: 'draft-first-1' as const, draft_revision: 1 };
  const current = { ...old, candidate: 'edited', draft_revision: 2 };
  const required = ['support', 'structure', 'privacy', 'layout', 'export'].map(id =>
    ({ id, state: 'passed' as const, recovery: 'automatic' as const, message: 'Passed' }));
  const result = decideCompletion({ binding: current, activity: 'idle', required,
    artifact: { id: 'old-pdf', fingerprint: 'pdf', binding: old, passed: true },
    approved_fingerprint: 'pdf' });
  expect(result.state).toBe('needs_retry');
  expect(result.artifact_id).toBeUndefined();
});
```

Add this pure regression to `packages/cli/tests/tailoring-completion.test.ts`. Also exercise the real approval route with the disposable automatic-preparation fixture: publish a new-policy PDF, capture its approval request, save a changed draft, send that old request, and assert a revision/current-artifact rejection and no additional `resume_review` event. Then regenerate and approve the new artifact in the disposable fixture. Repeat with a corrected support fact. Keep all legacy artifact-history tests; do not weaken immutable artifact/export checks.

- [ ] Verify affected-draft updates and undo change only referenced claims. Keep historical approved PDFs and flag known conflict on reuse. Run the four named suites and `packages/core/tests/accomplishment-synthesis.test.ts`. Commit `fix: preserve user exclusions and exact PDF approval bindings`.

## Task 12: Version negotiation, saved-job transition, and acceptance delivery

**Modify:** CLI `packages/cli/src/jobs/routes.ts`, `packages/cli/src/jobs/runtime.ts`, core review transport, UI API client; `docs/accomplishment-review-walkthrough.md`.
**Create:** `packages/cli/tests/tailoring-compatibility.test.ts`, `scripts/verify-draft-first-tailoring.mjs`.

- [ ] Add an observational `GET /api/jobs/capabilities` before any parameterized job-ID route. It returns the contract and supported policies:

```ts
const capabilities = {
  tailoring_review_contract: 1,
  preparation_policies: ['accomplishments-1', 'draft-first-1'],
  draft_autosave: true,
  user_omissions: true,
} as const;
```

The UI checks this before new writes. A missing/older contract retains edits and shows “The running app needs an update before these changes can be saved.” Generic errors still expose a safe actionable message, with machine details kept under diagnostics. The server validates every request independently; capability discovery is not authorization.

- [ ] Test new UI/old server, old UI/new server, missing capabilities, malformed payload, and stale revision. Use a nonexistent job UUID for live compatibility probes so no real job can be mutated.
- [ ] Add explicit saved-job transition: prepare a new policy-bound revision from the old captured resume and job overlays, carrying compatible answers, user exclusions, and protected edits. Do not migrate by replaying a GET, rewriting historical JSON, or automatically generating on open. Show any unmappable user intent as a targeted decision.
- [ ] Build `scripts/verify-draft-first-tailoring.mjs` from the disposable workspace/server and browser setup in `scripts/verify-accomplishment-review.mjs`. Use a fresh output folder. Remove the old mandatory question/save/check steps from the happy path and require these assertions:

```ts
await page.getByRole('button', { name: 'Tailor resume', exact: true }).click();
await expect(page.getByRole('button', { name: 'Approve resume', exact: true }))
  .toBeEnabled({ timeout: 60000 });
await expect(page.getByLabel('Your factual answer')).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Check evidence', exact: true })).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Continue preparation', exact: true })).toHaveCount(0);
```

In the fixture, require at least one supported job-relevant rewrite or addition and preserve an existing metric/title without a ledger entry. A fixture that emits zero proposals is only the Task 0 baseline test; it does not prove tailoring quality. Generate and inspect a real PDF with the existing renderer, even though the model fixture is deterministic.

- [ ] Add browser branches for optional enrichment skipped and answered, essential conflict, technical retry, autosave during navigation, omitted content after regeneration, overflow replacement, and stale approval. Assert one primary action at each stage, no repeated confirmed question, and desktop/mobile accessibility. Save screenshots, assertions, candidate text, changes, budget usage, and PDF export reports under `walkthrough-output/draft-first/`.
- [ ] Run focused integration tests, then `npm run build`, then `npm test` once, then the browser acceptance script. Record failures accurately and isolate them before rerunning. Existing tests that enforce re-verification of unchanged resume assertions must be explicitly scoped to the legacy policy, not deleted. Keep adversarial new-claim tests under the new policy.
- [ ] For the real-evidence quality review, reuse the accepted Tailscale and connector workflow calibration. Read the configured runner and consent; preserve captured budgets. Run against a disposable copy of relevant inputs unless the user explicitly starts preparation in the live app. Assess coherent accomplishments, relevance, technical specificity, truthful terminology, and readable page fit; do not report a predictive ATS score or approve the PDF.
- [ ] Verify live deployment coherency: current UI asset bundle and current backend capabilities must match. Inspect active/queued work before restarting a local host; preserve user browser recovery. A successful build alone is not proof that the user is running the new backend.
- [ ] Update the walkthrough to the short default path and optional branches. Include exact recovery instructions and remove obsolete mandatory fact-review steps for the new policy. Commit explicit files with `test: verify draft-first tailoring and compatible saved-job recovery`.

## Definition of done and spec coverage

| Approved requirement | Tasks and evidence |
| --- | --- |
| Starting resume and confirmations are supplied facts | 2–5; baseline, paraphrase, metric, title, and adversarial support tests |
| One completion status and one action | 1, 7, 9–10; persisted state tests and browser primary-action assertions |
| Supported draft before optional questions | 6–7, 9, 12; no-interview baseline plus nontrivial tailored PDF |
| Human answers without ledger quotations and compatible reuse | 2–4; transaction, identity, conflict, and cross-job tests |
| Saving without manual stage progression | 7–8, 10; no Save/check/continue controls, late-response and reload tests |
| Protect edits, omissions, and meaningful technical content | 6, 8, 11–12; protected-edit, consolidation, regenerate, and quality review |
| Optional improvement questions never block approval | 9–10, 12; skipped, dismissed, failed-generation, and answered cases |
| Bounded automatic repair and technical recovery | 6–7, 12; dispatch receipts, stop, retries, crash, and budget tests |
| Overflow recovery and truthful output | 5, 11–12; replacements, PDF extraction/page count, factual-support tests |
| Exact artifact approval, separate download/application tracking | 1, 10–12; stale approval rejected and historical artifact retained |
| Legacy compatibility and version mismatches | 1, 7, 12; explicit transition and old/new contract matrix |
| Selective corrections and style/fact separation | 4, 11; affected-draft tests and no preference-to-support conversion |

Completion requires the supported happy path to reach a current verified PDF without mandatory factual questions or manual save/check/continue actions. Optional enhancements and final artifact approval are user decisions. Never make the acceptance test pass by suppressing real contradictions, fabricating support, dropping essential content, weakening export checks, or raising budgets.

## Handoff

The written design is approved. The implementation plan is ready for execution after choosing inline execution or the skill's per-task subagent workflow. Application implementation has not been performed while writing this plan.
