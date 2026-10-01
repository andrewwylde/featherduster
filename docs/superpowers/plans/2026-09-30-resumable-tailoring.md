# Resumable Tailoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every Tailoring draft from its first edit, make save status truthful, restore specific work after refresh, and support explicit upstream sync and immutable completed results.

**Architecture:** Add a versioned workspace draft repository and browser recovery coordinator separate from the existing workflow artifact store. Make editors controlled by the coordinator; use revision checks for writes and explicit commands for applying, syncing, completing, and continuing work. Reuse existing model execution, validation, privacy rules, and UI patterns.

**Tech Stack:** TypeScript, Zod, Node filesystem, Hono, React 18, browser localStorage/BroadcastChannel, Vitest, Testing Library, and the existing Playwright walkthrough harness. No new runtime dependency is required.

---

## Approved source and execution boundaries

Read `docs/superpowers/specs/2026-09-30-resumable-tailoring-design.md` first. This plan covers one feature in dependent slices; storage, editor recovery, and workflow integration are not independently shippable substitutes for the complete experience.

Planning changed documentation only. Execution progress and validation are recorded under each task below. The seven pre-existing modified application/test files must remain intact: `packages/cli/tests/tailoring.test.ts`, `packages/core/src/tailoring/schemas.ts`, `packages/core/src/tailoring/validators.ts`, `packages/core/tests/tailoring.test.ts`, `packages/ui/src/views/tailoring/TailoringRun.tsx`, `packages/ui/src/views/tailoring/steps/ProposalsStep.tsx`, and `packages/ui/tests/tailoring-ui.test.tsx`. Inspect their latest diffs before execution; they include candidate overrides and proposal behavior that this work must preserve. Do not reset, stash, or commit someone else's changes incidentally.

Use targeted commits. The commit steps below name the intended changes, not permission to stage whole pre-existing dirty files. Stage only feature hunks in those files. If execution starts in a worktree, ensure the approved current changes are present before editing dependent code.

Run commands from the repository root in PowerShell unless a command explicitly changes directory. Core exports resolve through `dist`, so build core before CLI/UI tests whenever shared contracts change. Test files use existing Vitest defaults; UI tests requiring DOM behavior begin with `/** @vitest-environment jsdom */`.

## File ownership and boundaries

| Create or modify | Responsibility |
|---|---|
| Create `packages/core/src/tailoring/drafts.ts` | Recovery types and Zod schemas; no filesystem or React imports |
| Create `packages/core/src/tailoring/draft-state.ts` | Pure content/context transitions, canonical comparison, hydration decisions |
| Create `packages/core/src/tailoring/resume-merge.ts` | Three-way resume merge, conflict descriptions, proposal target mapping |
| Modify `packages/core/src/index.ts` | Export the new shared contracts |
| Create `packages/cli/src/tailoring/drafts/repository.ts` | Revisions, fingerprints, atomic records, tombstones, corrupt-record reporting |
| Create `packages/cli/src/tailoring/drafts/routes.ts` | Draft HTTP validation and status mapping |
| Create `packages/cli/src/tailoring/drafts/service.ts` | Recoverable transitions coordinating drafts, runs, sync, and completion |
| Create `packages/cli/src/tailoring/drafts/operations.ts` | Durable intent records and replay for multi-file operations |
| Create `packages/cli/src/tailoring/drafts/locks.ts`, `errors.ts` | Bounded generation locks and shared persistence errors |
| Modify `packages/cli/src/tailoring/orchestrator.ts`, `store.ts`, `routes.ts` | Snapshot inputs, guarded apply/approve/finalize, run adoption |
| Modify `packages/cli/src/server.ts`, `watcher.ts` | Workspace identity, route mounting, events, manual completion integration |
| Create `packages/ui/src/tailoring-drafts/recovery.ts` | Workspace-scoped, per-writer browser snapshots |
| Create `packages/ui/src/tailoring-drafts/coordinator.ts` | Queued saves, hydration, acknowledgement ordering, conflicts |
| Create `packages/ui/src/tailoring-drafts/useTailoringDraft.ts` | React subscription and coordinator lifetime |
| Create `packages/ui/src/tailoring-drafts/manual-model.ts` | Full canvas state conversion, stable item IDs, export projection |
| Create `packages/ui/src/views/tailoring/DraftStatus.tsx`, `DraftConflictDialog.tsx`, `UpstreamSyncDialog.tsx`, `CompletedTailoring.tsx` | Small UI components for the named user actions |
| Create `packages/ui/src/views/tailoring/TailoringSetup.tsx`, `TailoringDraftRoute.tsx` | Extract setup editor and load drafts by URL |
| Modify `packages/ui/src/api/client.ts`, `routing.ts`, `App.tsx` | Typed APIs and routes including query parameters |
| Modify existing Tailoring views/step editors and `ResumeTailor.tsx` | Bind editing to recovery; preserve current layout and model behavior |
| Create focused tests named in each task | Persistence failure, race, workflow, and UI behavior |
| Modify `scripts/run-tailoring-walkthrough.mjs`, `README.md` | End-to-end acceptance and user-facing behavior |

Avoid adding more responsibilities to the existing large server or TailoringRun component. Route handlers delegate to the service; views delegate persistence to the coordinator. Do not restructure unrelated rendering.

## Contract decisions used throughout the tasks

Use camelCase for new recovery records while preserving existing snake_case workflow artifacts. New code must use these names consistently:

```ts
type DraftKind = 'setup' | 'run' | 'manual';
type DraftLifecycle = 'draft' | 'completed' | 'discarded';
type DraftSaveStatus = 'saving' | 'saved' | 'browser-only' | 'unsaved' | 'conflict';
type RevisionToken = { revision: number; fingerprint: string };
type DraftContext = {
  activeStep?: 'analysis' | 'alignment' | 'proposals' | 'brief';
  selectedProposalId?: string;
  editingProposalId?: string;
  mobilePane?: 'steps' | 'work' | 'context' | 'bullets' | 'matcher';
  diffMode?: 'side-by-side' | 'unified';
};
```

The draft record has `schemaVersion: 1`, `id`, `kind`, `lifecycle`, `revision`, `createdAt`, `editedAt`, `savedAt`, optional `runSlug` and `parentCompletionId`, `base`, `payload`, `context`, `appliedContent`, and optional `completion`. `base` is nullable during incomplete setup; otherwise it contains `resumeId`, `spec`, and `fingerprint`. `appliedContent` records the last successfully applied editable payload by step, not only the last autosaved revision. Completion contains a unique output ID/path, timestamp, immutable output spec, and run artifacts where applicable.

