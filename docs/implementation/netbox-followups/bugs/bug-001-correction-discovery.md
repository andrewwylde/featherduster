# BUG-001: Bound shared-correction discovery work

Priority: P1 follow-up; original outage was P0. Status: mitigated locally,
follow-up open. Triage: ready-for-agent. Task Master: 51.

## Problem and evidence

Opening Jobs triggered historical artifact verification even when no shared
corrections existed. In the
[live walkthrough](../../../netbox-live-job-attempt-2026-11-07.md), 52 saved
jobs, 37 resume-ready jobs, and four ordinary confirmations produced **Host
unavailable**. An isolated correction-discovery request exceeded five seconds.
Restarting did not resolve the problem.

The November 7 guard now returns an empty job list when there are no
corrections. The existing five-test integration suite passed. Do not report this
case as an unfixed outage or remove that guard. A later request under load took
2,579 ms; the wider performance problem is not proven solved.

## Reproduction and expected behavior

1. Build a disposable workspace with 52 jobs and 37 historical PDF artifacts.
2. Add four confirmations with no superseding corrections. Open Jobs and
   request `/api/jobs/clarification-updates`.
3. Compare the historical implementation with the guarded implementation.
4. Introduce one genuine correction affecting one draft and repeat.

No-correction discovery must avoid job and artifact enumeration. With actual
corrections, discover possible matches from lightweight work/fact metadata
before verifying affected content. Unrelated historical PDFs must not be eagerly
opened.

## Implementation scope

Start with
[clarification-updates.ts](../../../../packages/cli/src/jobs/clarification-updates.ts)
and
[SharedFactUpdates.tsx](../../../../packages/ui/src/views/jobs/SharedFactUpdates.tsx). Measure matching-work discovery, filesystem reads, response time, and
event-loop responsiveness. Choose bounded or incremental discovery if matching
cannot finish within the normal request lifetime. Expose incomplete discovery
explicitly.

Keep corpus revision fencing, exact claim matching, correction chains, selected
updates, and undo. Verify affected artifacts before approving or reusing them;
performance work must not bypass integrity checks.

## Acceptance and verification

- No-correction discovery returns the current corpus revision and zero jobs
  without calling job listing, semantic context, or artifact verification.
- A correction identifies all matching affected drafts and excludes unrelated
  work. Discovery does not read unrelated PDF bytes.
- Changing a draft or corpus revision invalidates stale discovery results.
- Discovery performs no model calls, writes, generation, or artifact approval.
- A reproducible 52-job fixture records filesystem work and health-request
  latency before and after. Publish measurements, not an unsupported latency
  guarantee.
- Extend
  [shared clarification tests](../../../../packages/cli/tests/shared-clarification-workflow.test.ts)
  and verify the Jobs screen while discovery runs.

Dependencies: none. Coordinate invalidation with
[BUG-005](bug-005-live-refresh-storm.md).
