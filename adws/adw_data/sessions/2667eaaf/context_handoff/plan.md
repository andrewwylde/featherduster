# Implementation Plan: ATS Simulation & Readability Gate

## Overview
Add an automated ATS benchmark analyzer to the Featherduster Integrity Engine that simulates Greenhouse/Lever ATS parsing, flags multi-column distortions and missing standard headings, and computes an ATS-readability score.

---

## Files to Create

### 1. `packages/core/src/integrity/ats-analyzer.ts` (NEW)
**Purpose:** Core ATS simulation and readability analysis module.

**Exports:**
- `ATSSchema` enum: `'greenhouse' | 'lever' | 'generic'`
- `ATSStandardSection` type: Standard section headers expected by ATS
- `ATSIssueType` type: `'missing_section' | 'multi_column_distortion' | 'malformed_header' | 'keyword_gap' | 'parsing_anomaly'`
- `ATSIssue` interface: `{ type: ATSIssueType; message: string; section?: string; severity: 'error' | 'warning'; line?: number }`
- `ATSAnalysisResult` interface: `{ score: number; band: 'excellent' | 'good' | 'fair' | 'poor'; issues: ATSIssue[]; sectionsFound: string[]; sectionsMissing: string[]; keywordMatches: number; keywordTotal: number; schema: ATSSchema }`
- `ATS_KEYWORDS_GREENHOUSE` / `ATS_KEYWORDS_LEVER` / `ATS_KEYWORDS_GENERIC`: Keyword dictionaries per schema
- `STANDARD_SECTIONS`: Canonical section headers ATS expects
- `analyzeATS(text: string, schema?: ATSSchema, targetKeywords?: string[]): ATSAnalysisResult` — Main entry point
- `simulateGreenhouseParse(text: string): ParsedSections` — Greenhouse-specific simulation
- `simulateLeverParse(text: string): ParsedSections` — Lever-specific simulation
- `detectMultiColumnDistortion(text: string): boolean` — Heuristic for column parsing issues
- `extractSectionHeaders(text: string): string[]` — Header extraction for validation
- `computeKeywordScore(text: string, keywords: string[]): { matches: number; total: number }` — Keyword matching

**Implementation Details:**
- **Greenhouse simulation:** Parses plain text linearly, treats `##` / `###` headers as section boundaries, expects standard sections (Summary, Experience, Education, Skills), flags when content appears side-by-side (multi-column) via line-length heuristics and bullet density anomalies
- **Lever simulation:** Similar but more tolerant of formatting; emphasizes keyword extraction from job descriptions
- **Generic simulation:** Baseline parser for unknown ATS
- **Multi-column detection:** Flag when bullet lines are unusually short (< 40 chars) suggesting column wrap, or when header-like lines appear mid-paragraph
- **Scoring:** 0-100 scale; weights: sections present (40%), keyword coverage (30%), parsing cleanliness (20%), structure (10%)

---

## Files to Modify

### 2. `packages/core/src/index.ts`
**Change:** Add export for new ATS analyzer module
```typescript
export * from './integrity/ats-analyzer.js';
```

### 3. `packages/core/tests/integrity.test.ts`
**Add test suite:** `describe('ATS Simulation & Readability Gate', () => { ... })`

**Test Cases:**
1. **Greenhouse schema - complete resume**
   - Input: Full markdown resume with all standard sections
   - Expect: `score >= 85`, `band === 'excellent'`, `sectionsMissing.length === 0`, `isClean` equivalent true

2. **Greenhouse schema - missing Experience section**
   - Input: Resume without `## Experience` header
   - Expect: `issues` contains `missing_section` for Experience, `score < 70`

3. **Greenhouse schema - missing Education section**
   - Input: Resume without `## Education` header
   - Expect: `issues` contains `missing_section` for Education

4. **Lever schema - keyword scoring**
   - Input: Resume text with 5/10 target keywords present
   - Expect: `keywordMatches === 5`, `keywordTotal === 10`, score reflects keyword weight

5. **Multi-column distortion detection**
   - Input: Text with short bullet lines (< 40 chars) suggesting column wrap
   - Expect: `issues` contains `multi_column_distortion` with `severity: 'warning'`

6. **Malformed header detection**
   - Input: Headers without proper markdown syntax (e.g., "EXPERIENCE" instead of "## Experience")
   - Expect: `issues` contains `malformed_header`

7. **Case-insensitive section matching**
   - Input: `## WORK EXPERIENCE` instead of `## Experience`
   - Expect: Section recognized (fuzzy match against STANDARD_SECTIONS)

8. **Empty/whitespace-only resume**
   - Input: Empty string or whitespace
   - Expect: `score === 0`, `band === 'poor'`, all standard sections missing

9. **Schema parameter variations**
   - Call `analyzeATS(text, 'greenhouse')`, `'lever'`, `'generic'`, undefined
   - Expect: All return valid `ATSAnalysisResult` with correct `schema` field

10. **Custom target keywords**
    - Input: Resume + `targetKeywords: ['Kubernetes', 'Raft', 'TypeScript']`
    - Expect: `keywordTotal === 3`, matches counted correctly

11. **Integration with existing integrity functions**
    - Run `lintCitations`, `validateMetrics`, `auditSlop`, `analyzeATS` on same text
    - Expect: All execute without interference; ATS result independent

---

## Files to Modify (Optional - Integration)

### 4. `packages/cli/src/commands/check.ts` (Optional Enhancement)
**Change:** Add ATS check to workspace integrity audit
- Import `analyzeATS` from `@featherduster/core`
- In `checkWorkspace`, after slop audit, run `analyzeATS` on resume markdown files
- Add `atsScore` and `atsIssues` to `CheckResult`
- Print ATS summary in `printCheckReport`

**Note:** This is optional for the core task but recommended for full integration.

---

## Verification Commands

### Primary Test Command (as specified in task)
```bash
npx vitest run packages/core/tests/integrity.test.ts
```

### Full Test Suite
```bash
npm test
```

### Monorepo Build
```bash
npm run build
```

---

## Key Design Decisions

1. **Location:** New module in `packages/core/src/integrity/` alongside existing integrity engines (citation-linter, metric-validator, redaction-engine, deslop-engine)

2. **Schema-driven:** Greenhouse/Lever/Generic schemas defined as constants; extensible for future ATS

3. **Pure functions:** No side effects; easy to test and compose

4. **Keyword dictionaries:** Pre-defined for common tech stacks; overridable via `targetKeywords` parameter

5. **Scoring transparency:** Returns breakdown (sectionsFound, sectionsMissing, keywordMatches, keywordTotal) for debugging

6. **Integration point:** Exported from core index; consumable by CLI check command, UI export drawer, or CI pipelines

---

## Notes for Builder Agent

- Follow existing code style: ESM imports, TypeScript with strict types, JSDoc comments for public APIs
- Mirror patterns from `citation-linter.ts` and `metric-validator.ts` for consistency
- Use `zod` only if adding new schema validation (not required for this task)
- Keep dependencies minimal — no new npm packages needed
- The `STANDARD_SECTIONS` constant should include: `['Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications', 'Publications', 'Awards']` (case-insensitive matching)
- Multi-column heuristic: flag when >30% of bullet lines are < 40 characters and appear in clusters
- Greenhouse parser: stricter on section ordering; Lever parser: more keyword-focused
- All new tests must pass with `npx vitest run packages/core/tests/integrity.test.ts` before considering complete