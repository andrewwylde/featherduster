# Accomplishment synthesis calibration

Status: the writing example and implementation plan were confirmed by the user on November 5, 2026. In a separate factual answer, the user confirmed that the configuration UI used the recorded tenant-scoped admin APIs as part of the same workflow. This resolves the real-evidence check's relationship question; it does not approve a PDF.

## Accepted reference

The accepted reference is `C:/Users/drewk/career/docs/tailscale-frontend-accomplishment-review.md` (November 2, revision 4, accepted with “Good enough”). Its standard is a recognizable delivered capability, architectural change, or supported consequence, rather than grouped implementation steps. Valid citations and technical specificity alone do not establish accomplishment quality. Previously accepted wording is not mandatory selection for every job.

The accepted API-contract example leads with consistent error handling across recorded domains and its shared SDK/UI contract. The accepted authoring example combines source editing with live query inspection while excluding unrelated runtime work. The BFF/state-machine inventory was set aside because the available evidence did not establish one coherent system-level story.

## Proposed fullstack/product example

Target: fullstack/product engineering. Employer: Parable. These source entries were read directly from `C:/Users/drewk/career/companies/parable/evidence/evidence-ledger.md` on November 5, 2026. This document does not change that ledger.

Before (source activities, not previously accepted resume wording):

- Implemented admin connector CRUD, tenant attachment/removal, query endpoints, and tenant-scoped connector configuration. (`ev-022`)
- Shipped the vendor-catalog and connector-configuration UI with validating end-to-end coverage. (`ev-023`)
- Discovered and resolved a malformed-configuration incident, wrote its summary, and added write-time validation at the admin API boundary. Discovery and resolution are explicitly human-confirmed. (`ev-026`)

Proposed accomplishment:

> Built tenant-scoped connector setup across admin APIs and configuration UI, with write-time validation to reject malformed configurations.

### Claim bindings

| Claim | Support | Boundary |
| --- | --- | --- |
| Built tenant-scoped connector setup | ev-022: admin CRUD, tenant attachment/removal, scoped configuration | Does not claim ownership of the entire connector platform |
| Across admin APIs and configuration UI | ev-022 and ev-023, plus the user's explicit workflow confirmation below | Does not infer a language/framework from surrounding infrastructure |
| Write-time validation to reject malformed configurations | ev-026: malformed schemas through admin API; write-time integrity validation | Describes the validation purpose; no measured incident reduction or recurrence claim |

These entries describe connector work in the same employment experience. The user has now established the API/UI workflow relationship, so combining them preserves the supported backend/UI breadth and validation boundary. UI work can also be selected when absent from the starting resume.

### Factual confirmation

Provenance: the user's direct reply in this implementation conversation, November 5, 2026. The exact question was:

> The real-evidence check supports the connector APIs, UI, and validation individually, but asks whether they formed one workflow. Did the connector configuration UI use those admin APIs for tenant-scoped connector setup?

Exact answer:

> Yes, they were the same workflow.

This answer supports the relationship between `ev-022` and `ev-023` for the claim “Built tenant-scoped connector setup across admin APIs and configuration UI.” It adds no ownership, adoption, performance metric, or incident-reduction claim. Machine evidence results remain historical records; this is separate human factual support. The evidence ledger is unchanged.

Do not join database migration tooling (`ev-029`) into this accomplishment merely because it also concerns backend work. Do not add onboarding speed, customer adoption, revenue, reliability percentages, or whole-platform ownership. Do not count source changes as performance metrics.

An optional enrichment question is: “Who used this connector-setup workflow, and what did it let them do that they could not do before?” Skipping it retains the supported accomplishment above. Any stronger adoption or consequence claim requires an answer with the appropriate provenance.

## Implementation acceptance cases

- Consolidation binds to all original source bullets and captured inputs, remains within one experience, and can be undone as one operation.
- New evidence may support additions absent from the starting resume, with claim-level bindings in the job draft.
- Missing optional context does not block conservative supported wording.
- Unrelated work is selected separately or omitted, never merged into invented scope.
- Corrections and explicit style preferences are persisted separately from the evidence ledger and from final PDF approval.
- Final review exposes consolidations, additions, omissions, and restoration alongside the complete draft.

## Existing local work

At inspection, uncommitted changes existed in the Career Signature layout/template/renderer, jobs list, proposal/factual review UI, starting-resume editor, and UI/layout tests. These edits were preserved and extended. Generation changes followed the user's confirmation.

## Baseline verification and implementation map

Baseline command: `npm test -- packages/core/tests/career-layout.test.ts packages/core/tests/job-proposal-review.test.ts packages/cli/tests/job-proposal-service.test.ts packages/cli/tests/job-proposal-learning.test.ts packages/ui/tests/resume-review-queue-model.test.ts packages/ui/tests/job-proposal-review.test.tsx packages/ui/tests/jobs-ui.test.tsx`.

Result: 101 passed, 4 failed across 7 files. All failures were in `packages/ui/tests/job-proposal-review.test.tsx`, before any implementation changes:

- opens and dismisses the passage drawer without saving or starting preparation
- explains the next correction and keeps optional input refresh secondary
- groups blockers by whether they belong to generated edits or the starting resume
- rejects and restores inclusion without teaching a capability

The reported assertions concern labels/explanatory text changed in the existing uncommitted review work (including `All Passages` versus `All passages`). Reconcile their behavior assertions as part of the review implementation.

Relevant implementation boundaries:

- `packages/core/src/tailoring/schemas.ts`: existing proposal types/targets; add compatible consolidation and claim-binding contracts.
- `packages/core/src/tailoring/apply.ts`: application against original bullet indices; extend atomic consolidation and restoration.
- `packages/core/src/jobs/proposal-review.ts`: immutable generations, revision-bound overlays, conflict detection, validation, and history.
- `packages/core/src/jobs/preparation.ts`: deterministic candidate validation/application; include new operations without granting machine checks human authority.
- `packages/core/src/corpus/schemas.ts` and `packages/cli/src/corpus/`: existing SQLite-backed updates, feedback, source fingerprints, scope, and supersession. Extend for exact clarification answers and separately stored writing preferences.
- `packages/cli/src/jobs/proposal-service.ts`: evaluates captured evidence and overlays; current automatic omission gate requires individual decisions and must be versioned for the new policy.
- `packages/cli/src/jobs/semantic-service.ts`, `semantic-repository.ts`, and `preparation-questions.ts`: persisted claim results, facts, questions, and retry paths.
- `packages/ui/src/views/jobs/JobResumeReview.tsx`, `JobResumeDetails.tsx`, `JobProposalReview.tsx`, `JobProposalEditor.tsx`, and `JobFacts.tsx`: complete draft, contextual exceptions, evidence, changes, and answer persistence.

Configured career runner: Codex, with existing recorded consent. Configuration and source evidence were left unchanged; legacy jobs are not regenerated automatically.
