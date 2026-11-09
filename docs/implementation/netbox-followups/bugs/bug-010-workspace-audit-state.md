# BUG-010: Distinguish unknown workspace audit state from a clean job

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 60.

## Problem and evidence

The [live app](../../../netbox-live-job-attempt-2026-11-07.md) initially
displayed **0 Issues**, then **561 Issues** after auditing. The latter concerned
the whole career workspace and historical material, not 561 defects in the new
job. The header uses a zero fallback when no report exists, and Layout catches
fetch errors without exposing an unavailable audit state.

This is a misleading state/label defect, not a request to remove audit findings
or make unrelated source files pass automatically.

## Reproduction

1. Open a job while delaying the workspace integrity response.
2. Fail the request, retry it, and return a successful report with findings.
3. Repeat with a successful clean report and with a stale prior report.

Expected: unknown, checking, unavailable, stale, clean, and findings states are
distinct. The badge identifies its workspace scope; job blockers remain local.

## Implementation scope

Inspect
[DeskHeader.tsx](../../../../packages/ui/src/components/desk/DeskHeader.tsx),
[Layout.tsx](../../../../packages/ui/src/components/Layout.tsx), and
[IntegrityModal.tsx](../../../../packages/ui/src/components/IntegrityModal.tsx).

Carry explicit request state and last successful check time. Display **Workspace
audit** context on desktop and in the accessible mobile name. A request error
must not become Clean or zero findings. Retain an older report with a clear
stale label where useful. Keep the existing modal available to inspect real
findings.

Do not make the current job wait for remediation of unrelated historical files
unless an existing required validation rule actually depends on them. The job's
own readiness remains governed by its candidate, support, and export bindings.

## Acceptance and verification

- Zero findings appears only after a successful matching audit result.
- Failed/absent reports expose an appropriate state and retry action.
- A completed report identifies the workspace scope and checked time.
- Current-job facts and export blockers cannot be confused with workspace
  totals.
- Old findings remain inspectable; no integrity/privacy rule is weakened.
- Test initial loading, successful zero/nonzero reports, errors with/without a
  previous report, stale responses, and mobile accessible names.

Dependencies: none. Reuse refresh discipline from
[BUG-005](bug-005-live-refresh-storm.md) rather than adding audit polling.