Payloads are a discriminated union by `kind`. Setup contains posting, label, baseResumeId and runner. Run contains editable analysis/alignment/proposals, a map of unfinished proposal text by proposal ID, and artifact tokens. Manual contains profile, summary, experiences with stable IDs and every bullet's `included` flag, education, skills, jobDescription, selectedResumeId, and squeezeMode. Empty field text is allowed in recovery schemas; malformed structure is not. Reuse the current field shapes rather than weakening workflow validation schemas.

The server computes SHA-256 fingerprints of canonical JSON. Canonical JSON recursively sorts object keys and preserves array order; the shared `canonicalJson(value)` function lives in `draft-state.ts`. Fingerprints are outside the serialized record so no hash contains itself. Context writes preserve `editedAt` and cannot advance acknowledgement of a content mutation. Every write still compares a record token; a coordinator serializes its content/context requests.

HTTP contracts:

| Method/path | Request | Success |
|---|---|---|
| GET `/api/tailoring-drafts` | None | `{ workspaceId, records, recoveryErrors }` |
| GET `/api/tailoring-drafts/:id` | None | `{ record, token }` |
| POST `/api/tailoring-drafts` | `{ record, mutationId }` | `{ record, token, mutationId }` |
| PUT `/api/tailoring-drafts/:id` | `{ expected, mutationId, change: 'content' \| 'context', payload?, context? }` | Same acknowledged envelope |
| POST `/api/tailoring-drafts/:id/discard` | `{ expected, operationId }` | Tombstone acknowledgement or reset run-draft envelope |
| POST `/api/tailoring-drafts/:id/create-run` | `{ expected, operationId }` | `{ record, token, slug }` |
| POST `/api/tailoring-drafts/:id/apply/:step` | `{ expected, artifactToken, operationId }` | `{ record, token, run }` |
| GET `/api/tailoring-drafts/:id/upstream` | None | `{ state: 'unchanged' \| 'updated' \| 'missing', fingerprint? }` |
| POST `/api/tailoring-drafts/:id/sync-preview` | `{ expected }` | `{ draftToken, upstreamFingerprint, merged, conflicts }` |
| POST `/api/tailoring-drafts/:id/sync` | `{ expected, upstreamFingerprint, resolutions, operationId }` | Updated envelope |
| POST `/api/tailoring-drafts/:id/complete` | `{ expected, operationId, name?, type? }` | `{ record, token, completion }` |
| POST `/api/tailoring-drafts/:id/continue` | `{ expected, operationId }` | New linked draft envelope |
| POST `/api/tailoring-drafts/:id/fork` | `{ expected, operationId, sourceSnapshot }` | Independent draft envelope, with new run slug when needed |

The client API uses `listTailoringDrafts`, `getTailoringDraft`, `createTailoringDraft`, `saveTailoringDraft`, `discardTailoringDraft`, `createRunFromDraft`, `applyTailoringDraft`, `getDraftUpstream`, `previewDraftSync`, `syncTailoringDraft`, `completeTailoringDraft`, `continueTailoringDraft`, and `forkTailoringDraft`. Define them in Task 4; do not introduce alternate names later.

Return 400 for malformed input, 404 for missing IDs, 409 with a machine-readable conflict code for stale tokens/workflow conflicts, 410 for discarded IDs, 422 for invalid apply/complete content, and 500 for persistence failure. Preserve existing authorization/origin middleware and existing workflow error semantics where routes already exist. Never accept client-controlled revisions, timestamps, completion state, run paths, or arbitrary base replacements in general PUT requests.

## Task 1: Recovery contracts and pure comparison

Execution: complete (`5e61835`, `7681990`). Eleven targeted tests and core build passed; independent spec and code-quality reviews approved.

**Files:** Create `packages/core/src/tailoring/drafts.ts`, `packages/core/src/tailoring/draft-state.ts`, `packages/core/tests/tailoring-drafts.test.ts`; modify `packages/core/src/index.ts`.

- [x] Add schema tests distinguishing incomplete-but-recoverable content from invalid structure. Include this assertion using a `SetupPayloadSchema` exported from `drafts.ts`:

```ts
import { expect, it } from 'vitest';
import { SetupPayloadSchema } from '../src/tailoring/drafts.js';
it('preserves incomplete setup text', () => {
  const payload = { posting: 'Staff eng', label: '', baseResumeId: '', runner: '' };
  expect(SetupPayloadSchema.parse(payload)).toEqual(payload);
  expect(SetupPayloadSchema.safeParse({ ...payload, posting: 3 }).success).toBe(false);
});
```

- [x] Run `npx vitest run packages/core/tests/tailoring-drafts.test.ts`; expect failure because the contracts do not exist.
- [x] Implement the discriminated recovery schemas from the contract section. Use bounded strings (2 MiB total request limit enforced at the route), UUID draft IDs, nonnegative revisions, and ISO timestamps. Derive recovery analysis schemas with blank requirement text allowed; preserve proposal decisions, citations, checks, overrides, and unfinished inline text. Do not apply `.partial()` to the entire model or introduce `any` payloads.
- [x] Implement canonical comparison and export it. Include this exact primitive; inputs have already passed JSON-compatible schemas:

```ts
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(k => object[k] !== undefined).sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson(object[k])}`).join(',')}}`;
}
```

- [x] Add `hasUnappliedChanges(record)` comparing each editable run step to `appliedContent`, including unfinished proposal buffers; setup/manual completion uses its own validated export boundary. Test context-only differences do not count and proposal override fields do count.
- [x] Run the test above and `npm run build:core`; expect passing tests and successful TypeScript output. Commit feature files with message `feat(core): define tailoring recovery contracts`.

## Task 2: Revisioned workspace repository

Execution: complete (`82f1da7`, `af57ae9`). Twenty-two repository tests and CLI build passed; spec and quality reviews approved. Task 3 owns interrupted lock-initialization/reclaim hardening and parsed-receipt normalization noted in review.

**Files:** Create `packages/cli/src/tailoring/drafts/repository.ts`, `packages/cli/tests/tailoring-draft-store.test.ts`.

- [x] Add filesystem tests in temporary workspaces for create/read/restart, stale update rejection, external JSON changes without a revision bump, malformed records, deletion followed by stale save, and failed replacement preserving old bytes. Inject the final replace operation for deterministic failure testing.
- [x] Define the repository surface used by those tests and the later service:

```ts
class DraftRepository {
  constructor(workspaceDir: string, options?: { replace?: typeof import('node:fs').renameSync });
  list(): { records: DraftEnvelope[]; recoveryErrors: Array<{ id: string; message: string }> };
  read(id: string): DraftEnvelope;
  create(record: DraftRecord, mutationId: string): DraftAcknowledgement;
  update(id: string, request: DraftUpdate): DraftAcknowledgement;
  discard(id: string, expected: RevisionToken, operationId: string): DraftEnvelope;
}
```

