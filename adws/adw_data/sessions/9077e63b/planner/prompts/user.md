# Plan Task

## Variables

### prompt

# Task #1: Add test coverage for evidence-files.ts

## Description
Module packages/cli/src/evidence-files.ts has no dedicated test file and its exports are not referenced in cli tests.

## Details
Target module: packages/cli/src/evidence-files.ts
Recommended test location: packages/cli/tests/evidence-files.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #3]:
Module packages/cli/src/settings/routes.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/settings/routes.ts
Recommended test location: packages/cli/tests/routes.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #4]:
Module packages/cli/src/tailoring/routes.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/tailoring/routes.ts
Recommended test location: packages/cli/tests/routes.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #6]:
Module packages/cli/src/tailoring/store.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/tailoring/store.ts
Recommended test location: packages/cli/tests/store.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #8]:
Module packages/ui/src/routing.ts has no dedicated test file and its exports are not referenced in ui tests.
Target module: packages/ui/src/routing.ts
Recommended test location: packages/ui/tests/routing.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

## Subtasks
  ○ 1.1. 1. Falsifiable Specification for Add test coverage for evidence-files.ts
     Author Vitest assertions or gate checks verifying the expected behavior before changes: npx vitest run packages/cli/tests/evidence-files.test.ts
  ○ 1.2. 2. Implementation of Add test coverage for evidence-files.ts
     Implement changes satisfying requirements: Module packages/cli/src/evidence-files.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/evidence-files.ts
Recommended test location: packages/cli/tests/evidence-files.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #3]:
Module packages/cli/src/settings/routes.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/settings/routes.ts
Recommended test location: packages/cli/tests/routes.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #4]:
Module packages/cli/src/tailoring/routes.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/tailoring/routes.ts
Recommended test location: packages/cli/tests/routes.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #6]:
Module packages/cli/src/tailoring/store.ts has no dedicated test file and its exports are not referenced in cli tests.
Target module: packages/cli/src/tailoring/store.ts
Recommended test location: packages/cli/tests/store.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.

[Merged context from duplicate #8]:
Module packages/ui/src/routing.ts has no dedicated test file and its exports are not referenced in ui tests.
Target module: packages/ui/src/routing.ts
Recommended test location: packages/ui/tests/routing.test.ts
Implement test cases verifying exported functions, edge cases, and failure modes.
  ○ 1.3. 3. Verification & Monorepo Guard
     Run full test suite (`npm test`) and monorepo build (`npm run build`) to ensure zero regressions.

## Test Strategy
npx vitest run packages/cli/tests/evidence-files.test.ts

### previous_envelope

(none)

### context_handoff_dir

adws/adw_data/sessions/9077e63b/context_handoff

## Task

Produce an implementation plan for the TaskMaster task described in `prompt`.

Read any relevant source and test files from the monorepo first, then write your
plan to `adws/adw_data/sessions/9077e63b/context_handoff/plan.md`.

## Report

CRITICAL: Respond with ONLY a raw JSON object. No prose outside the JSON:

```json
{
  "status": "success",
  "summary": "<one sentence describing the plan>",
  "artifacts": ["adws/adw_data/sessions/9077e63b/context_handoff/plan.md"],
  "notes_for_next_agent": "<key decisions the builder must know>"
}
```
