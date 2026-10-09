# PR #1 Review: Rewrite README around what the tool does today

**Intent**: Replace marketing claims with documentation that matches the current implementation.
**Reviewed by**: documentation-engineer, security-engineer, code-reviewer, and the coordinating reviewer.
**EDRs checked**: None applicable; no EDR or ADR directory exists in this revision. Relevant sections of the original app design spec were checked against current code.
**Date**: 2026-10-09

## Summary

The rewrite improves the README, but initially retained several unsupported integrity and privacy claims and an invalid evidence example. These documentation defects were corrected; existing application limitations are recorded separately below.

## Tactical Fixes (this PR)

### Blockers

- **Fixed: unsupported integrity guarantees.** Citation and metric validators do not require every bullet to cite evidence or compare claimed numbers with evidence values. Revised the introduction, package description, audit explanation, and limits. Runtime verification confirmed a claim of 30% passes against verified evidence of 10%. — Approximately 10 minutes.
- **Fixed: misleading export privacy claim.** Interview briefs intentionally retain internal references and evidence notes; brag docs retain evidence IDs. Separated their behavior from résumé exports, including in the CLI README. A brief probe retained `PRIVATE-123`. — Approximately 5 minutes.
- **Fixed: invalid evidence example.** The filename comment preceded the frontmatter delimiter, and required `summary`, `themes`, and `in_flight` fields were missing. Moved the filename outside the fence and added required fields. The parser rejects the original example and accepts the revision. — Approximately 5 minutes.
- **Fixed: inactive hook in the quickstart.** `init` only configures Git hooks in an existing repository. Added `git init` before workspace initialization and explained hook activation and bypass limits. A fresh-workspace probe verified `core.hooksPath=.githooks`. — Approximately 5 minutes.

### Improvements

- **Fixed:** Raised documented clone prerequisite to Node 20+, matching the locked Playwright engine requirement. No Node 18 runtime failure is claimed. — Approximately 2 minutes.
- **Fixed:** Replaced shell-dependent `~/career` examples with `../career`. — Approximately 2 minutes.
- **Fixed:** Labeled the audit transcript as an excerpt from a larger sample workspace; its dangling citation is not part of the displayed example. — Approximately 2 minutes.
- **Fixed:** Named Claude Code, Codex, and Anthropic API as cloud runners; clarified raw-text Ollama behavior, stored consent, and the need for a local Ollama endpoint for local inference. — Approximately 5 minutes.
- **Fixed:** Clarified provisional warnings versus strict errors, the scope of Markdown filler scanning, and silent skipping of uncited invalid evidence. — Approximately 5 minutes.
- **Fixed:** Distinguished dedicated tailoring proposal validation from `check` and clarified that brag compilation consumes a rubric and evidence. — Approximately 2 minutes.

## Systemic Follow-ups (separate PRs)

- Define and implement stronger evidence checks if desired: mandatory bullet citations, agreement between claimed and recorded metrics, and consistent handling of arbitrary metric status strings. Current behavior is explicitly documented.
- Report evidence schema errors directly instead of silently dropping invalid files. Include uncited invalid entries in diagnostics.
- Reconcile export gating and canvas audit indicators with actual integrity results. `build` currently does not run `check`; the built-in canvas starter uses hard-coded sample data. These are existing limitations identified in the PR description and source, not regressions introduced here.
- Improve workspace setup feedback when Git is absent, and ensure any default audit hook can invoke the unpublished CLI reliably. The documented block-push quickstart now initializes Git first.

## EDR Observations

- No applicable EDRs or ADRs were found. The original design describes stronger guarantees than the current implementation. The README now describes observed behavior instead of repeating those design aspirations.

## Validation

- `npm ci --no-audit --no-fund` completed in the isolated review worktree.
- `npm run build` passed on Node 24.14.0. Existing Vite chunk-size and gray-matter eval warnings remain.
- `npm test`: **50 test files passed; 612 tests passed**. The PR description's Node 26 UI failures were not reproduced on this Node 24 environment; Node 26 was not tested.
- Runtime probes verified the evidence example, expected metric/provisional findings, the numeric-comparison limitation, Git hook configuration, starter audit success, Typst compilation, and private brief references. An initial probe fixture lacked required résumé profile fields; correcting that fixture allowed the brief assertion to pass.
- Both added screenshots were inspected by the code reviewer and show synthetic sample data.
- `git diff --check` passed. GitHub reported no configured PR checks.

## Corrections & Decisions

- The user explicitly authorized review, fixes, push, and merge. No additional approval was requested.
- Reviewed the actual PR branch in a separate worktree because local `main` contains 54 unrelated unpushed commits. Those commits were excluded.
- Kept application behavior changes outside this documentation PR. Privacy descriptions were corrected to match the intentionally private brief format.
