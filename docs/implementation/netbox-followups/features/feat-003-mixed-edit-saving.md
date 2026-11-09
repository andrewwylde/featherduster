# FEAT-003: Save mixed wording edits together before checking

Priority: P1. Status: proposed implementation. Triage: ready-for-agent. Task
Master: 63.

## User outcome and evidence

Users can revise generated and inherited passages as one coherent draft change,
see reliable saving feedback, and let the app check the newest saved content.
They do not manage separate save/check/continue pipelines for each passage.

In the [walkthrough](../../../netbox-live-job-attempt-2026-11-07.md), generated
wording used **Save draft**, while inherited wording required separate **Save
starting resume for this job** actions. Sequential saves could initiate or
supersede checks while other corrections were still being entered.

The approved
[draft-first specification](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md)
already requires automatic wording saving. This feature is its concrete
mixed-edit implementation seam, not a competing manual-save design.

## Proposed behavior

Coalesce a typing burst across both kinds of passage into one job-local
revision. Show **Saving**, **Saved**, **Checking**, and a local failure/retry
distinctly. Persist local recovery data until the server acknowledges the exact
submitted revision. New edits made during an in-flight request remain a newer
local version.

Start affected checks after a coherent save, and publish a fresh PDF when all
required decisions pass. A previous PDF stays identified as an earlier version.
Do not ask users to confirm factual truth merely to commit a wording edit.

## Mutation and validation contract

Extend the existing
[proposal save service](../../../../packages/cli/src/jobs/proposal-service.ts)
and
[proposal review contracts](../../../../packages/core/src/jobs/proposal-review.ts)
to admit generated patches and captured-base corrections together. Include input
fingerprint, expected job/review revision, original targets/text, and
idempotency. Reject overlapping or stale operations atomically; do not partially
apply a batch.

Share client recovery/save coordination between
[JobProposalReview.tsx](../../../../packages/ui/src/views/jobs/JobProposalReview.tsx)
and
[JobStartingResumeCorrection.tsx](../../../../packages/ui/src/views/jobs/JobStartingResumeCorrection.tsx). Fence old checks against the committed candidate/support revision. Checking
the latest content must not trigger another resume generation or reset spending
limits.

Factual answers remain separate: typing/autosaving an answer never confirms it,
creates human support, or shares it across jobs. Retain explicit fact
confirmation, scope selection, provenance, and final artifact approval.

## Acceptance and verification

- Two inherited corrections and a generated rewrite commit as one revision.
- One stale target rejects the whole mutation and retains every local edit.
- A lost response/idempotent retry cannot duplicate the revision or dispatch.
- Rapid typing and edits during saving preserve the newest text across
  navigation and reload; unacknowledged browser content is not called
  server-saved.
- Unaffected wording/support remains intact. Changed claims are revalidated.
- Superseded checks cannot publish an older PDF after a newer saved edit.
- Changed PDF content requires fresh approval; no real user answers or artifact
  approvals are synthesized in tests.
- Core/service/UI tests cover conflicts and recovery; browser verification
  mixes both edit types, reloads during saving/checking, and verifies the
  resulting PDF.

Dependencies: [BUG-003](../bugs/bug-003-validation-wording.md) and
[BUG-006](../bugs/bug-006-review-state.md). Coordinate final history with
[BUG-007](../bugs/bug-007-final-correction-history.md).