`DraftEnvelope`, `DraftAcknowledgement`, `DraftRecord`, and `DraftUpdate` are the Task 1 exported schemas/types matching the HTTP table. The declarations above describe the public surface; implement methods with runtime schema checks and filesystem operations, not declaration-only stubs.
- [x] Run `npx vitest run packages/cli/tests/tailoring-draft-store.test.ts`; expect module/API failures initially.
- [x] Implement files at `tailoring-drafts/<uuid>.json`. Validate UUID and resolved containment; reject symlinked record files/directories. Hash actual validated content on every read, compare both revision and fingerprint before changing it, and reject attempts to update completed/discarded records through the generic update method.
- [x] Serialize read/check/write for a record. Use a per-record exclusive lock file for cooperative processes and recheck the source fingerprint immediately before replacement to detect external edits. Do not claim atomic compare-and-swap against arbitrary non-cooperating external writers; surface detectable conflicts and document this practical filesystem limit. Write a unique temp file in the same directory, flush it, rename over the destination, and never fall back to truncating the original on Windows failure.
- [x] Store durable last-mutation receipts so replay after a lost response acknowledges the same mutation. Reject reuse of a mutation ID with different content. Tombstones retain enough identity/revision data to reject delayed creates/updates; list excludes tombstones. Continue listing healthy records when one record is corrupt.
- [x] Run the store tests, then `npm run build:cli`; expect pass. Commit `feat(cli): persist revisioned tailoring drafts`.

## Task 3: Recoverable multi-file operations

Execution: complete (`4695744`, `b0b2b2c`, `14fb0d0`). Fifty-seven persistence, journal, and lock tests and CLI build passed; spec and quality reviews approved. Recovery uses committed acknowledgements without replaying files that may since have advanced.

**Files:** Create `packages/cli/src/tailoring/drafts/operations.ts`, `packages/cli/tests/tailoring-draft-operations.test.ts`.

- [x] Add crash-injection tests for stopping before and after each file write in run creation, apply, sync, and completion. A resumed operation must either finish the same intended result or report a conflict; it cannot invent a second run or overwrite newer edits.
- [x] Run `npx vitest run packages/cli/tests/tailoring-draft-operations.test.ts`; expect failure before the operation runner exists.
- [x] Implement a persisted operation record under `tailoring-drafts/operations/<draftId>/<operationId>.json` containing command, draft ID, expected source tokens, deterministic target IDs/paths, intended content hashes, and phase (`prepared`, `written`, `committed`). Owner directories identify the affected draft even when journal JSON is corrupt, allowing healthy drafts to continue. Serialize operation identity globally so an operation ID cannot be reused under a different draft. Write intent before side effects and the completion receipt last. On retry or server startup, compare intended output hashes and resume missing writes. Block commands affecting a record with unresolved intents; ordinary read recovery remains available.
- [x] Introduce `DraftOperationRunner.execute(operation)` and `recover()`; operations use an explicit list of validated workspace-relative writes and one final draft commit. Recheck expected tokens and hold the same draft/run lock order for every command (draft before run). Never pass user-provided paths directly into the writer.
- [x] Run the crash-injection suite, including a replacement failure and a changed output encountered during recovery; expect no false completed status and no duplicate output. Commit `feat(cli): recover interrupted draft transitions`.

## Task 4: Draft HTTP API, workspace identity, and typed client

Execution: complete (`2b97edf`, `c73ba69`). API/storage/server/event tests and full production build passed; spec and quality reviews approved. Exact receipt replay survives source deletion, discard, and setup-to-run transitions without altering current records.

**Files:** Create `packages/cli/src/tailoring/drafts/routes.ts`, `packages/cli/src/tailoring/drafts/service.ts`, `packages/cli/tests/tailoring-draft-api.test.ts`; modify `packages/cli/src/server.ts`, `packages/cli/src/watcher.ts`, `packages/ui/src/api/client.ts`.

- [x] Add Hono request tests using the existing `createApp` fixture style: create incomplete setup, list it, update with an expected token, then repeat using a stale token. Assert 409 and unchanged stored text. Assert malformed JSON is 400, not an empty replacement; oversized input is 413. Test workspace identities differ for two roots.
- [x] Run `npx vitest run packages/cli/tests/tailoring-draft-api.test.ts`; expect 404 before mounting.
- [x] Implement CRUD endpoints from the contract table using `DraftRepository`. Compute stable `workspaceId` from the canonical resolved workspace path using SHA-256, normalizing Windows case. Include it in health and draft-list responses; existing `workspaceDir` remains for compatibility. Do not render/edit an existing draft under a guessed workspace identity while health is unavailable. The coordinator may retain a last confirmed identity for the same running session, but must reverify before flushing to the server.
- [x] Add the typed client methods from the HTTP table. Expose workflow command methods now as client request wrappers; mount their server handlers only when Tasks 5, 8, 12, 13, and 14 implement them. For every client method, retain error `status`, `code`, and `detail` through the existing `ApiError` class.
- [x] Subscribe draft repository writes and external changes through the existing watcher/event transport. Events carry affected IDs/tokens, not entire draft bodies. Ignore temp, lock, and operation files to avoid refetch loops. List views refresh draft metadata without destroying active editor state.
- [x] Run API tests and `npm run build`; expect pass. Commit `feat(api): expose workspace draft persistence`.

## Task 5: Snapshot base inputs and adopt existing runs

Execution: complete (398e5e6, 420e6cf, cebf958). Eighty-five relevant tests and full build passed; independent spec and quality reviews approved, including deterministic adoption/write races. Generated artifact reconciliation remains assigned to Task 8.

**Files:** Modify `packages/cli/src/tailoring/drafts/service.ts`, `packages/cli/src/tailoring/orchestrator.ts`, `packages/cli/src/tailoring/store.ts`, `packages/cli/src/tailoring/routes.ts`, `packages/core/src/tailoring/schemas.ts`; create `packages/cli/tests/tailoring-draft-workflow.test.ts`.

