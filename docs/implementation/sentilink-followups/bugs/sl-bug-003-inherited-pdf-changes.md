# SL-BUG-003: Include inherited-only corrections in prominent PDF changes

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 57 (existing).

## Problem and evidence

This is the remaining acceptance gap in
[NetBox BUG-007](../../netbox-followups/bugs/bug-007-final-correction-history.md).
The [SentiLink final review](../../../sentilink-live-job-attempt-2026-11-08.md#7-automatic-pdf-continuation-and-final-review)
improved original-before text and persisted correction traces. Its prominent
Changes list still omitted two corrections to inherited bullets, because that
list iterates active generated proposals. One-stage inherited-only traces have
no corresponding proposal card.

The saved payload contains the corrected accessibility and identity passages.
The complete before/after drawer displays them. The defect concerns discoverable
final review, not loss of the underlying correction history.

## Reproduction

1. Capture a synthetic resume with two inherited bullets and a summary.
2. Generate only a summary rewrite.
3. Narrow inherited bullet A from an audit outcome to the work performed, and
   remove an unsupported package qualifier from bullet B.
4. Finalize a PDF with both corrections and the summary rewrite.
5. Inspect the default Changes list before opening the complete comparison.

Expected: each distinct substantive passage change appears once in that list,
even when it has no generated proposal and only one correction stage.

## Implementation scope

Use the artifact-bound traces already exposed by
[JobArtifactChanges.tsx](../../../../packages/ui/src/views/jobs/JobArtifactChanges.tsx)
and [restoration.ts](../../../../packages/core/src/jobs/restoration.ts), which
implements `computeArtifactChanges`.
Retain original capture, correction history, and final published text.

Build list membership from changed passages, then attach matching proposal
metadata, rather than deriving membership exclusively from active proposals.
Deduplicate a passage that has both corrections and a generated rewrite.
Show original-to-final before/after and expandable intermediate stages. A
reverted/no-op correction does not need a substantive-change card.

Give inherited-only entries a real revision-bound undo action. It must fork or
update the existing working draft through the established restoration path,
preserve unrelated edits, run affected checks, and require fresh PDF approval.
Do not mutate the immutable current artifact or guess missing legacy provenance.
Skills list diffs are owned by SL-FEAT-001, not duplicated here.

## Acceptance and verification

- Two inherited-only corrections and one generated rewrite are visible before
  approval without opening the full comparison drawer.
- One-stage traces render. A corrected-and-rewritten passage renders once with
  all stages accessible. Original before text remains the immutable capture.
- Pending drafts and historical selection never relabel the displayed PDF's
  summary. Stale undo targets fail without partial mutation.
- Undo one inherited correction preserves the other and the generated rewrite;
  the new PDF requires fresh approval. Use synthetic approval events only.
- Extend [artifact tests](../../../../packages/cli/tests/job-artifacts.test.ts)
  and [accomplishment UI tests](../../../../packages/ui/tests/accomplishment-review.test.tsx).
  Browser acceptance inspects the default panel and the resulting PDF together.

Dependencies: retain Task 57's existing dependency on Task 53. The necessary
trace data already exists; do not rebuild the entire comparison pipeline.
