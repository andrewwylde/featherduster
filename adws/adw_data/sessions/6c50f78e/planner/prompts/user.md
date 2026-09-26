# Plan Task

## Variables

### prompt

# Task #6: ATS Simulation & Readability Gate

## Description
Add automated ATS benchmark analyzer comparing resume plain-text parsing, section header extraction, and keyword scoring across Greenhouse/Lever schemas.

## Details
Feature proposal for Featherduster Integrity Engine:
- Simulates common applicant tracking system (ATS) parsers
- Flags multi-column parsing distortions or missing standard headings
- Computes ATS-readability score prior to export

## Subtasks
  ○ 31.1. 1. Falsifiable Specification for ATS Simulation & Readability Gate
     Author Vitest assertions or gate checks verifying the expected behavior before changes: npx vitest run packages/core/tests/integrity.test.ts
  ○ 31.2. 2. Implementation of ATS Simulation & Readability Gate
     Implement changes satisfying requirements: Add automated ATS benchmark analyzer comparing resume plain-text parsing, section header extraction, and keyword scoring across Greenhouse/Lever schemas.
Feature proposal for Featherduster Integrity Engine:
- Simulates common applicant tracking system (ATS) parsers
- Flags multi-column parsing distortions or missing standard headings
- Computes ATS-readability score prior to export
  ○ 31.3. 3. Verification & Monorepo Guard
     Run full test suite (`npm test`) and monorepo build (`npm run build`) to ensure zero regressions.

## Test Strategy
npx vitest run packages/core/tests/integrity.test.ts

### previous_envelope

(none)

### context_handoff_dir

adws/adw_data/sessions/6c50f78e/context_handoff

## Task

Produce an implementation plan for the TaskMaster task described in `prompt`.

Read any relevant source and test files from the monorepo first, then write your
plan to `adws/adw_data/sessions/6c50f78e/context_handoff/plan.md`.

## Report

CRITICAL: Respond with ONLY a raw JSON object. No prose outside the JSON:

```json
{
  "status": "success",
  "summary": "<one sentence describing the plan>",
  "artifacts": ["adws/adw_data/sessions/6c50f78e/context_handoff/plan.md"],
  "notes_for_next_agent": "<key decisions the builder must know>"
}
```