- [x] Test repeated Create run requests with the same draft/operation ID return the same slug, including retry after a simulated lost response. Test editing the source resume after creation does not change model inputs or proposal application. Test creating multiple drafts from the same base does not couple their edits.
- [x] Run `npx vitest run packages/cli/tests/tailoring-draft-workflow.test.ts`; expect failure before integration.
- [x] Implement `DraftService.createRun(id, expected, operationId)` using the operation runner. Validate the saved setup payload, reserve the slug once, capture the base if not already captured, write artifacts, and transition the same draft record from setup to run. Extend manifest with optional `draft_id` for compatibility. Keep existing POST `/api/tailoring` supported by creating the equivalent recovery record server-side.
- [x] Route all base reads in `getRun`, prompt construction, proposal validation, approval, and finalization through the draft snapshot. Preserve existing cloud consent and privacy redaction on the snapshotted input. After changing setup's base selection, the service captures the newly selected source; arbitrary client base-spec injection is rejected.
- [x] Implement `DraftService.adoptRun(slug)` for old manifests. Use existing artifacts as applied baselines, capture today's base with a legacy notice, and mark uncertain proposal targets for review. Never assert that today's base is historically exact. Missing source without an available snapshot blocks dependent commands but still permits viewing existing artifacts. Attach records atomically/idempotently and do not duplicate list rows.
- [x] Run new workflow tests and `npx vitest run packages/cli/tests/tailoring.test.ts`; expect legacy API and candidate-override behavior preserved. Commit `feat(tailoring): pin draft base resumes and adopt runs`.

## Task 6: Browser recovery with independent writer snapshots

Execution: complete (62f4eab, 9ef63b9). Twelve recovery tests and UI build passed; independent spec and quality reviews approved. BrowserRecovery.list returns healthy snapshots with explicit scan errors. Malformed messages from unsupported BroadcastChannel publishers remain a nonblocking hardening note.

**Files:** Create `packages/ui/src/tailoring-drafts/recovery.ts`, `packages/ui/tests/tailoring-recovery.test.ts`.

- [x] Test synchronous write/read, workspace isolation, quota failure, two independent writers, tab-close discoverability, and malformed local records. Use localStorage-backed snapshots, not sessionStorage-only draft content.
- [x] Run `npx vitest run packages/ui/tests/tailoring-recovery.test.ts`; expect missing module failure.
- [x] Implement `BrowserRecovery` with `write(snapshot)`, `list(workspaceId)`, and `remove(key, expectedMutationId)`. A snapshot contains workspace ID, draft ID, writer ID, base server token or null, mutation ID, local sequence number, payload/context, and save time. Generate a writer UUID per page lifetime; scanning all keys recovers closed tabs without relying on their session IDs.

```ts
export function recoveryKey(workspaceId: string, draftId: string, writerId: string) {
  return `featherduster:tailoring:v1:${workspaceId}:${draftId}:${writerId}`;
}
```

- [x] Only remove a snapshot when its mutation ID matches the acknowledged value. Catch serialization/storage errors and return a failure result to the coordinator. Keep corrupt raw values until explicit user action; do not overwrite them during hydration. Notify live tabs with BroadcastChannel and listen to storage events as fallback.
- [x] Run recovery tests; expect cross-writer writes never erase each other. Commit `feat(ui): retain tailoring drafts in browser recovery`.

## Task 7: Save coordinator and truthful status

Execution: complete (ac61695 through ab7f601). Thirty-eight coordinator/status tests and UI build passed; independent spec and quality reviews approved. Explicit actions must await coordinator.awaitSaved() for the current acknowledged token; flush() is background scheduling. Callers supply a confirmed workspace identity and explicitly hydrate the hook coordinator.

**Files:** Create `packages/ui/src/tailoring-drafts/coordinator.ts`, `packages/ui/src/tailoring-drafts/useTailoringDraft.ts`, `packages/ui/src/views/tailoring/DraftStatus.tsx`, `packages/ui/tests/tailoring-coordinator.test.ts`, `packages/ui/tests/tailoring-draft-status.test.tsx`.

- [x] Add controlled-promise/fake-timer tests: edit A starts a save; edit B occurs before A acknowledges; A's response must not mark B saved or remove B's snapshot. Cover context changes during save, retry after outage, both storage layers failing, and hydration against a newer server token.
- [x] Run `npx vitest run packages/ui/tests/tailoring-coordinator.test.ts packages/ui/tests/tailoring-draft-status.test.tsx`; expect failure initially.
- [x] Implement `DraftCoordinator` with `getSnapshot`, `subscribe`, `hydrate`, `edit`, `updateContext`, `flush`, `retry`, `resolveConflict`, and `dispose`. Inject API, browser recovery, timers, and ID creation for tests. `edit` synchronously attempts browser persistence before scheduling a 500 ms workspace save. Serialize network requests; coalesce unsent content to the newest mutation without losing its recovery record.
- [x] Implement explicit status reduction: only matching content acknowledgement sets `saved`; workspace failure plus a successful current recovery snapshot sets `browser-only`; failure of both sets `unsaved`; a stale-token response sets `conflict` and stops retries. Retry transient workspace failures with capped backoff (1, 2, 5, then 10 seconds) while open and immediately on online/focus/manual Retry; do not automatically retry validation/409/410 errors.
- [x] On hydration, automatically restore a pending local snapshot only if its server baseline still matches. Multiple divergent local snapshots or a changed server baseline produce a choice. Keep browser-only new drafts visible to list discovery. Track acknowledged content separately from a changed context token.
- [x] Bind the hook with `useSyncExternalStore`; dispose timers/listeners on draft/workspace changes while leaving browser recovery intact. Beforeunload and in-app leave guards apply only when the latest content has no durable recovery copy; don't warn for saved/browser-only content.
- [x] Implement `DraftStatus` as a small `role="status"` component using the spec's exact status messages. Retry remains keyboard accessible; announce transitions without speaking every timestamp change. Run tests and `npm run build:ui`; expect pass. Commit `feat(ui): coordinate draft saves and recovery status`.

## Task 8: Explicit application and server-side workflow gates

Execution: complete (176ce73, 192fbf7). Workflow, existing tailoring, operation, and related persistence suites passed; CLI/UI builds passed. Independent spec and quality reviews approved, with 63 tests independently rerun in quality review. Apply uses artifactToken plus expected draft token and returns an acknowledged envelope with run detail. Generated publication preserves pending edits; actual source hashes guard workflow consumption.

**Files:** Modify `packages/cli/src/tailoring/drafts/service.ts`, `packages/cli/src/tailoring/drafts/routes.ts`, `packages/cli/src/tailoring/orchestrator.ts`, `packages/cli/src/tailoring/routes.ts`; extend `packages/cli/tests/tailoring-draft-workflow.test.ts`.

- [x] Add tests that autosaving a blank requirement succeeds without changing run state, Apply rejects it, and approve/finalize cannot bypass pending draft edits. Assert a save during generation succeeds while Apply returns a running conflict. Assert external artifact edits invalidate the expected artifact token.
- [x] Run the workflow test file; expect the new assertions to fail.
- [x] Implement Apply as an operation over the expected draft and artifact tokens. Validate the selected step with existing workflow schemas, invoke existing deterministic checks, write the artifact, and update that step's `appliedContent` only after successful persistence. Keep unfinished inline proposal text recoverable on failure. No recovery PUT may call `saveStep`.
- [x] Add server-side guards to approve, run, finalize, and legacy mutation endpoints when a run has a draft. Prevent downstream model generation from silently ignoring unapplied upstream edits. Legacy explicit saves update the matching applied baseline through the service and cannot overwrite an outstanding draft from another writer. Preserve the ability to retry interrupted generation when inputs are settled.
- [x] Use the operation runner to make an artifact write followed by draft-baseline update retryable. Do not report Applied if one half failed. Revalidate existing proposal overrides exactly as the current implementation does.
- [x] Run workflow tests and existing CLI tailoring tests; expect pass. Commit `feat(tailoring): separate autosave from workflow application`.

