# BUG-006: Use one current review state for counts and next actions

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 56.

## Problem and evidence

The [initial review](../../../netbox-live-job-attempt-2026-11-07.md)
simultaneously showed **Review facts (14)**, **10 passages need attention**, and
**9 of 19 resolved**. `JobDetail` labels a count of blocking issue groups as
facts. During checking, all passage rows became Checking and the
resolved-passage count became zero even while factual support remained. Nested
guidance sometimes offered a retry while the main guidance said to wait.

These counts describe different things, but their names and update timing make
completion and the next action unclear.

## Reproduction

1. Load a review with supported claims, two factual questions, wording
   blockers, and one failed evidence batch.
2. Save a wording edit, delay a previous response, and start the next check.
3. Inspect the header, exception list, selected passage, and factual panel.
4. Reload during checking and after the operation finishes.

Expected: every surface uses the same current candidate/support revision. Counts
name their unit, and one next action reflects persisted state.

## Implementation scope

Inspect [JobDetail.tsx](../../../../packages/ui/src/views/jobs/JobDetail.tsx),
[JobProposalReview.tsx](../../../../packages/ui/src/views/jobs/JobProposalReview.tsx),
[ResumeDraftSurface.tsx](../../../../packages/ui/src/views/jobs/ResumeDraftSurface.tsx), [JobFacts.tsx](../../../../packages/ui/src/views/jobs/JobFacts.tsx), and
[semantic transport](../../../../packages/core/src/jobs/semantic-transport.ts).

Use the completion projection required by the approved
[draft-first design](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md). Do not introduce another competing state machine. Distinguish factual answers,
technical checks, wording changes, save state, and PDF readiness. Preserve
current support for unaffected text; invalidate changed claims through explicit
bindings.

## Acceptance and verification

- **Review facts** counts only unresolved answerable facts. Technical failures
  and wording issues have accurately named actions and units.
- Checking cannot erase support for unchanged passages or imply all work is
  lost.
- The selected panel cannot offer another dispatch while its relevant check is
  active. Saving remains available independently where its contract permits.
- Missing/failed results never imply Resolved; absence of blockers is
  insufficient.
- Stale responses cannot restore obsolete questions, counts, or next actions.
- Fact completion does not imply PDF readiness or artifact approval.
- Cover mixed states, the 13-question layout, baseline and generated edits,
  omitted passages, reload, rapid navigation, and a 390-pixel viewport.

Dependencies: [BUG-002](bug-002-classification-recovery.md) failure state and
[BUG-003](bug-003-validation-wording.md) wording binding. This owns action/count
consistency; [FEAT-002](../features/feat-002-preparation-progress.md) adds phase
and usage visibility without changing factual authority.
