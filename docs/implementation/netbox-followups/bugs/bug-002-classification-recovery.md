# BUG-002: Explain and recover a failed classification batch

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 52.

## Problem and evidence

The [live review](../../../netbox-live-job-attempt-2026-11-07.md) stopped after
the third semantic call with **Classification returned invalid structured
data**. Nine claims had support, two required answers, and eight were
unavailable. The error did not identify the failed batch or invalid field. The
exact malformed field is unknown; this report does not assume a particular
schema defect.

Earlier successful batches remained persisted. Preserve that behavior. A later
check completed the inventory, establishing that a technical failure had left
otherwise checkable work unresolved.

## Reproduction

1. Submit at least 16 passages in four-passage batches using a fake runner.
2. Return valid support for the first two batches and malformed structured
   output for the third. Do not return fabricated factual answers for later
   passages.
3. Open the review, reload it, and retry the failed check.

Expected: show a technical exception naming the affected passages, retain prior
support, and retry only failed or unchecked work whose bindings are still
current. A technical failure must not become a request for human factual
confirmation.

## Implementation scope

Inspect
[semantic-classifier.ts](../../../../packages/cli/src/jobs/semantic-classifier.ts), [semantic-service.ts](../../../../packages/cli/src/jobs/semantic-service.ts),
[semantic-repository.ts](../../../../packages/cli/src/jobs/semantic-repository.ts), and [JobFacts.tsx](../../../../packages/ui/src/views/jobs/JobFacts.tsx).

Persist a structured failure code, stage, batch/subject identifiers, and a safe
schema-path diagnostic. Distinguish invalid wire shape, invalid quotation/span,
timeout, cancellation, and stale result. Keep private raw diagnostics local and
redacted; do not expose prompts, answers, credentials, or source bodies in
errors.

Use existing retry admission, idempotency, consent, and budget accounting. Do
not silently retry malformed output indefinitely or reset counters on reload. A
retry may recompute a successful passage only if its candidate/source/policy
binding changed. Partial output from a malformed batch grants no support.

## Acceptance and verification

- Successful batches survive failure and reload without redundant dispatch.
- Failed/unchecked passages expose **Needs retry** and one appropriate action.
- The user can distinguish failed batches from actual factual questions.
- A safe diagnostic identifies the validation stage and field path when known.
- Retry respects the original limits and cannot publish stale or incomplete
  work.
- A failed retry retains edits and explains the next available recovery action.
- Tests cover malformed shape, invalid spans, cancellation, stale revisions,
  exhausted budget, reload, and independent support in earlier batches.

Dependencies: none. [BUG-006](bug-006-review-state.md) consumes the resulting
state; the approved
[draft-first design](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md)
still controls whether supported fallback can avoid interrupting the user.
