# BUG-003: Bind displayed findings to the wording they validate

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 53.

## Problem and evidence

The [walkthrough](../../../netbox-live-job-attempt-2026-11-07.md) displayed a
new summary without an experience total while its exception said **Numbers not
supported by cited verified evidence: 11**. The retained starting summary still
contained 11 years. A blocked rewrite left the validated candidate using that
baseline, while the main draft showed the intended replacement.

Both pieces of text are legitimate historical data. Presenting a finding beside
different wording makes the corrective action ambiguous and weakens PDF review.

## Reproduction

1. Capture a starting summary containing an unsupported numeric claim.
2. Generate a replacement that removes the number but has another blocking
   issue.
3. Open the complete draft and select the summary exception.
4. Edit the replacement and deliver a delayed result for the preceding
   revision.

Expected: every finding identifies its exact text, revision, and candidate
scope. Users can tell whether it concerns the starting resume, intended edit, or
current export candidate. Stale findings cannot appear to validate newer text.

## Implementation scope

Inspect
[proposal-review.ts](../../../../packages/core/src/jobs/proposal-review.ts),
[proposal-service.ts](../../../../packages/cli/src/jobs/proposal-service.ts),
[JobProposalReview.tsx](../../../../packages/ui/src/views/jobs/JobProposalReview.tsx), and
[ResumeDraftSurface.tsx](../../../../packages/ui/src/views/jobs/ResumeDraftSurface.tsx).

Bind a finding to input snapshot, review/candidate revision, subject, exact text
fingerprint, and applicable span. Transport the distinction between an intended
preview and the validated export candidate explicitly. A baseline finding can be
shown as retained-baseline context while its proposed replacement is unresolved;
it must not look like a defect in text that has already removed the assertion.

Preserve the rule that blocked edits cannot enter an approved artifact. Do not
resolve this discrepancy by applying unsupported operations or hiding real
baseline conflicts. Reconcile with the approved draft-first completion decision.

## Acceptance and verification

- The numeric-baseline scenario never attributes 11 to a number-free
  replacement.
- Selecting a finding reveals the exact checked wording and its version.
- A pending edit is distinguished from the current saved/validated candidate.
- An old response cannot replace newer findings or imply current support.
- Refresh/reload preserves both proposed edits and their validation state.
- Approval binds the displayed current PDF and matching summary, not a preview.
- Cover summary replacement, shifted bullet indices, omission, consolidation,
  stale responses, and saved legacy reviews in core, service, and UI tests.

Dependencies: none. Coordinate state labels with
[BUG-006](bug-006-review-state.md) and final comparisons with
[BUG-007](bug-007-final-correction-history.md).
