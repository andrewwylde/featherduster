# SL-BUG-008: Use one current review state for counts and next actions

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 56 (existing).
The parent task retains its earlier high priority. This follow-up is P2.

## Problem and evidence

The [SentiLink review](../../../sentilink-live-job-attempt-2026-11-08.md#5-mixed-saving-recovery-and-conservative-corrections)
introduced useful named counts, but its heading, status card, passage rows,
and nested guidance could still disagree. Checking passages appeared alongside
technical-check retry counts; an ended preparation continued saying Needs
retry after semantic checks completed. A saved summary could retain baseline
issue counts while the relevant current facts had different support results.

Some counters legitimately measure different things. The defect is ambiguous
or stale projection of action and completion, not that all numbers must match.
The retained-baseline label introduced by BUG-003 is useful and must remain.

## Reproduction

Seed a review with 13 supported claims, three answerable claims, and four
unavailable passages. Retry the technical batch, save narrower summary wording
with one inherited correction, and deliver check responses out of order. Finish
checks with one genuine qualifier question, then resolve it by narrowing.
Compare header, primary action, card, exception rows, and selected panel at each
persisted revision, including after reload.

## Implementation scope

Reuse [semantic-transport.ts](../../../../packages/core/src/jobs/semantic-transport.ts),
[JobDetail.tsx](../../../../packages/ui/src/views/jobs/JobDetail.tsx),
[JobProposalReview.tsx](../../../../packages/ui/src/views/jobs/JobProposalReview.tsx),
[ResumeDraftSurface.tsx](../../../../packages/ui/src/views/jobs/ResumeDraftSurface.tsx),
and [JobFacts.tsx](../../../../packages/ui/src/views/jobs/JobFacts.tsx).
Extend the existing common summary rather than adding another UI-only state
machine. Bind results to job/input/review/candidate/support revisions.

Distinguish factual questions, current substantive wording blockers, checking,
unchecked/unavailable checks, and informational retained-baseline findings.
Keep claim counts separate from passage counts with clear labels. A running
check is not a failed check. Historical attempt failure is not the current
semantic outcome. Pending local edits are neither saved nor checked.

Allow a factual question to remain answerable while independent work checks,
but identify which passages each action concerns. Missing/loading responses
cannot imply resolved state. Preserve successful support for unchanged wording.
Coordinate terminal operation state with SL-BUG-005; no timestamp redesign is
needed here.

## Acceptance and verification

- Each fixture state gives a truthful primary action; all surfaces use the same
  current result binding and explain any independently running work.
- Current Needs retry counts exclude checking and completed supported passages;
  missing results remain unresolved without becoming personal confirmation.
- Answered/narrowed facts leave the active question queue. Stale responses
  cannot undo newer support or validate newer wording.
- Retained-baseline information is visible but not double-counted as a new
  failure in a replacement that resolves it. Real baseline conflicts stay gated.
- Reload preserves the correct question/check state and local-versus-saved
  distinction. Required checks still precede automatic PDF continuation.
- Extend [summary tests](../../../../packages/core/tests/unified-review-summary.test.ts),
  [review tests](../../../../packages/ui/tests/job-proposal-review.test.tsx),
  and selected facts/API tests, with delayed-response and missing-result cases.

Dependencies: retain Task 56's existing dependencies on Tasks 52 and 53. The
normalization fix in SL-BUG-001 is related but not a prerequisite for testing
this state projection with persisted synthetic results.
