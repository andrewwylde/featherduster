# BUG-005: Stop operational file changes from refreshing the whole app

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 55.

## Problem and evidence

A 45-second [live observation](../../../netbox-live-job-attempt-2026-11-07.md)
completed 80 API responses while the Resume page was open. Requests repeatedly
loaded evidence, rubrics, corpus, integrity, and tailoring indexes. Many
requests were also aborted around navigation and preparation. These aborts are
not proof of independent backend exceptions.

Source inspection shows the watcher includes operational workspace directories,
emits each changed path separately, and broad live-sync callbacks reload global
datasets. That explains an amplification path; its exact latency contribution
has not been measured separately from rendering and artifact verification.

## Reproduction

1. Open a saved resume with normal event streaming and polling enabled.
2. Produce a burst of snapshot/checkpoint writes and worker lease updates in a
   disposable workspace without changing career evidence.
3. Count change events, relevant fetches, overlapping fetches, and aborts.
4. Edit real evidence, privacy rules, and a resume separately to test
   invalidation.

Expected: operational churn does not invalidate unrelated datasets. A meaningful
input change refreshes its consumers without losing the latest revision.

## Implementation scope

Inspect [watcher.ts](../../../../packages/cli/src/watcher.ts),
[server event delivery](../../../../packages/cli/src/server.ts),
[useLiveSync.ts](../../../../packages/ui/src/hooks/useLiveSync.ts),
[useDeskData.ts](../../../../packages/ui/src/hooks/useDeskData.ts), and
[Layout.tsx](../../../../packages/ui/src/components/Layout.tsx).

Classify operational SQLite sidecars, leases, temporary outputs, and job
artifacts separately from user-editable inputs. Keep job/corpus event delivery
for changes that legitimately affect the current screen. Coalesce bursts, scope
subscribers, and allow one fetch per dataset at a time with one trailing refresh
if necessary. Do not discard a newer invalidation while an older request is
running.

## Acceptance and verification

- Lease/sidecar/scratch changes cause no evidence/rubric/full-integrity
  refresh.
- A burst for one committed input revision produces one settled refresh per
  affected consumer, with no unbounded queue of overlapping fetches.
- Source, privacy, configuration, and user-resume edits still invalidate
  checks.
- Publication updates the current job/PDF without refreshing unrelated screens.
- Reconnect and missed-event recovery converge on current persisted revisions.
- Run a network-count browser scenario at the recorded 52-job scale. Record
  before/after traffic and health responsiveness without disabling live sync.
- Add watcher and hook tests for bursts, changes during fetch, unmount,
  reconnect, and Windows path separators. Keep existing API consumers
  compatible.

Dependencies: none. Keep [BUG-001](bug-001-correction-discovery.md) discovery
invalidation and [FEAT-002](../features/feat-002-preparation-progress.md)
progress updates scoped to the same relevant job/revision.
