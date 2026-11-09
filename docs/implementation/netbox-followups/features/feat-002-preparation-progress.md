# FEAT-002: Show preparation phase, elapsed time, and recorded usage

Priority: P2. Status: proposed implementation. Triage: ready-for-agent. Task
Master: 62.

## User outcome

Users can distinguish active generation, evidence checking, layout/export,
necessary input, and technical failure without opening a database or debugging a
renderer. A long-running operation has an understandable current phase and one
appropriate action. This implements visibility required by the approved
[draft-first design](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md).

## Evidence

The [live attempt](../../../netbox-live-job-attempt-2026-11-07.md) displayed
**Preparation claimed** while analysis, classification, brief generation, and
compile/verification ran. The final continuation lasted about three minutes and
39 seconds. The capture recorded Codex with an empty model field, and semantic
usage exposed counts/timing but no token or cost totals. Those observations do
not establish the actual default model or a monetary cost.

## Proposed experience

Use one primary status: **Preparing your resume**, **Checking support**,
**Rendering and checking the PDF**, **Needs your answer**, **Needs retry**, or
**Ready to review**, derived from the shared completion decision. Avoid invented
percentage completion and mandatory controls for internal pipeline stages.

Display phase start and elapsed time. Details can show current attempt,
completed checkpoints, active check operation, retry/failure reason, and
recorded usage. Keep generation calls, semantic calls, retries, and cancelled
dispatches clearly identified. Show tokens/cost as unavailable when not
recorded. An empty model field is a runner-default selection, not evidence of a
particular model version.

## Implementation scope and contracts

Project persisted attempt/checkpoint/semantic state through
[runtime.ts](../../../../packages/cli/src/jobs/runtime.ts),
[job schemas](../../../../packages/core/src/jobs/schemas.ts), and
[JobDetail.tsx](../../../../packages/ui/src/views/jobs/JobDetail.tsx). Only the
newest applicable operation may drive the phase. Progress payloads must not
expose worker fencing credentials, private prompts, or source bodies.

Use existing relevant-job events or bounded polling. Updating an elapsed clock
must not refetch workspace data each second. Reload and reconnect recover the
persisted phase. A lease expiry or process interruption becomes a recovery
state, not an indefinitely active spinner. Preserve stop/pause and existing
budgets.

## Acceptance and verification

- Generation, classification, compile, verification, and idle/failure scenarios
  each expose the correct primary phase with recorded timing.
- Supported facts do not imply an exported PDF; a PDF does not imply approval.
- Stop/pause, retry, superseded attempts, reload, and reconnect retain truthful
  state and do not reset budgets or elapsed history.
- Missing model/token/cost metadata is not guessed or represented as zero.
- Progress introduces no new model work and no broad refresh amplification.
- Browser tests use delayed fake runners/tools and confirm visible progression,
  actionable failure, and eventual current-PDF readiness on desktop and mobile.

Dependencies: [BUG-006](../bugs/bug-006-review-state.md) owns the shared action
and count projection. Coordinate transport with
[BUG-005](../bugs/bug-005-live-refresh-storm.md). Broader draft-first
activation still requires its approved end-to-end acceptance gate.
