# Accomplishment synthesis and resume review

Implemented the confirmed plan in Task Master task 41. Existing layout and review changes were preserved. The evidence ledger was not modified.

## Behavior

- Fresh generations use `accomplishments-1`. Consolidations bind multiple original bullets within one experience to one accomplishment, including exact source wording, evidence, claim bindings, requirement links, and rationale. Overlapping or stale targets are rejected. Consolidation and undo are atomic.
- Supported additions, rewrites, and omissions enter the draft automatically. Generation selects meaningful contributions and documented purpose for the page budget. It may include relevant evidence absent from the starting resume. Missing optional enrichment retains conservative wording; required truth questions remain unresolved until supported or removed.
- The complete resume is the primary review surface. Persisted checks determine Needs your answer, Checking, Needs retry, and Resolved states. Wording and source mappings can be edited in context. Saving and checking are separate; deferred factual answers survive navigation and reload.
- Evidence contains titled excerpts and claim mappings. Changes contains before/after text, consolidations, omissions, and undo/restore controls. Restoring content tries conservative wording reductions before offering specific replacement choices when it still exceeds the page budget.
- Exact project answers, actor/source provenance, revisions, and correction relationships use the existing corpus store. Job-only answers remain available. Shared reuse requires matching work, compatible facts, and captured evidence versions; exact claim matching is deliberately conservative. Conflicting answers require explicit correction.
- Shared corrections flag affected drafts and conflicting historical artifacts. Update selected saves all selected jobs before checking them independently, changes only selected affected passages, and persists each result. Undo follows reviews that have since become PDFs and forks published drafts rather than modifying historical versions.
- Use this style again stores an explicit writing preference separately from factual knowledge. Ordinary wording changes remain local.
- Passing required checks automatically continues PDF generation. Final approval binds the displayed PDF and change summary. Restored or corrected drafts require a new approval. Downloads and application tracking remain separate.

## Compatibility and verification

Final verification on November 5: the full suite passed 1,675 tests with one existing skipped test. The four focused accomplishment-review UI tests also passed after the final PDF-summary adjustment. Core, UI, and CLI builds passed. The browser workflow passed with no browser errors; screenshots were inspected at desktop and mobile sizes. Vite retains its existing large-bundle advisory.

Saved proposals without consolidation or claim-binding fields remain readable. Saved generations without the new policy retain their existing behavior; reading an old job does not regenerate it. New checkpoint policy and runner contracts are updated together. Factual corrections can invalidate reuse of an old PDF while preserving its historical approval record.

Verification scripts:

- `scripts/verify-accomplishment-review.mjs` creates a disposable synthetic workspace and exercises the actual HTTP server, UI, persistence, renderer, PDF verifier, and approval binding. It checks deferred answers after reload, a 390px layout, automatic PDF continuation, visible change summary, omission restoration, and fresh approval. No real user's PDF is approved by this test.
- `scripts/verify-accomplishment-synthesis.mjs` uses the configured runner and existing consent against read-only career evidence. Each invocation has a separate output directory and report so failed or unresolved wording cannot inherit a previous PDF's successful result. It checks consolidation, unrelated-work separation, unsupported ownership/impact, actual one-page PDF export, and unchanged ledger bytes when generation passes factual checks.
- Core and integration tests cover atomic consolidation/undo, overlapping and reordered targets, legacy proposals, exact answer persistence and conflicts, selected corrections preserving unrelated edits, stale revisions, historical artifacts, and correction undo after automatic publication. UI tests cover persisted exception states and overflow recovery.

## Real-evidence result

The earlier conservative real-evidence run passed claim checks, rejected unsupported ownership/impact, and produced a verified one-page PDF. The stricter coherent accomplishment run asked whether the configuration UI used the tenant-scoped admin APIs; its separate validation claim and migration accomplishment were supported. The user subsequently answered, “Yes, they were the same workflow.” That exact factual answer and its question are recorded in the calibration document, separately from machine checks and writing-example acceptance. It resolves the workflow relationship, without granting final PDF approval.

After that answer, the exact checked accomplishment was rendered into a verified one-page calibration PDF, using the original machine results plus separately recorded human support. All source fingerprints and quoted excerpts were rechecked against the current evidence, the ledger hash remained unchanged, and no additional model calls were needed. The PDF remains unapproved.

Ignored verification artifacts are under `walkthrough-output/accomplishment-ui`, `walkthrough-output/accomplishment-real/conservative-verified`, `walkthrough-output/accomplishment-real/coherent-needs-answer` (historical), and `walkthrough-output/accomplishment-real/coherent-confirmed` (current human confirmation, report, and PDF).
