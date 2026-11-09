# SL-FEAT-002: Calibrate accomplishment selection for frontend-focused fullstack roles

Priority: P2. Status: proposed extension. Triage: ready-for-agent.
Task Master: 64 (existing).

## User outcome and evidence

The resume demonstrates relevant cross-stack delivery near the top of each
employment entry while retaining a coherent frontend identity. Useful work
absent from the starting bullets can be selected without new unsupported
qualifiers or a long inventory of implementation tasks.

The [SentiLink draft](../../../sentilink-live-job-attempt-2026-11-08.md#4-generated-accomplishments-and-initial-checks)
found valuable lifecycle/API and analytics work, but placed those additions
fourth and fifth within Parable. The analytics bullet remained a feature list.
The summary required narrowing of a plural product claim, enterprise qualifier,
and senior-title question. These observations motivate calibration; they do not
prove one exact bullet order is universally wrong.

Extend [NetBox FEAT-004](../../netbox-followups/features/feat-004-accomplishment-selection.md)
using the existing
[approved calibration](../../../superpowers/specs/2026-11-05-accomplishment-calibration.md)
and [draft-first design](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md).
Do not introduce another mandatory confirmation gate for supported edits.

## Selection and writing contract

Add a sanitized fixture for a frontend-focused fullstack product role: React
interfaces, UI-facing APIs, testing, production support, and analytical product
work. Include several relevant supported accomplishments plus lower-relevance
editor/build activities, actual ownership boundaries, and uncertain qualifiers.

Rank complete accomplishments within each employer against substantive job
requirements. Evaluate whether lifecycle/API or analytics proof belongs in the
first two positions; a defensible alternative order with equally relevant proof
is acceptable. Company chronology remains intact. Do not rank by source count,
commit count, requested-but-absent keywords, or a predictive ATS score.

Lead with contribution and a recognizable capability, documented purpose, or
outcome. Retain useful technical scope; trim secondary feature enumeration
before dropping a distinct accomplishment. Combine only evidence-connected
work. Use singular delivery when only one product is supported; do not infer
enterprise scope, SDK membership, ownership, fraud expertise, or impact.
Use existing approved support or a conservative narrower formulation rather
than repeatedly asking optional enrichment questions.

Update [synthesis.ts](../../../../packages/core/src/jobs/synthesis.ts), captured
requirement/selection inputs, and fresh generation/reorder contracts as needed.
Version prompt/generation/checkpoint policy consistently. Old jobs remain
readable and are not automatically regenerated. Keep omissions reviewable and
restorable under the existing page budget and export checks.

## Acceptance and verification

- A quality rubric judges relevance, coherent contribution, scope, technical
  specificity, support, and readability. Do not assert one exact model sentence.
- Deterministic selection/reorder tests preserve original targets, avoid
  overlap with consolidation, and leave unrelated employment unchanged.
- Fixtures cover singular/plural, relationship/qualifier uncertainty, optional
  enrichment skipped, meaningful purpose without a measured result, and an
  important accomplishment absent from the starting resume.
- Relevant strengths become prominent; tightening removes secondary inventory
  without fabricating a result or substituting generic accomplishment prose.
- Evaluate the real one-page PDF and text together. Smaller fonts or margins
  alone do not establish successful content selection/readability.
- Any live calibration uses existing consent and preparation budgets, records
  changes and omissions, and stops before human PDF approval or submission.

Dependencies: retain Task 64's existing dependency on Task 54 and the approved
support/fallback contract. Use the skills contract in Task 66 if changing skills
operations; this feature does not reimplement skills editing or human facts.