## Task 9: Draft URLs, setup recovery, and unified list

Execution: complete (c3611e9, 25f8b4e, 8f2e7fc, a061c91). Sixty-two UI tests and UI build passed; independent spec and quality reviews approved. Browser-only setup survives immediate refresh; confirmed-identity mismatch stops writers while retaining recovery and appropriate unload protection. Late run-creation responses cannot redirect a departed editor. Manual and controlled run editor integration remain assigned to Tasks 10–11.

**Files:** Modify `packages/ui/src/routing.ts`, `packages/ui/src/App.tsx`, `packages/ui/src/views/tailoring/TailoringRunList.tsx`; create `packages/ui/src/views/tailoring/TailoringSetup.tsx`, `packages/ui/src/views/tailoring/TailoringDraftRoute.tsx`, `packages/ui/tests/tailoring-setup-drafts.test.tsx`; extend `packages/ui/tests/app-routes.test.tsx`.

- [x] Add route tests for `/tailor`, `/tailor/drafts/<uuid>`, `/tailor/<slug>?step=alignment`, invalid steps, unknown IDs, and popstate with a changed query string. Assert Tailoring navigation always opens the list, even with unfinished drafts.
- [x] Run `npx vitest run packages/ui/tests/app-routes.test.tsx packages/ui/tests/tailoring-setup-drafts.test.tsx`; expect new routes/recovery tests to fail.
- [x] Extend `TailorView` with draft and unavailable modes. Parse pathname and search from one URL object in initial render, push/replace navigation, and popstate. Add `step` to run view, with accepted values from `TAILORING_STEPS`. Preserve legacy `/exports` redirection and canvas reservation; reserve `drafts` too. A malformed draft route cannot fall through to an unrelated run/list silently.
- [x] Extract setup fields into `TailoringSetup`. On the first user mutation, generate a UUID locally, write recovery immediately, and replace the URL with `/tailor/drafts/<id>` before the debounce. Route changes reuse the same coordinator instead of remounting an empty editor. Defaults and initial data fetches do not create drafts. Preserve content even if run creation fails; success navigates to the returned run slug using the same draft identity.
- [x] Merge server drafts, legacy runs, and browser-only snapshots into one list by draft ID/run association. Show stage, kind, meaningful title, edited time, and Completed. No Continue banner and no automatic latest-draft redirect. Use normal row actions. Do not hide all healthy items when one record is corrupt or the server is offline; show the error next to available recovered work.
- [x] Run route/setup tests and build UI; expect pass. Commit `feat(ui): route and list resumable tailoring drafts`.

## Task 10: Controlled run editors and work-context restoration

Execution: complete (6d69339, b0b91fe, 87ed0a6). Controlled run recovery, command ordering, identity checks, refresh races, and cleanup-buffer regressions passed; UI build passed. Independent spec and quality reviews approved. The focused run hook owns or borrows a coordinator, verifies workspace/draft identity for reads and commands, preserves pending recovery, and retains memory-only navigation protection. Original user UI additions remain unstaged, with the override test callback mechanically adapted to draft autosave.

**Files:** Modify `packages/ui/src/views/tailoring/TailoringRun.tsx`, `packages/ui/src/views/tailoring/steps/AnalysisStep.tsx`, `packages/ui/src/views/tailoring/steps/AlignmentStep.tsx`, `packages/ui/src/views/tailoring/steps/ProposalsStep.tsx`, `packages/ui/src/hooks/useTailoringEvents.ts`; create `packages/ui/tests/tailoring-run-recovery.test.tsx`; extend `packages/ui/tests/tailoring-ui.test.tsx` and `packages/ui/tests/tailoring-diff.test.tsx` only where contracts change.

- [x] Add tests for editing a blank requirement, switching away/back, and remounting from recovery. Repeat for alignment rationale and proposal inline text. Trigger a file/status event while typing and assert text remains. Restore selected proposal, inline editor, diff mode, and mobile pane without reopening consent dialogs.
- [x] Run `npx vitest run packages/ui/tests/tailoring-run-recovery.test.tsx`; expect failure before controlled editing.
- [x] Change step props from private draft state to controlled `value`, `onChange`, and awaited `onApply`. Replace analysis/alignment prop-reset effects with coordinator hydration/reconciliation. Keep local state only for transient non-restorable UI. Proposal decision/citation/override edits update recovery payload; explicit Apply commits them. Keep the editor open if Apply fails.

```ts
type EditableStepProps<T> = {
  value: T;
  onChange: (value: T) => void;
  onApply: () => Promise<void>;
  applying: boolean;
  readOnly: boolean;
};
```

- [x] Store unfinished proposal textarea values on every keystroke, not only when clicking Apply. Expose draft-save status separately from unapplied-step status. Wire Approve and continue to await a successful explicit application when needed, then approve, then start the next step; failure at any boundary stops the chain. Disable unrelated commands that cannot consume unapplied inputs, with a concise explanation.
- [x] Resolve active step in order: valid query step, stored step, first unapproved step. Step clicks replace the query in the existing run URL and persist context without modifying content save time. Context restoration should be validated against available proposal IDs; fall back to a valid selection if upstream changes removed one.
- [x] Reconcile SSE/poll results using artifact tokens; unchanged artifact tokens cannot reset editor content. Changed tokens plus edited local content enter conflict resolution. Refresh while generation runs reconnects to current server state. Display interrupted state with Retry; never rerun on mount.
- [x] Run run-recovery, existing tailoring-ui, and tailoring-diff tests; expect candidate overrides and source highlighting preserved. Commit `feat(ui): recover tailoring step edits and context`.

## Task 11: Full manual canvas recovery

Execution: complete (ea96122, 10e12a2, d2bd4bc). Full-model/manual route, first-edit focus, source switching, durable handoff, timestamp, and deferred-verification regressions passed; UI build passed. Independent spec and quality reviews approved. Fresh canvases require a source; recovered drafts retain their pinned base if it disappears. Manual editor supports explicit same-ID payload replacement, and context-only persistence preserves content edit timestamps.

