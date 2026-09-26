# Build Task

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

{
  "status": "success",
  "summary": "Created implementation plan for ATS Simulation & Readability Gate: new ats-analyzer.ts module in core/integrity, exports in index.ts, 11 test cases in integrity.test.ts, optional CLI check integration, with verification via npx vitest run packages/core/tests/integrity.test.ts and npm test/build.",
  "artifacts": [
    "adws/adw_data/sessions/2667eaaf/context_handoff/plan.md"
  ],
  "notes_for_next_agent": "Follow existing integrity engine patterns (citation-linter.ts, metric-validator.ts). Implement pure functions with schema-driven Greenhouse/Lever/Generic parsers. Key heuristics: multi-column detection via short bullet lines (<40 chars), case-insensitive section matching against STANDARD_SECTIONS, weighted scoring (sections 40%, keywords 30%, parsing 20%, structure 10%). No new dependencies. All tests must pass vitest run on integrity.test.ts.",
  "commit_message": ""
}

### context_handoff_dir

adws/adw_data/sessions/2667eaaf/context_handoff

## Task

Implement the work described in `prompt`, following the plan in
`previous_envelope`. Then run the test command to confirm success.

## Report

CRITICAL: Respond with ONLY a raw JSON object matching `BuildOutput`. No prose:

```json
{
  "status": "success",
  "summary": "<one sentence summary of what you changed>",
  "changed_files": ["<relative path>", "..."],
  "artifacts": [],
  "commit_message": "<conventional commit subject, e.g. test: add coverage for evidence-files.ts>",
  "notes_for_next_agent": "<any known issues or follow-ups>"
}
```
