# Implementation Plan: Task #6 — ATS Simulation & Readability Gate

## Overview
Add an automated ATS benchmark analyzer to the Featherduster Integrity Engine that simulates Greenhouse/Lever ATS parsers, extracts section headers from plain-text resumes, scores keyword relevance, flags multi-column parsing distortions and missing standard headings, and computes an ATS-readability score prior to export.

## Files to Create

### 1. `packages/core/src/integrity/ats-simulator.ts` (NEW)
Core ATS simulation engine with the following exports:

**Types:**
- `ATSParserType` — `'greenhouse' | 'lever' | 'generic'`
- `ATSSection` — `{ name: string; content: string; order: number; level: number }`
- `ATSKeywordMatch` — `{ keyword: string; count: number; sections: string[] }`
- `ATSDistortion` — `{ type: 'column_reorder' | 'header_missing' | 'header_malformed' | 'content_loss'; severity: 'low' | 'medium' | 'high'; message: string; location?: string }`
- `ATSReadabilityResult` — `{ score: number; band: 'excellent' | 'good' | 'fair' | 'poor'; sections: ATSSection[]; keywords: ATSKeywordMatch[]; distortions: ATSDistortion[]; missingStandardHeaders: string[]; parserOutputs: Record<ATSParserType, string> }`

**Constants:**
- `STANDARD_SECTION_HEADERS` — Array of expected section names (e.g., `['experience', 'education', 'skills', 'summary', 'projects', 'certifications', 'publications', 'awards', 'volunteer', 'leadership']`)
- `GREENHOUSE_KEYWORDS` / `LEVER_KEYWORDS` — Role-specific keyword dictionaries (can start minimal, extendable)
- `ATS_SCORE_WEIGHTS` — Weight config for scoring components

**Functions:**
- `parsePlainText(text: string): ATSSection[]` — Extracts sections from plain-text resume using heuristic header detection (ALL CAPS, Title Case, markdown-style `##`, underlines)
- `simulateATSParsing(text: string, parser: ATSParserType): string` — Returns simulated parser output for Greenhouse/Lever/generic (simulates column reordering, header stripping, special char handling)
- `extractKeywords(text: string, roleKeywords?: string[]): ATSKeywordMatch[]` — Counts keyword occurrences per section
- `detectDistortions(originalText: string, parsedOutput: string, sections: ATSSection[]): ATSDistortion[]` — Compares original vs parsed to find column reordering, missing headers, content loss
- `checkStandardHeaders(sections: ATSSection[]): string[]` — Returns list of missing standard headers
- `calculateATSScore(sections: ATSSection[], keywords: ATSKeywordMatch[], distortions: ATSDistortion[], missingHeaders: string[]): { score: number; band: 'excellent' | 'good' | 'fair' | 'poor' }` — Computes 0-100 score with band
- `runATSSimulation(resumeText: string, options?: { parser?: ATSParserType; roleKeywords?: string[] }): ATSReadabilityResult` — Main entry point combining all above

### 2. `packages/core/tests/ats-simulator.test.ts` (NEW)
Vitest test file with test cases covering:

**parsePlainText:**
- Extracts sections from markdown-style headers (`## Experience`)
- Extracts sections from ALL CAPS headers (`EXPERIENCE`)
- Extracts sections from Title Case headers (`Experience`)
- Extracts sections from underlined headers (`Experience\n-----`)
- Handles nested subsections (`## Experience\n### Company A`)
- Returns empty array for headerless text
- Preserves content order

**simulateATSParsing:**
- Greenhouse parser: strips markdown, linearizes columns, preserves header order
- Lever parser: similar but may drop special characters
- Generic parser: basic linearization
- Multi-column text shows reordering distortion

**extractKeywords:**
- Counts keyword occurrences case-insensitively
- Maps keywords to sections
- Handles zero matches

**detectDistortions:**
- Flags column reorder when section order changes
- Flags missing header when standard header absent
- Flags content loss when significant text dropped
- Severity classification

**checkStandardHeaders:**
- Identifies missing standard headers (experience, education, skills)
- Case-insensitive matching

**calculateATSScore:**
- Perfect resume → score ≥ 90 (excellent)
- Missing sections → score penalty
- Distortions → score penalty
- Keyword matches → score bonus
- Band boundaries: excellent ≥ 85, good ≥ 70, fair ≥ 50, poor < 50

**runATSSimulation (integration):**
- End-to-end with sample resume text
- Returns complete ATSReadabilityResult
- Exports all parser outputs

## Files to Modify

### 3. `packages/core/src/index.ts`
Add export:
```typescript
export * from './integrity/ats-simulator.js';
```

### 4. `packages/core/tests/integrity.test.ts`
Add import and describe block for ATS tests (or keep separate test file as above — prefer separate file per existing pattern). The task says test command is `npx vitest run packages/core/tests/integrity.test.ts`, so we should add the new tests there OR ensure the new test file is also run. Since the test strategy references `integrity.test.ts`, we'll add a new describe block at the end of that file for ATS simulation.

Actually, looking at existing test files, each module has its own test file (e.g., `deslop.test.ts`, `rubric-parser.test.ts`). The task test strategy mentions `integrity.test.ts` but that may be a legacy reference. We'll create a new `ats-simulator.test.ts` file and the `npm test` (which runs `vitest run`) will pick it up automatically.

## Implementation Steps (Builder Order)

1. **Create `ats-simulator.ts`** with all types, constants, and functions as specified above. Start with minimal Greenhouse/Lever keyword sets (can be expanded later).
2. **Create `ats-simulator.test.ts`** with all test cases. Run `npx vitest run packages/core/tests/ats-simulator.test.ts` to verify.
3. **Add export** to `packages/core/src/index.ts`.
4. **Run full test suite**: `npm test` (from root) to ensure zero regressions.
5. **Run build**: `npm run build` to ensure TypeScript compiles cleanly.

## Test Commands

- Unit tests for new module: `npx vitest run packages/core/tests/ats-simulator.test.ts`
- Full test suite: `npm test` (runs `vitest run` at root)
- Build verification: `npm run build`

## Key Design Decisions

1. **Parser simulation is heuristic-based** — Not a full Greenhouse/Lever clone; simulates known behaviors: column linearization (left-to-right, top-to-bottom), header normalization, special character stripping.
2. **Standard headers list** — Based on common resume sections; extensible via config later.
3. **Scoring algorithm** — Weighted: section completeness (40%), keyword density (30%), distortion penalty (20%), header standards (10%). Exact weights in `ATS_SCORE_WEIGHTS`.
4. **No external dependencies** — Pure TypeScript, no new packages.
5. **Integration with existing integrity engine** — Can be composed with `lintCitations`, `validateMetrics`, `redactText`, `auditSlop` for a full pre-export gate.

## Notes for Builder

- Follow existing code style in `packages/core/src/integrity/` (e.g., `citation-linter.ts`, `metric-validator.ts`).
- Use the same import patterns (`../schemas/...`, `../parsers/...`).
- Keep functions pure and testable.
- The `runATSSimulation` function should be the main public API.
- Greenhouse/Lever keyword dictionaries can start as empty objects `{}` — the feature works without them; they're a bonus for role-specific scoring.
- Ensure all regexes handle Unicode and multiline text correctly.
- Multi-column detection: if input contains visual column markers (tabs, multiple spaces, table-like structures), flag potential reordering.
- The `ats-simulator.test.ts` file should be created even though the task mentions `integrity.test.ts` — vitest will discover it automatically via the `test` script.