**Files:** Create `packages/ui/src/tailoring-drafts/manual-model.ts`, `packages/ui/tests/manual-draft-model.test.ts`; modify `packages/ui/src/views/ResumeTailor.tsx`, `packages/ui/src/App.tsx`, `packages/ui/tests/resume-tailor.test.tsx`.

- [x] Test round-trip editor serialization with an excluded bullet, unfinished experience fields, education/skills edits, job description, and a selected variant that is not the first loaded resume. Test export projection excludes unchecked bullets while recovery retains them.
- [x] Run `npx vitest run packages/ui/tests/manual-draft-model.test.ts packages/ui/tests/resume-tailor.test.tsx`; expect new recovery assertions to fail.
- [x] Implement `manualFromSpec(spec, selectedResumeId, makeId)`, `manualToSpec(payload)`, and schema-backed recovery without regenerating existing IDs. `manualFromSpec` runs once for a new canvas; hydration restores payload directly. `manualToSpec` is the only inclusion-filtering projection used by compilation/export.
- [x] Replace independent editor state setters with updates to the manual payload. Ignore initial resume-list refreshes for a hydrated draft; preferredResumeId cannot overwrite recovered edits. Changing the loaded source while content exists starts a new draft or requires the explicit upstream flow, never silently replaces content. Editing different variants yields separate draft IDs.
- [x] Mount the manual editor for its route identity instead of depending on permanent hidden mounting for data survival. Persist its mobile pane and squeeze mode. Turn the canvas-to-setup handoff into a durable new setup draft, preserving the original manual draft. Refresh between the handoff and run creation must recover the posting.
- [x] Use the new completion command for Save variant once Task 14 is present; until then preserve the existing save action without claiming the draft is Completed. Run targeted model/canvas tests and build UI; expect pass. Commit `feat(ui): preserve full manual resume drafts`.

## Task 12: Conflict choices and explicit discard

Execution: complete (31c0baa, 8a4723f, df4767a, e6a7fd0). Conflict, fork, discard, workflow and coordinator tests passed; full build passed. Independent spec and quality reviews approved, with 83 focused tests independently rerun in final quality review. Forks preserve user editing choices while resetting workflow approvals, use independent run identities, and support explicit Apply without regeneration. Temporary confirmation holds remain separate from real conflicts; memory-only recovery remains selectable after storage failures.

**Files:** Create `packages/ui/src/views/tailoring/DraftConflictDialog.tsx`, `packages/ui/tests/tailoring-draft-conflicts.test.tsx`; modify coordinator, draft route/list, service and draft routes.

- [x] Test remote-newer, two divergent local recovery snapshots, deleted draft, and discard while another tab has saved a newer revision. Assert no automatic overwrite/recreation and that both conflict choices retain the selected content.
- [x] Run `npx vitest run packages/ui/tests/tailoring-draft-conflicts.test.tsx`; expect missing behavior failure.
- [x] Implement a keyboard-accessible conflict dialog using existing `useModalA11y`: show version source/time, **Load newer version**, and **Keep mine as a separate draft**. Implement the fork endpoint and `DraftService.fork(id, expected, operationId, sourceSnapshot)` for the latter. Validate the saved local snapshot as recovery content, preserving its own base and unapplied edits; never trust submitted approvals, lifecycle, paths, or completion metadata. It creates an independent draft and, for runs, independent run artifacts through the operation service; it must not keep two writable draft IDs pointing at the same run. If the historical artifact baseline cannot be reconstructed, keep text as recoverable draft edits and require review rather than importing approval state. Keep original recovery until fork acknowledgement.
- [x] For Load newer, replace working content only after explicit selection and preserve the old recovery until the load succeeds. A 410 response offers recovery into a new draft, not re-creation at the discarded ID. Pause autosave during either unresolved conflict choice.
- [x] Add Back to list and confirmed Discard actions. Setup/manual discard tombstones the record; a run's **Discard unapplied edits** resets recovery to current applied artifacts and preserves the run. State that distinction in confirmation text. Compare tokens before discard/reset and clear matching browser copies only after acknowledgement. No deletion of exported resumes.
- [x] Run conflict tests plus repository/workflow tests; expect pass. Commit `feat(tailoring): resolve draft conflicts without losing work`.

## Task 13: Three-way upstream merge and preview

Execution: complete (984f62c, 5fc18d9, 0a162cf, 10dea9a). Merge, sync, workflow and UI tests passed; full build passed. Independent spec and quality reviews approved, with 59 final affected tests independently rerun. Sync checks effective candidate equivalence before writes, preserves ambiguous text for review, journals remapped artifacts and reset baselines, supports safe read-only imported sources, and shows readable previews that follow conflict choices.

**Files:** Create `packages/core/src/tailoring/resume-merge.ts`, `packages/core/tests/resume-merge.test.ts`, `packages/ui/src/views/tailoring/UpstreamSyncDialog.tsx`, `packages/ui/tests/tailoring-upstream-sync.test.tsx`; modify core exports, draft service/routes and run/manual views.

- [x] Add pure merge tests for independent scalar edits, conflicting scalar edits, unchanged arrays, unique additions, edit-versus-delete, ambiguous duplicate bullets, concurrent reorders, and index-based proposal targets. Begin with this scalar rule (export `mergeField` and `MergeFieldResult` from the new module):

```ts
type MergeFieldResult<T> = { value: T; conflict: false } | {
  base: T; local: T; upstream: T; conflict: true;
};
export function mergeField<T>(base: T, local: T, upstream: T): MergeFieldResult<T> {
  const same = (a: T, b: T) => canonicalJson(a) === canonicalJson(b);
  if (same(local, upstream) || same(upstream, base)) return { value: local, conflict: false };
  if (same(local, base)) return { value: upstream, conflict: false };
  return { base, local, upstream, conflict: true };
}
```

- [x] Run `npx vitest run packages/core/tests/resume-merge.test.ts`; expect failure before adding merge behavior.
- [x] Implement `previewResumeMerge(base, local, upstream)` returning merged fields, conflicts with stable IDs/paths, and a safe old-to-new target map. Match upstream array members only by stable source identity or unique unchanged structural identity; an edited member without a reliable match becomes a conflict. Preserve local inclusion flags. Never guess corresponding bullets by their new numeric position. Offer local/upstream selection at the smallest safely identified conflicting field or array.
- [x] Derive the run's local resume projection from its snapshotted base and edited proposals using existing apply logic only when proposals are structurally valid and targets can be resolved. If unfinished proposal text or invalid structures prevent a safe projection, retain the draft and explain that those edits must be applied/resolved before sync. Manual sync uses the full editable model, including excluded bullets, not the export projection.
- [x] Implement upstream status/preview routes, checking source fingerprint on open/focus and relevant file events. Mount a **Base resume updated** indicator and **Sync upstream** dialog showing merged changes and per-conflict choices. Cancel has no persistence effect. Missing source retains the snapshot and disables sync.
- [x] Implement sync apply using the operation runner, checking draft token and upstream fingerprint again. Commit merged content, new base snapshot, safely remapped targets, and review flags together. For runs, the new base is the upstream spec, not the already-tailored merged result: retain the merged result as the candidate preview and rebase remaining proposal operations against the new base. Drop an operation already satisfied by upstream; flag an operation that cannot be represented unambiguously for review. Test that additions and rewrites apply exactly once after sync. Conservatively stale alignment/proposals/brief after base changes; analysis based only on unchanged posting may remain valid. Preserve previous artifacts for comparison. Disable approval/finalization of stale results and never automatically regenerate.
- [x] Test changed upstream during preview (409), cancellation, sync while generation runs, and target remap failure. Run merge, workflow, and UI sync tests after `npm run build:core`; expect pass. Commit `feat(tailoring): preview and apply upstream resume sync`.

