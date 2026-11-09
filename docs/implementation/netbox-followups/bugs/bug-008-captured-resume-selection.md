# BUG-008: Show the resolved starting resume and captured inputs

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 59.

## Problem and evidence

The [walkthrough's Inputs page](../../../netbox-live-job-attempt-2026-11-07.md)
showed **Select a saved starting resume** before and during preparation. Capture
used the intended master resume through the backend's first-template fallback.
The saved job still had null resume/template/runner selectors, so those fields
did not describe the concrete captured inputs.

The current input component also contains a client fallback. Reproduce the
observed served behavior and record build identity before assigning the defect
to that expression; a screenshot alone does not establish its exact cause.

## Reproduction

1. Create a job with null selectors and multiple saved templates.
2. Open Inputs with a delayed resume-list response. Start tailoring from
   Posting.
3. Return to Inputs and compare its display with the captured resume
   fingerprint.
4. Change a current selection after a PDF exists and inspect the old PDF's
   inputs.

Expected: show what the next capture will select and what the active attempt/PDF
actually used. Loading, an unavailable choice, and an implicit default differ.

## Implementation scope

Inspect
[JobInputReview.tsx](../../../../packages/ui/src/views/jobs/JobInputReview.tsx), [runtime input capture](../../../../packages/cli/src/jobs/runtime.ts),
[artifact capture](../../../../packages/cli/src/jobs/artifacts.ts), and
[job schemas](../../../../packages/core/src/jobs/schemas.ts).

Resolve defaults consistently and include a concrete resume identity/path and
fingerprint in new capture metadata. Display the resolved template, page budget,
and recorded runner configuration too. An empty recorded model remains "runner
default / not recorded" unless the runner supplies its actual model identity.

Expose current selections separately from captured inputs. Do not mutate a
historical snapshot, automatically regenerate on read, or silently swap missing
resumes. Old captures can use verified snapshot metadata without inventing a
historical selector identity.

## Acceptance and verification

- Null selectors resolve visibly to the same resume used by the backend.
- Delayed loading never looks like an empty account or a confirmed selection.
- Capture failure preserves the last saved draft and gives an input action.
- Current changes do not relabel the inputs used by an existing PDF.
- Reload retains explicit selection and captured identity correctly.
- Duplicate legacy IDs cannot be silently resolved to the first file.
- Cover fallback, explicit choice, loading, deleted/moved files, old captures,
  and a current selection that differs from the published artifact.

Dependencies: [BUG-009](bug-009-resume-identities.md) for unique new identities.
Coordinate model/phase presentation with
[FEAT-002](../features/feat-002-preparation-progress.md).
