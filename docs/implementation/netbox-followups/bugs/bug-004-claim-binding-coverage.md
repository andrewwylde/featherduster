# BUG-004: Generate complete claim bindings and identify coverage gaps

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 54.

## Problem and evidence

The generated NetBox summary bound its factual phrases but omitted connective
text such as **Experience spans**. The deterministic validator requires every
letter and number to be covered. The summary therefore failed with **Map every
generated claim and qualifier to supporting evidence**, even though most clauses
had semantic support. See the
[walkthrough](../../../netbox-live-job-attempt-2026-11-07.md) and its private
`generated-proposals.json` receipt.

The generation contract and error presentation do not make this requirement
actionable. This is not evidence that qualifiers can safely be ignored.

## Reproduction and expected behavior

Generate a summary with separately bound phrases following **Experience spans**,
and leave the connective unbound. Validate it and open its exception. The runner
must instead emit coverage accepted by the deterministic contract, and any
remaining error must identify the exact uncovered span.

## Implementation scope

Inspect [synthesis.ts](../../../../packages/core/src/jobs/synthesis.ts),
[tailoring schemas](../../../../packages/core/src/tailoring/schemas.ts),
[validators.ts](../../../../packages/core/src/tailoring/validators.ts), and
[JobProposalEditor.tsx](../../../../packages/ui/src/views/jobs/JobProposalEditor.tsx).

Keep strict coverage as the initial implementation choice. Teach generation to
bind complete sentences or complete adjoining clauses, including connective
language, with all relevant source IDs. Overlapping bindings can retain detailed
support. Sentence coverage is structural metadata, not proof of a relationship:
the semantic checker must still validate every assertion and qualifier.

Return uncovered ranges and a concise excerpt in the issue payload. The UI
offers wording/evidence repair without asking the user to acknowledge internal
IDs. If mechanical binding completion is added, it can attach only existing
adjacent sources and must trigger normal claim validation. It cannot invent
support.

Update the generation policy/contracts together. Historical generations remain
readable and are not silently regenerated or granted new factual authority.

## Acceptance and verification

- A fully bound multi-source sentence passes structural coverage validation.
- A gap reports the precise unchecked wording, rather than a generic
  instruction.
- Numbers, negation, ownership, causation, relationships, and singular/plural
  qualifiers remain required. Do not solve this with a broad stop-word
  exemption.
- Invalid citations, changed wording, or fabricated quotations still block.
- The editor's ordinary wording-change path clears stale bindings and rechecks.
- Test the recorded summary shape, Unicode offsets, repeated substrings,
  overlapping bindings, unsupported added qualifiers, and legacy proposals.

Dependencies: none. Coordinate exact-span transport with
[BUG-003](bug-003-validation-wording.md); this issue owns binding generation
and coverage diagnostics, not the general review projection.
