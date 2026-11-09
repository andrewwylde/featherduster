# SL-BUG-007: Stop operational writes refreshing unrelated workspace views

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 55 (existing).
The parent task retains its earlier high priority. This follow-up is P2.

## Problem and evidence

During the [SentiLink preparation window](../../../sentilink-live-job-attempt-2026-11-08.md#3-preparation-progress-and-navigation),
the Resume page completed 35 API responses in 45 seconds. These included five
evidence reads, three rubric-list reads, four gap-analysis reads, three corpus
reads, and three integrity reads, despite no user edits to those inputs.

This is a continuing observation after coalescing/topic changes. It does not
prove all requests came from one watcher path or caused a specific delay. The
earlier 80-response window used different work and is not a matched benchmark.
Private receipt: `14-api-observation.json`.

## Reproduction and diagnosis

Use a disposable workspace and a fake runner that writes preparation snapshots,
checkpoints, and lease/SQLite activity while a Resume view is mounted. Collect
SSE event topic/path, subscribed callback, API request purpose, and duration for
a fixed window. Include expected job/control polling separately from unrelated
workspace reads. Compare against a no-write control and genuine evidence edits.

Inspect [watcher.ts](../../../../packages/cli/src/watcher.ts),
[SSE fanout](../../../../packages/cli/src/server.ts),
[events.ts](../../../../packages/ui/src/api/events.ts),
[useLiveSync.ts](../../../../packages/ui/src/hooks/useLiveSync.ts),
[useDeskData.ts](../../../../packages/ui/src/hooks/useDeskData.ts), and hidden
evidence/rubric subscribers. Correlate sources before broad changes. `.sqlite3`
operational paths and artifact directories need examination alongside `.db`.

## Implementation scope

Classify events by meaningful user input versus operational state, route them
to affected topics, and preserve specific job updates. Unmounted/hidden views
must not refresh unrelated expensive data. Honor existing leading/trailing
single-flight behavior and cancellation where supported.

Operational generated exports need a dedicated classification policy. Do not
ignore whole directories that also contain user-editable resumes, evidence,
privacy rules, or corpus changes. Do not suppress integrity/tamper detection
of immutable artifacts; retain demand checks and a documented invalidation path
when operational-byte verification is relevant.

## Acceptance and verification

- Synthetic operational-only writes produce no evidence/rubric/corpus reloads
  without relevant input changes. Expected job progress/polling remains live.
- One user evidence edit updates affected views and integrity. Privacy, corpus,
  rename/delete, and source changes invalidate the appropriate current state.
- Bursts coalesce with bounded in-flight work and at most the required trailing
  refresh; reconnect recovers missed changes.
- Tests cover Windows paths, SQLite sidecars, snapshots, exports, and editable
  files. Extend [watcher tests](../../../../packages/cli/tests/watcher.test.ts)
  and UI subscription tests with deterministic event attribution.
- Repeat a matched load capture and report counts/latencies by purpose. Do not
  accept a lower raw count alone or set 35 as a universal performance threshold.

Dependencies: none. Extends existing NetBox BUG-005; no replacement watcher or
new polling architecture is required by this ticket.
