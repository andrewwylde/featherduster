# SL-BUG-004: Do not restore acknowledged mixed edits as unsaved work

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 63 (existing).

## Problem and evidence

The [SentiLink mixed save](../../../sentilink-live-job-attempt-2026-11-08.md#5-mixed-saving-recovery-and-conservative-corrections)
committed a generated summary and inherited accessibility edit in revision two.
Both survived reload. The browser then restored an older local proposal draft,
called it unsaved, and required reconciliation before enabling editing/undo.
The legitimate stale-write guard worked; acknowledged edits incorrectly entered
that recovery path.

The source scans revision-suffixed recovery keys and chooses a recent entry;
mixed save advances its revision key without explicitly retiring every
acknowledged older entry. This supports a likely mechanism. The walkthrough
did not capture the complete localStorage key timeline; reproduce it before
claiming one exact race as the sole cause.

## Reproduction

1. Seed revision one of a synthetic review and matching browser recovery keys.
2. Enter a generated summary edit and an inherited bullet edit.
3. Let mixed autosave acknowledge revision two; assert both server texts.
4. Reload while affected checks run, then deliver their completed result.
5. Observe restored local patches, dirty/stale labels, and disabled controls.

Expected: acknowledged content stays Saved. Only genuinely newer local work is
recovered as unsaved. Genuine concurrent changes still require reconciliation.

## Implementation scope

Inspect [JobProposalReview.tsx](../../../../packages/ui/src/views/jobs/JobProposalReview.tsx)
and [JobStartingResumeCorrection.tsx](../../../../packages/ui/src/views/jobs/JobStartingResumeCorrection.tsx).
Use the existing atomic mixed mutation and revision/idempotency checks.

Associate recovery entries with the job, generation, review, input binding,
base revision, and a local edit sequence. On acknowledgment, retire only the
submitted edit generation across its old keys. Compare restored patches with
acknowledged server content before calling them new work. A saved semantic
result can update validation without making unchanged wording dirty.

Never clear all keys sharing a prefix indiscriminately. New typing during an
in-flight save, another tab's later work, source edits, pending groundings, and
unacknowledged factual answers must remain recoverable. Preserve old recovery
formats through a conservative reader/migration. Cleanup failure must not turn
a successful server commit into a failed save or lose new text.

## Acceptance and verification

- Save both edit types, reload during checking, and finish checking: texts and
  revision survive with no false Unsaved or reconciliation requirement.
- Lost acknowledgment and idempotent retry retain safe recovery without
  duplicating mutations or dispatching extra model generations.
- New edits made during saving remain dirty and recoverable after the older
  request succeeds. Newer keys survive cleanup.
- A genuine second-tab conflict still rejects stale writes atomically and
  offers reconciliation without changing unrelated wording.
- Legacy keys, unavailable storage, malformed recovery entries, navigation,
  reload, and changed input/generation bindings have explicit safe behavior.
- Extend [proposal UI tests](../../../../packages/ui/tests/job-proposal-review.test.tsx)
  and [service tests](../../../../packages/cli/tests/job-proposal-service.test.ts).
  The browser receipt includes the acknowledged revision and reload state.

Dependencies: retain Task 63's existing dependencies on Tasks 53 and 56. This
completes recovery within the existing mixed-save feature, not another editor.
