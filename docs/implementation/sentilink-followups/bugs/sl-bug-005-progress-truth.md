# SL-BUG-005: Keep progress, usage, and terminal timing current

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 62 (existing).

## Problem and evidence

The [recorded progress response](../../../sentilink-live-job-attempt-2026-11-08.md#3-preparation-progress-and-navigation)
had an active attempt in alignment with two dispatched model calls, alongside
`preparation.current_operation = preparing_resume` and `api_calls = 0`.
Later stopped/complete cards kept advancing their elapsed clock. Tokens were
correctly labeled Not recorded.

The runtime's initialized progress-map entry takes precedence over its more
current attempt-derived fallback. The UI computes time from now even when the
attempt has ended. Private receipt: `15-job-progress.json` and final screens.

## Reproduction

Create a fake active attempt in analysis with one recorded dispatch. Return an
older initialized progress-map value with zero calls. Advance to alignment and
two calls, then fail for review. Complete an independent semantic retry, and
later finish a continuation. Read/render progress before and after each step.

Expected: phase and counts describe the current persisted operation. The
finished attempt's elapsed duration freezes; a resumed attempt has its own
identity and timing. Historical attempt failure does not imply current retry.

## Implementation scope

Inspect [runtime.ts](../../../../packages/cli/src/jobs/runtime.ts),
[JobDetail.tsx](../../../../packages/ui/src/views/jobs/JobDetail.tsx), and
[job schemas](../../../../packages/core/src/jobs/schemas.ts).
Choose one authoritative projection from the current attempt/stage and recorded
dispatches. An in-memory decoration cannot override newer persisted state.
Recover the same projection after process restart.

Expose stable attempt/phase identity and the recorded terminal timestamp or
duration. Name attempt versus phase elapsed time honestly when only an attempt
start is available. Separate preparation calls from semantic-check calls; do
not show one continuation call as total workflow usage. A failed call counts as
dispatched, not as successful. Do not infer tokens, price, model name, or a
completion percentage. Unknown values remain unknown.

Current semantic checking and actionable retry state are coordinated with
[SL-BUG-008](sl-bug-008-review-state.md). Keep unrelated sections readable while
work runs and avoid adding high-frequency global polling for the clock.

## Acceptance and verification

- The recorded two-call alignment fixture never displays zero calls or a stale
  generic operation as if it were a current checkpoint.
- Terminal timing freezes under fake timers, navigation, reload, and process
  restart; resumed attempts have separate timestamps and identity.
- Preparation failure, semantic retry, successful checks, rendering, and ready
  state project correctly without changing saved support or approvals.
- Counts are monotonic within their named scope. Missing token/cost/model data
  is not filled with invented values or mislabeled as recorded.
- Add API/runtime and UI tests with fake clocks and persisted transitions;
  verify a browser capture against the matching response at the same revision.

Dependencies: retain Task 62's existing dependency on Task 56. This completes
the existing progress feature rather than adding a second status panel.
