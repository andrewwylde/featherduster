# FEAT-004: Prioritize relevant accomplishments and narrow unsupported scope

Priority: P2. Status: proposed implementation. Triage: ready-for-agent. Task
Master: 64.

## User outcome

The first accomplishments a hiring manager reads demonstrate the target role's
most important supported strengths. Relevant work absent from the starting
resume can be selected. Related work reads as a delivered capability;
unsupported relationships and outcomes are narrowed without turning routine
tailoring into a mandatory fact interview.

## Evidence and calibration

The [NetBox generation](../../../netbox-live-job-attempt-2026-11-07.md)
discovered visualization, connector-management, Vite, and test-isolation work.
However, Time Spend visualization remained fifth at Parable, and Vite work
remained fourth at Kong. Some additions read as long feature inventories. An
authoring rewrite also implied an unsupported relationship between independently
documented components. Later checking caught publishing/consuming distinctions,
audit-outcome claims, and an unsupported SDK plural introduced during editing.

Reuse the accepted
[accomplishment calibration](../../../superpowers/specs/2026-11-05-accomplishment-calibration.md), including the Tailscale reference and confirmed fullstack example. The
approved
[draft-first design](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md)
defines support for the starting resume and when interruption is necessary.
These documents remain controlling product decisions.

## Selection and writing behavior

Rank supported accomplishments within each employment experience against the
posting's substantive requirements. Preserve truthful chronology and
contribution. For the recorded frontend-observability fixture, give
visualization/drill-down work prominence at Parable and build/testing work
prominence at Kong. A different job can produce different selections and order.

Lead with a recognizable capability, architectural change, or documented
purpose. Keep meaningful technical specificity. Combine activities only when
evidence or compatible factual support establishes their relationship. Source
volume and commit counts are not impact. Never invent adoption, scale,
causation, metrics, an audit pass, or plural deliveries from a single supported
example.

When a new qualifier lacks support, prefer supported narrower wording, a
different accomplishment, or a recorded omission. Ask only a material unresolved
question that cannot be handled by the approved fallback policy. Optional
enrichment does not block an otherwise usable supported PDF.

## Implementation boundaries

Update [synthesis.ts](../../../../packages/core/src/jobs/synthesis.ts),
captured requirement/evidence selection, and the existing preparation/repair
policy. Emit original-index reorder operations without overlapping atomic
consolidations. Keep claim bindings, rationale, omitted-content restoration, and
existing budgets. Version fresh generation policy and checkpoints together; old
jobs remain readable.

## Acceptance and verification

- The fixture elevates its strongest relevant supported examples without adding
  required-but-unproven technologies or pretending to have fleet-scale
  experience.
- Meaningful scope survives tightening; distinct unrelated work is not merged.
- Singular/plural, purpose/outcome, SDK publication/consumption, and
  audit-remediation cases require appropriate support. Missing optional context
  permits fallback.
- Omitted material is reviewable/restorable; page fit uses real export checks
  and accepted readability limits, not just a character ceiling or smaller
  fonts.
- Review quality using a rubric for clarity, relevance, specificity, and
  support. Do not require one exact model sentence or claim a predictive ATS
  score.
- Test ranking/reorder contracts deterministically and calibrate a fresh real
  generation with existing consent and budgets when implementation is ready.

Dependencies: [BUG-004](../bugs/bug-004-claim-binding-coverage.md) and the
approved draft-first support/repair contract. Existing employment support is
tracked under [FEAT-005](feat-005-employment-facts.md), not reimplemented in
this feature.
