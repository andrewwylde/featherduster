# SL-BUG-002: Validate the actual effect of skills operations

Priority: P1. Status: implemented in local v0.3.0-rc.1. Task Master: 66.

## Problem and evidence

The [SentiLink generation](../../../sentilink-live-job-attempt-2026-11-08.md#6-reversed-skills-pruning-and-incomplete-change-descriptions)
said it removed provisional Docker support, but its `skills.prune` values
removed every other Delivery skill and left Docker alone. The application
followed its current remove-list contract. The generator produced the opposite
of the stated intent, and the proposal passed structural checks.

This is not an application inversion of an otherwise correct remove list.
Subset validation alone will not catch the example: all five wrong removals
exist in the original group. Free-text rationale cannot be a deterministic
source of mutation semantics.

## Synthetic reproduction

Start with this Delivery group and operation:

```json
{
  "before_skills": [
    "GitHub Actions", "Docker", "Kubernetes/Helm",
    "OpenTelemetry", "Datadog", "Cypress"
  ],
  "proposal": {
    "type": "skills.prune",
    "skills": [
      "GitHub Actions", "Kubernetes/Helm", "OpenTelemetry", "Datadog", "Cypress"
    ],
    "rationale": "Remove Docker."
  }
}
```

The applied candidate is `Delivery: Docker`. The intended result removes only
Docker. Private receipt: `25-initial-proposals.json`, operation
`delivery-skills`.

## Implementation scope

Inspect [schemas.ts](../../../../packages/core/src/tailoring/schemas.ts),
[context.ts](../../../../packages/core/src/tailoring/context.ts),
[validators.ts](../../../../packages/core/src/tailoring/validators.ts),
[apply.ts](../../../../packages/core/src/tailoring/apply.ts), and
[proposal transport](../../../../packages/core/src/jobs/proposal-transport.ts).

Keep legacy `skills.prune.skills` meaning **remove these skills**. For fresh
generation, require a structured before/result intent in addition to the
removal list, or an equivalent versioned contract. Bind before to the captured
group and verify that applying the removals produces the declared result.
Reject unknown removals, duplicates, additions disguised as reorder, mismatched
group targets, and inconsistent before/result lists before application.

Compute the displayed result from the actual mutation. Never substitute a
rationale for a list diff. A coherently wrong model choice can still pass
structural validation, so visible review and undo remain essential; implement
that surface in [SL-FEAT-001](../features/sl-feat-001-skills-review.md).

Update runner schema, adapters, prompt examples, proposal validation, and fresh
generation/checkpoint policy together. Old saved proposals remain readable and
retain their original semantics. Do not silently reinterpret or regenerate
them. Do not add new resume skills merely because a posting requests them.

## Acceptance and verification

- A fresh Docker-removal intent that declares the five remaining skills must
  reject the inverted removal list and accept `remove = [Docker]`.
- Valid remove/reorder operations apply and undo atomically against the captured
  original group, preserving unrelated groups and their order.
- Stale targets, unknown names, duplicates, case aliases, no-op removals, and
  overlapping operations have explicit deterministic outcomes.
- Removing a whole group requires explicit intent; an accidentally empty group
  is not silently presented as a successful incidental prune.
- Legacy lists retain their old remove semantics. Changing a draft invalidates
  current PDF approval without rewriting historical artifacts.
- Extend [tailoring tests](../../../../packages/core/tests/tailoring.test.ts),
  [proposal review tests](../../../../packages/core/tests/job-proposal-review.test.ts),
  and runner transport tests with before/result and inverse-list fixtures.

Dependencies: none. Pair with SL-FEAT-001 to review valid model choices.

## Resolution

Fresh Jobs and Tailor generation use `accomplishments-2` with required captured
before/result intent and explicit whole-group choice. Validation rejects the
inverted fixture and stale, unknown, duplicate, incomplete, or overlapping
effects. Model output cannot authorize overrides. New runs capture policy
before generation; recovery preserves trusted server policy and guards its
lineage. Existing legacy records retain their semantics without regeneration.

Actual runner, default-demo, automatic-repair, save/Apply/reload, recovery, and
undo regressions pass. The final build and 1,862-test suite pass, as do three
independent reviews. See the [release assessment](../../../releases/v0.3.0-rc.1-validation.md)
for evidence, publication status, and the pending local server restart.