## Task 14: Completed snapshots and linked continuations

Execution: complete (5e2753a, 72f3bf8, 894610c). Completion, continuation, workflow and recovery suites passed; full build passed. Independent spec and quality reviews approved. Immutable snapshot/output bytes survive child completion, exact retries preserve identity, and completed views expose divergent browser recovery after refresh without autosaving completed records. Same-ID route transitions and post-response workspace verification have regression coverage.

**Files:** Modify `packages/cli/src/tailoring/drafts/service.ts`, `packages/cli/src/tailoring/drafts/routes.ts`, `packages/cli/src/tailoring/orchestrator.ts`, `packages/cli/src/server.ts`, `packages/ui/src/views/ResumeTailor.tsx`, `packages/ui/src/views/tailoring/TailoringRun.tsx`, and `packages/ui/src/views/tailoring/TailoringDraftRoute.tsx`; create `packages/ui/src/views/tailoring/CompletedTailoring.tsx`, `packages/cli/tests/tailoring-completion.test.ts`, `packages/ui/tests/tailoring-completion.test.tsx`.

- [x] Add tests that failed output persistence leaves a draft unfinished, duplicate complete requests return the same output, and Continue editing creates independent mutable work. Hash completed snapshot/output bytes before continuation and assert they stay unchanged after edits/finalization.
- [x] Run `npx vitest run packages/cli/tests/tailoring-completion.test.ts packages/ui/tests/tailoring-completion.test.tsx`; expect failure initially.
- [x] Implement `DraftService.complete(id, expected, operationId, options)` with schema validation and existing preflight behavior. Allocate the output identity once per operation, preserve supplied display name/type, and write a collision-resistant filename incorporating the completion ID. Never overwrite another completed file even when the display name matches. Persist immutable snapshot and output before transitioning lifecycle to completed; crash recovery finishes or reports failure without false success.
- [x] Keep existing preflight warnings/override policy unchanged; this feature does not silently add or bypass integrity gates. Guard direct legacy finalization/save paths for draft-owned outputs so they cannot mutate Completed records. Ordinary unrelated resume saves retain current behavior.
- [x] Implement `continue(id, expected, operationId)` from an immutable snapshot. Copy full manual model or run artifacts/base into a fresh linked draft; allocate a new run slug for run continuations. Retain approvals only for unchanged inherited artifacts, invalidate dependencies on later edits, and make no model call during continuation. Return the same new ID if the operation retries.
- [x] Render completed results read-only with **Continue editing**, existing export actions, and parent linkage for the new draft. Legacy completed runs establish a snapshot before continuation; don't infer completion merely from every step being generated. Use finalized output identity/metadata and show missing-output errors without fabricating content.
- [x] Wire manual Save variant and run Finalize to complete commands and navigate to their completed view. Run completion tests plus existing resume/tailoring tests; expect pass. Commit `feat(tailoring): preserve completed versions and continue as drafts`.

## Task 15: Browser acceptance and documentation

Execution: complete (774826c, 47ff9b9). Full build and both headless browser walkthroughs passed with zero unexpected errors. Recovery checks cover refresh, real stale writes and forks, unchecked bullets, sync, immutable completion, actual subprocess interruption and explicit retry, and exact navigation/editor restoration. Desktop/mobile screenshots cover all five required states. Browser checks exposed and fixed timer receiver binding and initial generation/context ordering. Independent spec and quality reviews approved; subprocess lifecycle tests also passed.

**Files:** Modify `scripts/run-tailoring-walkthrough.mjs`, `README.md`; add `scripts/run-tailoring-recovery-walkthrough.mjs` and a `walkthrough:tailoring-recovery` script in root `package.json`.

- [x] Extend the existing deterministic walkthrough for the new explicit Apply action and Completed view. Add a dedicated recovery walkthrough using `startServer`, `initWorkspace`, Playwright Chromium, and `node:assert/strict` in a throwaway workspace. Start servers without opening a browser window; close browser/server in `finally`.
- [x] Exercise immediate refresh before debounce by temporarily blocking draft PUTs, filling setup, and reloading. Assert the posting and stable draft URL survive. Re-enable writes and assert Draft saved appears. Use explicit response/UI predicates instead of fixed sleeps.

```js
await page.route('**/api/tailoring-drafts/**', async route => {
  if (route.request().method() === 'PUT') return route.abort();
  return route.continue();
});
await page.getByLabel('Job posting', { exact: true }).fill('Staff Engineer at Acme');
const draftUrl = page.url();
await page.reload();
assert.equal(page.url(), draftUrl);
assert.equal(await page.getByLabel('Job posting', { exact: true }).inputValue(), 'Staff Engineer at Acme');
await page.unroute('**/api/tailoring-drafts/**');
```

- [x] Extend the scenario to manual excluded bullets, a selected run step, an open proposal editor, browser Back/Forward, and navigating through the Tailoring tab. Assert Tailoring renders the list and direct links restore specific work. Capture desktop and mobile screenshots of saved, browser-only, conflict, sync-preview, and completed states.
- [x] Open a second page in the same browser context and cause a genuine stale write. Assert conflict UI and successful fork without loss. Stop/restart the sample server during fake generation; verify recovery and an explicit Retry action, with no automatic new model request. Update the sample base file and exercise sync Cancel and Apply.
- [x] Complete a draft, continue it, and verify the old output bytes still match after the new draft is saved. Keep expected offline request errors separate from unexpected console/page errors in the walkthrough's assertions.
- [x] Add README guidance explaining draft versus applied state, storage labels, direct-link behavior, upstream sync, completion, and no cross-device support. Document recovery limitations honestly: browser storage can be cleared, and arbitrary external writers do not participate in repository locks.
- [x] Run `npm run build`, `npm run walkthrough:tailoring`, and `npm run walkthrough:tailoring-recovery`; expect zero assertion failures and artifacts under `walkthrough-output/tailoring-recovery`. Commit `test: verify tailoring recovery across refresh and interruption`.

