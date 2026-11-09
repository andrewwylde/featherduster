# SL-FEAT-001: Review and edit actual skills-list changes

Priority: P1. Status: proposed. Triage: ready-for-agent. Task Master: 67.

## User outcome and evidence

Users can see which skills a generated operation removes, retains, or reorders,
then correct it through the resume review. A blank text diff and an inaccurate
rationale cannot stand in for that list.

In the [SentiLink skills mismatch](../../../sentilink-live-job-attempt-2026-11-08.md#6-reversed-skills-pruning-and-incomplete-change-descriptions),
the intended Docker removal left only Docker. Changes showed Before as new
content and After empty; the generic editor exposed wording rather than a
skills-list editor. Undo rescued the original list, but could not express the
desired corrected prune from those controls. Final prominent Changes also
omitted the valid skills reorder.

## Proposed behavior

Use the existing complete-resume and Changes/Evidence surfaces. For each skills
group affected by a proposal, display the captured list and exact current
result, with explicit removed and reordered items. Label the action plainly,
such as **Remove skills** or **Reorder skills**, instead of Rewrite/new content.
The applied candidate is the preview authority; rationale is supplemental.

Provide accessible controls to remove/restore existing entries and reorder
them. On desktop and mobile, show full names and group labels and offer keyboard
reordering. Support checkbox/select plus move controls; do not require drag
interaction. Empty-group removal requires an explicit choice.

This feature does not add job-description keywords automatically. Adding a new
skill, if offered at all, must use the existing evidence/scoped-support gates.
Display existing assertions honestly; absence of a new question is not proof
that every inherited skill was independently verified. Writing preferences and
human factual confirmations remain separate actions.

## Saving and artifact contract

Use [SL-BUG-002](../bugs/sl-bug-002-skills-operation-contract.md)'s validated
operation contract and the existing mixed-save/recovery path. Bind changes to
input, review revision, group identity, and original membership/order. Save
skills and wording atomically when edited together, reject stale/overlapping
targets, and preserve unrelated text. Coordinate recovery with SL-BUG-004.

Extend [JobProposalEditor.tsx](../../../../packages/ui/src/views/jobs/JobProposalEditor.tsx),
[ResumeDraftSurface.tsx](../../../../packages/ui/src/views/jobs/ResumeDraftSurface.tsx),
and [JobArtifactChanges.tsx](../../../../packages/ui/src/views/jobs/JobArtifactChanges.tsx).
Final PDF Changes includes actual list diffs, including skills-only edits and
reorders, bound to the displayed artifact. Undo forks or updates a working
draft, rechecks affected content/page fit, and requires fresh approval.

## Acceptance and verification

- The six-item Docker fixture shows all five retained entries and Docker as
  removed. An inverted list displays its actual effect before saving.
- A valid reorder is visible as order change, never empty After or new content.
- Users can correct that remove list and save a mixed wording/skills revision
  without using JSON, source files, or a second review pipeline.
- Keyboard and 390px mobile controls are usable; no page overflow or hidden
  removals. A stale target cannot partially update one group.
- Reload retains newer unsaved edits and accurately identifies saved content.
- The real one-page export contains exactly the reviewed lists. Its Changes and
  undo refer to that version; historical PDFs and approvals remain immutable.

Dependencies: Task 66 (SL-BUG-002) and Task 63 (SL-BUG-004/existing mixed-save
work). Coordinate passage cards with Task 57; its implementation can proceed
independently.
