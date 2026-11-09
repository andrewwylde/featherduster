# BUG-007: Include inherited-wording corrections in final PDF changes

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 57.

## Problem and evidence

The final NetBox change summary listed generated edits and three omissions, but
did not prominently show job-local corrections to the inherited accessibility
and identity bullets. Its full comparison used an already-corrected base as
"before." The original captured wording remained only in correction history. See
the [final review evidence](../../../netbox-live-job-attempt-2026-11-07.md).

A user approving the displayed PDF needs a complete summary of meaningful
changes, including corrections made through a different editor.

## Reproduction

1. Capture a resume with two original bullets and generate a separate rewrite.
2. Narrow both inherited bullets using job-local starting-resume corrections.
3. Save/recheck and allow a PDF to be published.
4. Inspect Changes and the full before/after comparison, then edit a new draft.

Expected: the published PDF's change summary includes all substantive reductions
from the original snapshot. A pending draft never changes the old PDF's summary.

## Implementation scope

Inspect
[JobArtifactChanges.tsx](../../../../packages/ui/src/views/jobs/JobArtifactChanges.tsx), [artifacts.ts](../../../../packages/cli/src/jobs/artifacts.ts),
[proposal-review.ts](../../../../packages/core/src/jobs/proposal-review.ts),
and [restoration.ts](../../../../packages/core/src/jobs/restoration.ts).

Retain distinguishable layers: original captured resume, job-local base
corrections, generated operations, subsequent edits, and published candidate.
Present one useful original-to-final comparison per passage with expandable
history and provenance. Avoid duplicate entries for intermediate corrections. Do
not label an agent/system wording edit as a human factual confirmation.

Bind the visible summary to the artifact's candidate and source/review
revisions. If its approval binding needs additional metadata, version it
compatibly. Reading old artifacts must not rewrite them or manufacture
historical approval content.

## Acceptance and verification

- Both inherited corrections and generated edits appear before final approval.
- Original-before text comes from the immutable capture, not a corrected
  overlay.
- Multiple corrections show original-to-final wording and retain exact history.
- Pending edits cannot alter the displayed historical PDF or its summary.
- Undo/restore preserves unrelated wording, forks a new draft, and requires
  fresh checks and approval. Handle stale original targets explicitly.
- Legacy artifacts remain readable; missing comparison provenance is stated.
- Add core/service/UI coverage and a browser scenario with two inherited
  corrections plus generated edits. Verify the final PDF and summary together.

Dependencies: [BUG-003](bug-003-validation-wording.md). Coordinate the revision
contract with [FEAT-003](../features/feat-003-mixed-edit-saving.md).