## Task 16: Final integration verification and handoff

Execution: complete. Final independent feature review approved fe3c918 after fixing context-only navigation during generation. The full suite has 974 passing tests and one independently reproduced pre-existing export-drawer failure; the full build and both browser walkthroughs pass. Original user changes remain unstaged and intact. The final verification record below distinguishes the existing failure from feature results.

**Files:** Review all feature changes and this plan's checkboxes; update the spec only if implementation reveals an agreed clarification, not to weaken acceptance.

- [x] Run `npm test` after the final code changes. Distinguish reproducible pre-existing failures from feature regressions using the recorded starting state; do not rewrite unrelated tests to make them pass.
- [x] Run `npm run build` if anything changed since the successful Task 15 build. Confirm no generic draft save calls `saveStep`, approval, generation, or finalization. Confirm base lookups after draft adoption all use the snapshot and every completed continuation gets a distinct output identity.
- [x] Check every acceptance row below against passing tests/walkthrough evidence. Resolve gaps before calling the feature complete.
- [x] Stage only reviewed feature hunks and run `git diff --cached --check`; expect no output and exit code 0. Inspect `git diff --cached --stat` and `git diff --cached` before committing. Preserve the pre-existing unrelated changes. Record the actual commands/outcomes and material limitations in the implementation handoff.

## Spec coverage and dependency map

| Spec behavior | Tasks | Primary evidence |
|---|---|---|
| First-edit protection; multiple drafts | 1–7, 9, 11 | Setup/canvas recovery and immediate-refresh walkthrough |
| List-only Tailoring; exact direct links/context | 9–11 | Route, run recovery, and browser tests |
| Truthful status; browser fallback; delayed acknowledgements | 6–7 | Coordinator race/failure tests |
| Incomplete text separate from Apply/Approve | 1, 8, 10 | API workflow and editor recovery tests |
| Multi-tab/external conflict and discard | 2–3, 6–7, 12 | Repository/conflict tests and two-page walkthrough |
| Snapshot base and explicit upstream sync | 5, 13 | Workflow snapshot and merge/preview tests |
| Refresh during generation; restart requires Retry | 8, 10, 15 | Workflow and restart walkthrough |
| Completed preservation; linked continuation | 3, 14–15 | Failure injection and output hash assertions |
| Legacy runs, missing/corrupt records, workspace isolation | 2, 4–6, 9, 14 | Repository/API/recovery/routing tests |
| Existing proposal overrides and privacy behavior | 5, 8, 10, 14 | Existing tailoring suites plus snapshot input tests |

Execution order is 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16. Tasks 6–7 can be developed against the typed API after Task 4, but keep one owner for overlapping integration files. Tasks 9–14 are intermediate feature slices, not separate claims that resumability is finished.

Self-review completed: all spec sections have task coverage, new API names agree across layers, status and lifecycle are separate, recovery payloads preserve excluded/unfinished content, and crash/acknowledgement/conflict cases have explicit checks. Execution is complete on feat/resumable-tailoring; per-task notes and the final verification record document reviewed results.

## Final verification record

- `npm test -- --reporter=json --outputFile=C:/Users/drewk/featherduster-final-tests.json`: 974 passed, 1 failed, 975 total. The failing test is `ExportDrawer Component Tests renders flyout drawer when isOpen is true` at `packages/ui/tests/export-drawer.test.tsx:128`, expecting `# Compiled [markdown] Output`. An isolated checkout of pre-feature commit `1d85d8a` reproduces the identical failure (5 passed, 1 failed in that file). The unrelated test was not rewritten. Baseline/current comparison reports remain at `C:/Users/drewk/featherduster-export-test-{baseline,current}.json`; the temporary baseline checkout was removed.
- `npm run build`: passed on final feature code. Existing gray-matter eval and bundle-size warnings remain.
- `npm run walkthrough:tailoring`: passed again after the final coordinator fix, reaching Completed with no browser errors.
- `npm run walkthrough:tailoring-recovery`: passed after the final coordinator fix, including real step/mobile navigation while generation publishes, explicit retry after subprocess interruption, and immutable parent output/snapshot assertions. Expected network/status failures are narrowly scoped; unexpected errors fail the walkthrough.
- `node --test scripts/test-walkthrough-process.mjs`: 5 passed; independent reviews reran these startup/shutdown lifecycle checks.
- Final independent reviewer approved the complete feature and reran 53 coordinator tests. The final fix's 112 focused coordinator/run/recovery/status/conflict tests passed.
- Autosave audit: `DraftService.save` only performs recovery repository transitions; it does not apply, approve, generate, or finalize. Adopted run base reads use the stored snapshot. Completion and continuation allocate independent output/run identities and immutable snapshot sources.
- Preservation audit: all 295 added/removed lines across the seven pre-existing dirty files match the saved pre-Task13 residual patch. Feature changes were staged separately; no user changes were committed or removed.

| Acceptance behavior | Passing evidence |
|---|---|
| First-edit protection, browser-only refresh, multiple drafts | Setup/manual route tests; recovery walkthrough immediate-refresh and independent fork scenarios |
| List-only Tailor, exact links, context and unfinished text | Routing/run recovery suites; browser Back/Forward, Tailor navigation, selected-step and inline-editor reload assertions |
| Truthful status, retry, delayed acknowledgements | Coordinator/status/recovery suites; blocked-save/retry browser scenario |
| Recovery separate from Apply/approval/generation | Draft workflow and controlled editor suites; original browser Apply flow |
| Concurrent versions, explicit fork/load/discard | Repository/journal/conflict suites; actual held PUT receiving 409 across two pages and lossless fork |
| Pinned base, explicit upstream preview and merge | Merge/upstream suites; Cancel byte equality, Apply base update, visible local/upstream conflict choices |
| Interrupted generation, no automatic rerun | Actual subprocess termination/restart browser assertions; explicit Retry request counted |
| Completed immutability and linked continuation | Failure-injection/completion suites; original snapshot and output byte equality after child completion |
| Legacy, corruption, missing source/output, namespace isolation | Repository/API/workflow/routing/completion suites and delayed-identity regression tests |
| Existing overrides, highlighting, privacy/preflight | Existing core/CLI/UI tailoring and resume suites; preserved initial user hunks |

Desktop/mobile screenshots for saved, browser-only, conflict, sync preview, and completed states are in `walkthrough-output/tailoring-recovery/`. No cross-device sync is provided. Browser recovery depends on retained browser storage; external file writers do not participate in workspace locks. Work remains on `feat/resumable-tailoring` for integration.
