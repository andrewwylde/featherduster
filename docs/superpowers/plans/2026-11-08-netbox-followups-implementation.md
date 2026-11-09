# NetBox Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 10 reliability, review, and selection defects and 5 feature extensions identified during the NetBox live job walkthrough, delivering bounded discovery, actionable semantic recovery, grounded review wording, selective accomplishment ranking, and stable human employment-fact reuse.

**Architecture:** Maintain the evidence ledger, input snapshots, LaTeX renderer, and approval contracts. Extend core semantic and proposal validation schemas with exact span and revision tracking; scope watcher event delivery to avoid amplification; decouple file identity from display labels; and project unified review completion states through the backend without competing state machines.

**Tech Stack:** TypeScript, Node.js (v22+), Hono, Zod, SQLite, React 18, Vite, Vitest, Testing Library, and LaTeX.

---

## Approved Context and Baseline Rules

- **Source Backlog:** Defined in [`docs/implementation/netbox-followups/README.md`](file:///C:/Users/drewk/featherduster/docs/implementation/netbox-followups/README.md) and [`backlog.json`](file:///C:/Users/drewk/featherduster/docs/implementation/netbox-followups/backlog.json).
- **Controlling Decisions:**
  - `BUG-001` is partially mitigated by the no-correction fast path in the dirty tree. Preserve it; do not revert.
  - `FEAT-005` (Task 45) reuses [`docs/superpowers/specs/2026-11-06-human-confirmed-employment-facts-plan.md`](file:///C:/Users/drewk/featherduster/docs/superpowers/specs/2026-11-06-human-confirmed-employment-facts-plan.md); it is not a competing human verification pipeline.
  - `Task 50` completed design work in [`docs/superpowers/specs/2026-11-06-draft-first-tailoring-design.md`](file:///C:/Users/drewk/featherduster/docs/superpowers/specs/2026-11-06-draft-first-tailoring-design.md); its automatic saving, fallback, and single final approval decisions govern all overlapping features in this plan.
- **Dirty Working Tree:** Existing uncommitted changes in `packages/core`, `packages/cli`, and `packages/ui` must be preserved. Stage specific files per task; never run blanket `git add .` or `git reset --hard`.
- **Safety Boundaries:** Test execution must write only to disposable workspaces. Never edit the real career ledger, submit real human answers as test shortcuts, or synthesize real PDF approvals.

---

## Phase 1: Make Failures Understandable and Safely Recoverable

Focus: `BUG-002`, `BUG-003`, `BUG-004`, `BUG-006`, and `BUG-007`.

### Task 1 (BUG-002): Recover Failed Classification Batches with Actionable Diagnostics [Task Master: 52]

**Files:**
- Modify: `packages/cli/src/jobs/semantic-classifier.ts`
- Modify: `packages/cli/src/jobs/semantic-service.ts`
- Modify: `packages/core/src/jobs/semantic-transport.ts`
- Modify: `packages/ui/src/views/jobs/JobFacts.tsx`
- Test: `packages/cli/tests/job-semantic-service.test.ts`

- [x] **Step 1: Write failing regression test for batch failure diagnostics and retry**

In `packages/cli/tests/job-semantic-service.test.ts`, add a test verifying that when batch 3 of 4 fails with invalid schema shape, earlier batches remain persisted, a structured error payload is saved, and only unchecked/failed passages are retried:

```typescript
it('preserves successful classification batches and retains structured diagnostic on batch schema error', async () => {
  const runner = createMockRunner({
    batchFailures: { 3: new Error('Malformed wire JSON at line 1 col 12') },
  });
  const service = new JobSemanticService(fixtureRepo, runner);
  const result = await service.classifyJobPassages('job-netbox-synthetic', { batchSize: 4 });

  expect(result.batchesSucceeded).toBe(2);
  expect(result.batchesFailed).toBe(1);
  expect(result.passages[0].status).toBe('supported');
  expect(result.failures).toContainEqual(expect.objectContaining({
    batch_index: 3,
    stage: 'schema_validation',
    code: 'wire_shape_invalid',
    safe_diagnostic: expect.stringContaining('Malformed wire JSON'),
  }));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/job-semantic-service.test.ts -t "preserves successful classification batches"`
Expected: FAIL with missing `failures` structure or premature abort of earlier batches.

- [x] **Step 3: Implement structured failure capture and selective retry in semantic classifier & service**

In `packages/cli/src/jobs/semantic-classifier.ts`:
1. Parse Zod errors using `formatSafeZodIssues(error.issues)` redacting raw strings, prompts, and credentials while retaining path strings (e.g., `passages[2].support_basis`).
2. Map errors into typed `SemanticBatchFailure`:
   ```typescript
   export interface SemanticBatchFailure {
     batch_index: number;
     stage: 'dispatch' | 'wire_parse' | 'schema_validation' | 'timeout' | 'stale_revision';
     code: 'wire_shape_invalid' | 'invalid_span' | 'timeout' | 'stale_result' | 'unknown';
     safe_diagnostic: string;
     passage_ids: string[];
   }
   ```
3. In `semantic-service.ts`, persist partial batch results immediately upon batch completion rather than waiting for all batches to finish.
4. When executing a retry, filter target passages to only those whose status is `'failed'` or `'unchecked'` and whose candidate binding matches the current revision.

In `packages/ui/src/views/jobs/JobFacts.tsx`:
1. Render a "Needs retry" banner naming the specific failed batch and safe message.
2. Keep the retry button distinct from human confirmation prompts.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/job-semantic-service.test.ts -t "preserves successful classification batches"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/jobs/semantic-classifier.ts packages/cli/src/jobs/semantic-service.ts packages/core/src/jobs/semantic-transport.ts packages/ui/src/views/jobs/JobFacts.tsx packages/cli/tests/job-semantic-service.test.ts
git commit -m "fix(semantic): isolate failed classification batches and expose safe diagnostics (BUG-002)"
```

---

### Task 2 (BUG-003): Bind Review Findings to Exact Displayed Wording and Revision [Task Master: 53]

**Files:**
- Modify: `packages/core/src/jobs/proposal-review.ts`
- Modify: `packages/cli/src/jobs/proposal-service.ts`
- Modify: `packages/ui/src/views/jobs/JobProposalReview.tsx`
- Modify: `packages/ui/src/views/jobs/ResumeDraftSurface.tsx`
- Test: `packages/cli/tests/job-proposal-service.test.ts`
- Test: `packages/ui/tests/job-proposal-review.test.tsx`

- [x] **Step 1: Write failing test for finding binding to candidate text and baseline distinction**

In `packages/cli/tests/job-proposal-service.test.ts`:
```typescript
it('binds finding to exact wording and distinguishes retained baseline from replacement preview', () => {
  const finding = bindReviewFinding({
    issueKey: 'metric_unverified',
    message: 'Numbers not supported by cited verified evidence: 11.',
    target: {
      scope: 'retained_baseline',
      text: 'Senior Software Engineer with 11 years experience...',
      text_fingerprint: 'fp_base_11',
      span: [30, 32],
    },
    draft_revision: 2,
    preview_text: 'Senior Software Engineer with deep experience...',
  });

  expect(finding.target.scope).toBe('retained_baseline');
  expect(finding.target.text).toContain('11 years');
  expect(finding.is_stale_for_preview).toBe(true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/job-proposal-service.test.ts -t "binds finding to exact wording"`
Expected: FAIL with undefined `bindReviewFinding` or missing `target.scope`.

- [x] **Step 3: Implement exact finding bindings and candidate scope tracking**

1. In `packages/core/src/jobs/proposal-review.ts`:
   Extend finding schema with:
   ```typescript
   export const ReviewFindingTargetSchema = z.object({
     scope: z.enum(['retained_baseline', 'draft_candidate', 'generated_patch']),
     text: z.string(),
     text_fingerprint: z.string(),
     span: z.tuple([z.number(), z.number()]).optional(),
     revision: z.number().int().nonnegative(),
   }).strict();
   ```
2. In `packages/cli/src/jobs/proposal-service.ts`:
   Ensure validations associate baseline metrics with the retained baseline snapshot rather than attributing them to the active replacement draft.
3. In `packages/ui/src/views/jobs/JobProposalReview.tsx` and `ResumeDraftSurface.tsx`:
   When displaying a finding next to a passage, verify if the finding's `text_fingerprint` matches the current editor content. If it matches the retained baseline while an edit is active, label it "Retained baseline finding (resolved by your pending edit)".

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/job-proposal-service.test.ts -t "binds finding to exact wording"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/core/src/jobs/proposal-review.ts packages/cli/src/jobs/proposal-service.ts packages/ui/src/views/jobs/JobProposalReview.tsx packages/ui/src/views/jobs/ResumeDraftSurface.tsx packages/cli/tests/job-proposal-service.test.ts
git commit -m "fix(review): bind review findings to exact candidate scope and wording (BUG-003)"
```

---

### Task 3 (BUG-004): Generate Complete Claim Bindings and Identify Uncovered Spans [Task Master: 54]

**Files:**
- Modify: `packages/core/src/jobs/synthesis.ts`
- Modify: `packages/core/src/tailoring/validators.ts`
- Modify: `packages/core/src/tailoring/schemas.ts`
- Modify: `packages/ui/src/views/jobs/JobProposalEditor.tsx`
- Test: `packages/core/tests/accomplishment-synthesis.test.ts`

- [x] **Step 1: Write failing test for uncovered span reporting and connective text coverage**

In `packages/core/tests/accomplishment-synthesis.test.ts`:
```typescript
it('flags exact uncovered span offsets when connective text is missing evidence binding', () => {
  const proposal = {
    text: 'Experience spans leading frontend migrations and observability pipelines.',
    claims: [
      { text: 'leading frontend migrations', source_ids: ['src-1'], span: [17, 44] },
      { text: 'observability pipelines', source_ids: ['src-2'], span: [49, 72] },
    ],
  };

  const validation = validateProposalClaimCoverage(proposal.text, proposal.claims);
  expect(validation.valid).toBe(false);
  expect(validation.gaps).toEqual([
    { span: [0, 17], text: 'Experience spans ' },
    { span: [44, 49], text: ' and ' },
    { span: [72, 73], text: '.' },
  ]);
  expect(validation.issues[0].message).toContain('Uncovered wording: "Experience spans "');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/accomplishment-synthesis.test.ts -t "flags exact uncovered span offsets"`
Expected: FAIL with generic error message without exact span offsets or gap payload.

- [x] **Step 3: Update synthesis prompts and claim coverage validator**

1. In `packages/core/src/tailoring/validators.ts`:
   Enhance `validateProposalClaimCoverage` to compute character coverage across the string (ignoring solely whitespace), and produce explicit gap ranges:
   ```typescript
   export interface ClaimCoverageGap {
     span: [number, number];
     text: string;
   }
   ```
   Add gaps to `ReviewFinding.gap_details`.
2. In `packages/core/src/jobs/synthesis.ts`:
   Update synthesis prompt rules to ensure the model produces claims that collectively span the entire sentence, attributing connective clauses to the primary contextual source ID rather than leaving them unmapped.
3. In `packages/ui/src/views/jobs/JobProposalEditor.tsx`:
   Render highlighted markers on exact uncovered character ranges within the passage text area.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/accomplishment-synthesis.test.ts -t "flags exact uncovered span offsets"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/core/src/jobs/synthesis.ts packages/core/src/tailoring/validators.ts packages/core/src/tailoring/schemas.ts packages/ui/src/views/jobs/JobProposalEditor.tsx packages/core/tests/accomplishment-synthesis.test.ts
git commit -m "fix(synthesis): emit full claim coverage and report exact uncovered text spans (BUG-004)"
```

---

### Task 4 (BUG-006): Unify Review Counts and Next Actions under Current Persisted State [Task Master: 56]

**Files:**
- Modify: `packages/core/src/jobs/semantic-transport.ts`
- Modify: `packages/ui/src/views/jobs/JobDetail.tsx`
- Modify: `packages/ui/src/views/jobs/JobProposalReview.tsx`
- Modify: `packages/ui/src/views/jobs/JobFacts.tsx`
- Modify: `packages/ui/src/views/jobs/ResumeDraftSurface.tsx`
- Test: `packages/ui/tests/job-proposal-review.test.tsx`
- Test: `packages/ui/tests/job-facts.test.tsx`

- [x] **Step 1: Write failing UI test for consistent review counters and single primary next action**

In `packages/ui/tests/job-proposal-review.test.tsx`:
```typescript
it('displays distinct counts for factual questions, technical checks, and wording issues without resetting to 0 during check', () => {
  renderJobReview({
    supportedClaims: 9,
    unresolvedFacts: 2,
    wordingBlockers: 3,
    technicalRetries: 1,
    isChecking: true,
  });

  expect(screen.getByTestId('fact-count-badge')).toHaveTextContent('2 facts need answer');
  expect(screen.getByTestId('wording-issue-badge')).toHaveTextContent('3 wording issues');
  expect(screen.getByTestId('technical-retry-badge')).toHaveTextContent('1 technical check needs retry');
  // Crucial: Checking active does not wipe supported claims count
  expect(screen.getByTestId('supported-claims-summary')).toHaveTextContent('9 claims supported');
  expect(screen.getByTestId('primary-next-action')).toHaveTextContent('Checking in progress...');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/job-proposal-review.test.tsx -t "displays distinct counts"`
Expected: FAIL with ambiguous "Review facts (14)" or `0 of 19 resolved` during checking.

- [x] **Step 3: Implement unified review projection hook and clear count segregation**

1. In `packages/core/src/jobs/semantic-transport.ts`:
   Define `UnifiedReviewSummary`:
   ```typescript
   export interface UnifiedReviewSummary {
     unresolved_facts_count: number;
     wording_issues_count: number;
     technical_failures_count: number;
     supported_claims_count: number;
     total_claims_count: number;
     primary_next_action: 'answer_facts' | 'fix_wording' | 'retry_technical' | 'wait_checking' | 'review_pdf' | 'ready_to_approve';
   }
   ```
2. In `packages/ui/src/views/jobs/JobDetail.tsx`:
   Replace the overloaded "Review facts (X)" tab badge with explicit count categories. Only count genuine human factual questions under facts.
3. In `JobProposalReview.tsx` and `JobFacts.tsx`:
   Ensure in-flight check requests preserve prior resolved claims rather than zeroing out the counters. Disable redundant check dispatch while checking is active.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/job-proposal-review.test.tsx -t "displays distinct counts"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/core/src/jobs/semantic-transport.ts packages/ui/src/views/jobs/JobDetail.tsx packages/ui/src/views/jobs/JobProposalReview.tsx packages/ui/src/views/jobs/JobFacts.tsx packages/ui/src/views/jobs/ResumeDraftSurface.tsx packages/ui/tests/job-proposal-review.test.tsx
git commit -m "fix(review): unify review state projection, counts, and primary next action (BUG-006)"
```

---

### Task 5 (BUG-007): Include Inherited Wording Corrections in Final PDF Change Summaries [Task Master: 57]

**Files:**
- Modify: `packages/cli/src/jobs/artifacts.ts`
- Modify: `packages/core/src/jobs/proposal-review.ts`
- Modify: `packages/core/src/jobs/restoration.ts`
- Modify: `packages/ui/src/views/jobs/JobArtifactChanges.tsx`
- Test: `packages/core/tests/review-omissions.test.ts`
- Test: `packages/ui/tests/accomplishment-review.test.tsx`

- [x] **Step 1: Write failing test for original-to-final change comparison including base corrections**

In `packages/core/tests/review-omissions.test.ts`:
```typescript
it('computes full diff against immutable original capture when inherited bullets have job-local corrections', () => {
  const originalSnapshot = {
    experience: [{ id: 'kong', bullets: ['Engineered accessible UI components across apps.'] }],
  };
  const baseCorrections = [
    { target: 'Engineered accessible UI components across apps.', replacement: 'Engineered accessible web forms for internal admin tools.' },
  ];
  const generatedOperations = [
    { op: 'replace', before: 'Engineered accessible web forms for internal admin tools.', after: 'Delivered WCAG 2.1 accessible form controls in React.' },
  ];

  const changes = computeArtifactChanges(originalSnapshot, baseCorrections, generatedOperations);
  expect(changes.passages[0].original_text).toBe('Engineered accessible UI components across apps.');
  expect(changes.passages[0].final_text).toBe('Delivered WCAG 2.1 accessible form controls in React.');
  expect(changes.passages[0].stages).toHaveLength(2);
  expect(changes.passages[0].stages[0].kind).toBe('job_local_correction');
  expect(changes.passages[0].stages[1].kind).toBe('tailored_proposal');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/review-omissions.test.ts -t "computes full diff against immutable original capture"`
Expected: FAIL with `original_text` showing the already-corrected base text rather than the immutable starting capture.

- [x] **Step 3: Track multi-stage transformations from original snapshot to published candidate**

1. In `packages/core/src/jobs/restoration.ts` and `proposal-review.ts`:
   Structure the artifact comparison model:
   ```typescript
   export interface PassageDiffTrace {
     passage_id: string;
     original_text: string;
     final_text: string;
     stages: Array<{
       kind: 'original_capture' | 'job_local_correction' | 'tailored_proposal' | 'user_edit' | 'omission';
       text: string;
       timestamp?: string;
     }>;
   }
   ```
2. In `packages/cli/src/jobs/artifacts.ts`:
   When bundling artifact metadata at export time, include both the raw capture text and intermediate job-local corrections so the full lineage is frozen with the PDF.
3. In `packages/ui/src/views/jobs/JobArtifactChanges.tsx`:
   Render the "Before" column using `original_text`, show the final candidate in "After", and provide an expandable "Correction history" disclosure for passages modified across multiple stages.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/review-omissions.test.ts -t "computes full diff against immutable original capture"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/jobs/artifacts.ts packages/core/src/jobs/proposal-review.ts packages/core/src/jobs/restoration.ts packages/ui/src/views/jobs/JobArtifactChanges.tsx packages/core/tests/review-omissions.test.ts
git commit -m "fix(artifacts): preserve original capture baseline and track intermediate corrections (BUG-007)"
```

---

## Phase 2: Remove Avoidable Runtime and Selection Cost

Focus: `BUG-001`, `BUG-005`, `BUG-009`, `BUG-008`, and `BUG-010`.

### Task 6 (BUG-001): Bound Shared-Correction Discovery for Saved Jobs [Task Master: 51]

**Files:**
- Modify: `packages/cli/src/jobs/clarification-updates.ts`
- Modify: `packages/ui/src/views/jobs/SharedFactUpdates.tsx`
- Test: `packages/cli/tests/shared-clarification-workflow.test.ts`

- [x] **Step 1: Write failing benchmark and bounded discovery test with 52 jobs**

In `packages/cli/tests/shared-clarification-workflow.test.ts`:
```typescript
it('bounds work during discovery with 52 saved jobs and does not read unrelated PDF bytes', async () => {
  const fixture = create52JobWorkspaceWithOneCorrection();
  const readSpy = vi.spyOn(fixture.fs, 'readFile');

  const result = await affectedClarificationDrafts(fixture.runtime);

  expect(result.jobs).toHaveLength(1);
  expect(result.jobs[0].job_id).toBe(fixture.affectedJobId);

  // Assert no PDF or heavy artifact byte reads occurred for unaffected jobs
  const pdfReads = readSpy.mock.calls.filter(([path]) => String(path).endsWith('.pdf'));
  expect(pdfReads).toHaveLength(0);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/shared-clarification-workflow.test.ts -t "bounds work during discovery"`
Expected: FAIL with eager PDF/artifact enumeration or timeouts across 52 jobs.

- [x] **Step 3: Implement lightweight index filtering before artifact loading in clarification updates**

In `packages/cli/src/jobs/clarification-updates.ts`:
1. Index active corrections by their `work_id` and confirmed claim tokens.
2. In `affectedClarificationDrafts`:
   - Inspect job lightweight metadata (`job.inputs_snapshot?.work_ids` or lightweight review cache) before calling `r.artifacts.review(job.id, artifactId)`.
   - Skip jobs whose recorded work IDs share no intersection with any active correction's `work_id`.
   - For matching candidates, only read the working draft JSON structure, never the `.pdf` bytes.
   - If candidate evaluation exceeds 1,500ms, cap the batch and return `{ incomplete: true, next_cursor: ... }`.
3. In `packages/ui/src/views/jobs/SharedFactUpdates.tsx`:
   Render incremental discovery states cleanly without locking the Jobs list.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/shared-clarification-workflow.test.ts -t "bounds work during discovery"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/jobs/clarification-updates.ts packages/ui/src/views/jobs/SharedFactUpdates.tsx packages/cli/tests/shared-clarification-workflow.test.ts
git commit -m "perf(clarifications): bound shared correction discovery and avoid eager artifact reads (BUG-001)"
```

---

### Task 7 (BUG-005): Coalesce and Scope Workspace Live Refreshes [Task Master: 55]

**Files:**
- Modify: `packages/cli/src/watcher.ts`
- Modify: `packages/cli/src/server.ts`
- Modify: `packages/ui/src/hooks/useLiveSync.ts`
- Modify: `packages/ui/src/hooks/useDeskData.ts`
- Modify: `packages/ui/src/components/Layout.tsx`
- Test: `packages/cli/tests/watcher.test.ts` (create or update)
- Test: `packages/ui/tests/jobs-ui.test.tsx`

- [x] **Step 1: Write failing test for operational file change filtering and refresh debouncing**

In `packages/cli/tests/watcher.test.ts`:
```typescript
it('ignores sqlite wal/shm and operational lease writes while coalescing rapid user file changes', async () => {
  const events: string[] = [];
  const watcher = createScopedWatcher(testDir, (event) => events.push(event.path));

  // Write operational sidecars
  await fs.writeFile(path.join(testDir, 'featherduster.db-wal'), 'data');
  await fs.writeFile(path.join(testDir, 'featherduster.db-shm'), 'data');
  await fs.writeFile(path.join(testDir, '.leases', 'worker.lock'), 'data');

  // Rapidly write evidence file
  await fs.writeFile(path.join(testDir, 'corpus', 'facts.yaml'), 'v1');
  await fs.writeFile(path.join(testDir, 'corpus', 'facts.yaml'), 'v2');

  await sleep(150);
  expect(events.filter(e => e.includes('db-wal') || e.includes('.leases'))).toHaveLength(0);
  expect(events.filter(e => e.includes('facts.yaml'))).toHaveLength(1);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/watcher.test.ts -t "ignores sqlite wal/shm"`
Expected: FAIL with watcher emitting all sidecar files and duplicate events.

- [x] **Step 3: Scope file watcher ignore rules and coalesce UI data hooks**

1. In `packages/cli/src/watcher.ts`:
   Add strict ignore regex patterns for:
   - `.*\.db-(?:wal|shm)$`
   - `(?:^|[\\/])\.leases[\\/]`
   - `(?:^|[\\/])\.cache[\\/]`
   - `(?:^|[\\/])tmp[\\/]`
   - `.*\.tmp\.[a-zA-Z0-9]+$`
   Debounce raw filesystem events by 50ms per normalized path.
2. In `packages/cli/src/server.ts`:
   Scope SSE broadcast channels by topic: `corpus`, `jobs:${jobId}`, `workspace_integrity`.
3. In `packages/ui/src/hooks/useLiveSync.ts` and `useDeskData.ts`:
   Subscribe only to the active view's topic. Coalesce incoming refresh requests with a leading edge fetch and at most one trailing fetch. Discard redundant in-flight fetches using `AbortController`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/watcher.test.ts -t "ignores sqlite wal/shm"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/watcher.ts packages/cli/src/server.ts packages/ui/src/hooks/useLiveSync.ts packages/ui/src/hooks/useDeskData.ts packages/ui/src/components/Layout.tsx packages/cli/tests/watcher.test.ts
git commit -m "fix(sync): filter operational file churn and scope live refresh subscriptions (BUG-005)"
```

---

### Task 8 (BUG-009): Give Resume Variants Unique Identities and Searchable Choices [Task Master: 58]

**Files:**
- Modify: `packages/cli/src/server.ts`
- Modify: `packages/cli/src/jobs/runtime.ts`
- Modify: `packages/ui/src/components/ResumeVariantPicker.tsx`
- Modify: `packages/ui/src/views/jobs/JobInputReview.tsx`
- Test: `packages/cli/tests/resume-variants.test.ts` (create or update)

- [x] **Step 1: Write failing test for unique resume identity across directories and extensions**

In `packages/cli/tests/resume-variants.test.ts`:
```typescript
it('assigns unique identities to identically-named resumes across directories and extensions', () => {
  const files = [
    'resumes/tailored/main.yaml',
    'resumes/tailored/main.tex',
    'resumes/archive/main.yaml',
  ];
  const specs = loadResumeSpecsFromPaths(files, '/workspace');

  const ids = specs.map(s => s.id);
  expect(new Set(ids).size).toBe(3);
  expect(specs[0].id).toBe('tailored/main:yaml');
  expect(specs[1].id).toBe('tailored/main:tex');
  expect(specs[2].id).toBe('archive/main:yaml');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/resume-variants.test.ts -t "assigns unique identities"`
Expected: FAIL with duplicate IDs like `tailored-main`.

- [x] **Step 3: Implement normalized namespaced resume identifiers and searchable picker**

1. In `packages/cli/src/server.ts` (`loadResumeSpecs`):
   Derive resume IDs by normalizing workspace-relative paths with POSIX slashes: `${relativePathWithoutExt}:${extension}`.
   Provide a backward-compatible resolver: if a legacy job specifies `tailored-main`, resolve it only if exactly one file matches; otherwise flag it as ambiguous requiring explicit re-selection.
2. In `packages/cli/src/jobs/runtime.ts`:
   Store the exact normalized `resume_id`, relative path, and content sha256 in captured input records.
3. In `packages/ui/src/components/ResumeVariantPicker.tsx`:
   Add a search input filtering on display title, directory path, and file type. Show file extension and modified date for clear distinction.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/resume-variants.test.ts -t "assigns unique identities"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/server.ts packages/cli/src/jobs/runtime.ts packages/ui/src/components/ResumeVariantPicker.tsx packages/ui/src/views/jobs/JobInputReview.tsx packages/cli/tests/resume-variants.test.ts
git commit -m "fix(resumes): derive unique namespaced identities and add searchable variant picker (BUG-009)"
```

---

### Task 9 (BUG-008): Display Resolved and Captured Starting Resume Selections [Task Master: 59]

**Files:**
- Modify: `packages/ui/src/views/jobs/JobInputReview.tsx`
- Modify: `packages/cli/src/jobs/runtime.ts`
- Modify: `packages/cli/src/jobs/artifacts.ts`
- Modify: `packages/core/src/jobs/schemas.ts`
- Test: `packages/ui/tests/jobs-ui.test.tsx`

- [x] **Step 1: Write failing UI test for captured versus next-run resume selection display**

In `packages/ui/tests/jobs-ui.test.tsx`:
```typescript
it('displays active captured resume fingerprint alongside next-run selection without false empty state', () => {
  renderJobInputReview({
    capturedInputs: {
      resume_id: 'tailored/main:yaml',
      resume_path: 'resumes/tailored/main.yaml',
      resume_fingerprint: 'sha256:abc1234',
    },
    currentSelection: null, // null selector falling back to default
    resolvedDefaultId: 'tailored/main:yaml',
  });

  expect(screen.getByTestId('captured-resume-label')).toHaveTextContent('resumes/tailored/main.yaml (Captured for current draft)');
  expect(screen.getByTestId('next-selection-label')).toHaveTextContent('Default: resumes/tailored/main.yaml');
  expect(screen.queryByText('Select a saved starting resume')).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/jobs-ui.test.tsx -t "displays active captured resume fingerprint"`
Expected: FAIL showing unselected empty prompt "Select a saved starting resume" even though captured inputs exist.

- [x] **Step 3: Update input review component and capture metadata schemas**

1. In `packages/core/src/jobs/schemas.ts`:
   Extend `JobInputsSnapshotSchema` to include optional `resolved_resume_path`, `resolved_resume_fingerprint`, `page_budget`, and `recorded_runner`.
2. In `packages/cli/src/jobs/runtime.ts`:
   Record the resolved default when capture inputs are created.
3. In `packages/ui/src/views/jobs/JobInputReview.tsx`:
   Differentiate:
   - "Captured input for active draft/PDF" (read-only snapshot context).
   - "Selection for next preparation run" (editable picker).
   If selectors are null, display "Default (resolves to X)" instead of an empty unselected dropdown.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/jobs-ui.test.tsx -t "displays active captured resume fingerprint"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/ui/src/views/jobs/JobInputReview.tsx packages/cli/src/jobs/runtime.ts packages/cli/src/jobs/artifacts.ts packages/core/src/jobs/schemas.ts packages/ui/tests/jobs-ui.test.tsx
git commit -m "fix(inputs): clarify captured starting resume versus next-run selection (BUG-008)"
```

---

### Task 10 (BUG-010): Distinguish Unknown Workspace Audit State and Job-Local Blockers [Task Master: 60]

**Files:**
- Modify: `packages/ui/src/components/desk/DeskHeader.tsx`
- Modify: `packages/ui/src/components/Layout.tsx`
- Modify: `packages/ui/src/components/IntegrityModal.tsx`
- Test: `packages/ui/tests/jobs-polish.test.tsx`

- [x] **Step 1: Write failing UI test for workspace audit states (loading, error, clean, findings)**

In `packages/ui/tests/jobs-polish.test.tsx`:
```typescript
it('distinguishes workspace audit checking, failure, and scope from current job blockers', () => {
  renderDeskHeader({
    workspaceAudit: { status: 'error', error: 'Integrity check timed out' },
    jobBlockersCount: 2,
  });

  const auditBadge = screen.getByTestId('workspace-audit-badge');
  expect(auditBadge).toHaveTextContent('Workspace audit: unavailable');
  expect(auditBadge).not.toHaveTextContent('0 Issues');

  const jobBadge = screen.getByTestId('job-blockers-badge');
  expect(jobBadge).toHaveTextContent('2 Job blockers');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/jobs-polish.test.tsx -t "distinguishes workspace audit checking"`
Expected: FAIL showing default "0 Issues" badge when audit fails or is in-flight.

- [x] **Step 3: Implement explicit workspace audit state machine and badge scoping**

1. In `packages/ui/src/components/Layout.tsx`:
   Store full `auditState`: `{ status: 'idle' | 'checking' | 'ready' | 'error' | 'stale', issuesCount?: number, lastChecked?: string, error?: string }`. Do not fallback to 0 issues on network catch.
2. In `packages/ui/src/components/desk/DeskHeader.tsx`:
   Render:
   - `checking`: "Workspace audit: Checking..."
   - `error`: "Workspace audit: Unavailable (Retry)"
   - `ready`: `${count} Workspace issues` or `Workspace clean`
   Include accessible `aria-label` specifying "Entire career repository audit".
3. Keep current job review badges separated in the Job detail subheader.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/jobs-polish.test.tsx -t "distinguishes workspace audit checking"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/ui/src/components/desk/DeskHeader.tsx packages/ui/src/components/Layout.tsx packages/ui/src/components/IntegrityModal.tsx packages/ui/tests/jobs-polish.test.tsx
git commit -m "fix(audit): represent workspace audit status truthfully without masking failures (BUG-010)"
```

---

## Phase 3: Contract Extensions and Human-Supported Tailoring

Focus: `FEAT-001`, `FEAT-002`, `FEAT-003`, `FEAT-004`, and `FEAT-005`.

### Task 11 (FEAT-001): Retain Structured Posting Context and Provenance [Task Master: 61]

**Files:**
- Modify: `packages/cli/src/jobs/posting-extractor.ts`
- Modify: `packages/cli/src/jobs/intake.ts`
- Modify: `packages/core/src/jobs/schemas.ts`
- Modify: `packages/ui/src/views/jobs/JobInputReview.tsx`
- Test: `packages/cli/tests/job-intake.test.ts` (create or update)

- [x] **Step 1: Write failing test for structured compensation, regions, and job details extraction**

In `packages/cli/tests/job-intake.test.ts`:
```typescript
it('extracts multi-region compensation and location metadata with source text and provenance', async () => {
  const html = `
    <html>
      <div class="location">Remote - US, UK, LATAM</div>
      <div class="salary">US: $160,000 - $190,000 USD | UK: £100,000 - £120,000 GBP</div>
      <div class="employment-type">Full-time Employee</div>
      <div class="description"><p>Lead frontend development across platforms...</p></div>
    </html>
  `;
  const parsed = await extractPostingMetadata(html, 'https://example.com/jobs/123');

  expect(parsed.compensation).toEqual([
    { region: 'US', currency: 'USD', min: 160000, max: 190000, period: 'annual', raw_text: '$160,000 - $190,000 USD' },
    { region: 'UK', currency: 'GBP', min: 100000, max: 120000, period: 'annual', raw_text: '£100,000 - £120,000 GBP' },
  ]);
  expect(parsed.employment_type).toBe('Full-time Employee');
  expect(parsed.remote_policy).toBe('Remote');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/job-intake.test.ts -t "extracts multi-region compensation"`
Expected: FAIL with undefined `compensation` or missing structured regions.

- [x] **Step 3: Implement structured position details extraction and UI display**

1. In `packages/core/src/jobs/schemas.ts`:
   Add `JobPostingMetadataSchema`:
   ```typescript
   export const JobPostingMetadataSchema = z.object({
     remote_policy: z.string().optional(),
     locations: z.array(z.string()).default([]),
     employment_type: z.string().optional(),
     compensation: z.array(z.object({
       region: z.string().optional(),
       currency: z.string().min(1),
       min: z.number().optional(),
       max: z.number().optional(),
       period: z.enum(['annual', 'monthly', 'hourly', 'unknown']),
       raw_text: z.string(),
     })).default([]),
     source_url: z.string().url().optional(),
     captured_at: z.string(),
   }).strict();
   ```
2. In `packages/cli/src/jobs/posting-extractor.ts`:
   Parse Schema.org `JobPosting` JSON-LD if present; fallback to regex-based extraction of multi-currency salary bands and location blocks. Retain exact source excerpts.
3. In `packages/ui/src/views/jobs/JobInputReview.tsx`:
   Render a "Position Details" panel displaying location, employment type, and regional pay rates.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/job-intake.test.ts -t "extracts multi-region compensation"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/jobs/posting-extractor.ts packages/cli/src/jobs/intake.ts packages/core/src/jobs/schemas.ts packages/ui/src/views/jobs/JobInputReview.tsx packages/cli/tests/job-intake.test.ts
git commit -m "feat(jobs): retain structured posting context, regional compensation, and provenance (FEAT-001)"
```

---

### Task 12 (FEAT-002): Expose Preparation Phase Elapsed Time and Recorded Usage [Task Master: 62]

**Files:**
- Modify: `packages/cli/src/jobs/runtime.ts`
- Modify: `packages/core/src/jobs/schemas.ts`
- Modify: `packages/ui/src/views/jobs/JobDetail.tsx`
- Test: `packages/ui/tests/jobs-ui.test.tsx`

- [x] **Step 1: Write failing test for preparation phase progression, elapsed clock, and recorded usage**

In `packages/ui/tests/jobs-ui.test.tsx`:
```typescript
it('displays phase name, elapsed time, and truthful runner usage without inventing token counts', () => {
  renderJobDetailWithProgress({
    preparation: {
      status: 'active',
      phase: 'checking_support',
      started_at: new Date(Date.now() - 45000).toISOString(),
      active_checkpoint: 'semantic_classification_batch_2',
      recorded_usage: {
        model: 'runner-default',
        calls: 3,
        tokens: null, // explicitly unrecorded
      },
    },
  });

  expect(screen.getByTestId('prep-phase-title')).toHaveTextContent('Checking support');
  expect(screen.getByTestId('prep-elapsed-time')).toHaveTextContent('0:45');
  expect(screen.getByTestId('prep-usage-model')).toHaveTextContent('runner-default');
  expect(screen.getByTestId('prep-usage-tokens')).toHaveTextContent('Not recorded');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/jobs-ui.test.tsx -t "displays phase name, elapsed time"`
Expected: FAIL with generic "Preparation claimed" or missing elapsed timer element.

- [x] **Step 3: Track phase transitions, timestamps, and model usage in runtime & UI**

1. In `packages/core/src/jobs/schemas.ts`:
   Extend `JobPreparationProgressSchema`:
   ```typescript
   export const JobPreparationProgressSchema = z.object({
     phase: z.enum(['preparing_resume', 'checking_support', 'rendering_pdf', 'needs_answer', 'needs_retry', 'ready_to_review']),
     phase_started_at: z.string(),
     elapsed_seconds: z.number().int().nonnegative().optional(),
     current_operation: z.string().optional(),
     usage: z.object({
       model: z.string().default('runner-default'),
       api_calls: z.number().int().nonnegative(),
       tokens: z.number().int().nullable().default(null),
     }).optional(),
   }).strict();
   ```
2. In `packages/cli/src/jobs/runtime.ts`:
   Update progress record during preparation coordinator steps.
3. In `packages/ui/src/views/jobs/JobDetail.tsx`:
   Render phase title and tick client-side elapsed timer derived from `phase_started_at` without firing repeated network requests. Display usage metadata truthfully.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/jobs-ui.test.tsx -t "displays phase name, elapsed time"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/jobs/runtime.ts packages/core/src/jobs/schemas.ts packages/ui/src/views/jobs/JobDetail.tsx packages/ui/tests/jobs-ui.test.tsx
git commit -m "feat(jobs): display preparation phase, elapsed time, and truthful runner usage (FEAT-002)"
```

---

### Task 13 (FEAT-003): Save Mixed Wording Edits Atomically Before Checking [Task Master: 63]

**Files:**
- Modify: `packages/cli/src/jobs/proposal-service.ts`
- Modify: `packages/core/src/jobs/proposal-review.ts`
- Modify: `packages/ui/src/views/jobs/JobProposalReview.tsx`
- Modify: `packages/ui/src/views/jobs/JobStartingResumeCorrection.tsx`
- Test: `packages/cli/tests/job-proposal-service.test.ts`
- Test: `packages/ui/tests/job-proposal-review.test.tsx`

- [x] **Step 1: Write failing test for atomic mixed edit batch saving across generated and inherited bullets**

In `packages/cli/tests/job-proposal-service.test.ts`:
```typescript
it('applies batch of inherited base corrections and generated edits atomically with revision fencing', async () => {
  const service = new JobProposalService(fixtureRepo);
  const mutation = {
    job_id: 'job-123',
    expected_revision: 5,
    idempotency_key: 'idem-batch-1',
    base_corrections: [
      { bullet_index: 0, before: 'Legacy bullet 1', after: 'Corrected bullet 1' },
    ],
    generated_patches: [
      { proposal_id: 'prop-1', before: 'Generated text', after: 'User edited generated text' },
    ],
  };

  const result = await service.saveMixedDraftEdits(mutation);
  expect(result.success).toBe(true);
  expect(result.new_revision).toBe(6);

  // Stale expected_revision rejects entire batch atomically
  await expect(service.saveMixedDraftEdits({ ...mutation, expected_revision: 5 }))
    .rejects.toThrow('Stale revision');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/job-proposal-service.test.ts -t "applies batch of inherited base corrections"`
Expected: FAIL with `saveMixedDraftEdits` not defined or non-atomic sequential save behavior.

- [x] **Step 3: Implement atomic mixed edit mutation service and client auto-save coordinator**

1. In `packages/core/src/jobs/proposal-review.ts`:
   Define `MixedDraftMutationSchema` admitting both `base_corrections` and `generated_patches` in a single request.
2. In `packages/cli/src/jobs/proposal-service.ts`:
   Process the mutation in one database transaction. If any target text does not match the current working candidate or if `expected_revision` is stale, rollback completely. Advance draft revision by 1.
3. In `packages/ui/src/views/jobs/JobProposalReview.tsx` and `JobStartingResumeCorrection.tsx`:
   Share a unified debounced draft auto-saver. Coalesce typing bursts across both editor surfaces into one atomic server submission. Indicate "Saving...", "Saved", or "Conflict: edit rejected" inline.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/job-proposal-service.test.ts -t "applies batch of inherited base corrections"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/cli/src/jobs/proposal-service.ts packages/core/src/jobs/proposal-review.ts packages/ui/src/views/jobs/JobProposalReview.tsx packages/ui/src/views/jobs/JobStartingResumeCorrection.tsx packages/cli/tests/job-proposal-service.test.ts
git commit -m "feat(proposals): save mixed generated and inherited edits in atomic revisions (FEAT-003)"
```

---

### Task 14 (FEAT-004): Prioritize Supported Accomplishments and Narrow Unsupported Scope [Task Master: 64]

**Files:**
- Modify: `packages/core/src/jobs/synthesis.ts`
- Modify: `packages/core/src/jobs/career-layout.ts`
- Modify: `packages/cli/src/jobs/preparation.ts`
- Test: `packages/core/tests/accomplishment-synthesis.test.ts`
- Test: `packages/core/tests/career-layout.test.ts`

- [x] **Step 1: Write failing calibration test for role accomplishment ranking and scope narrowing**

In `packages/core/tests/accomplishment-synthesis.test.ts`:
```typescript
it('ranks frontend visualization higher for frontend role and narrows unsupported component coupling claims', () => {
  const candidate = synthesizeExperienceBullets({
    role_requirements: ['frontend observability', 'data visualization', 'test isolation'],
    experience: {
      employer: 'Parable',
      accomplishments: [
        { id: 'acc-1', topic: 'general administration', evidence_supported: true },
        { id: 'acc-2', topic: 'time spend visualization and drilldown', evidence_supported: true },
        { id: 'acc-3', topic: 'internal build scripting', evidence_supported: true },
      ],
    },
  });

  // Visualization accomplishment ranked first
  expect(candidate.bullets[0].accomplishment_id).toBe('acc-2');
  // Does not claim adoption/metrics without cited support
  expect(candidate.bullets[0].text).not.toMatch(/improved team velocity by \d+%/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/accomplishment-synthesis.test.ts -t "ranks frontend visualization higher"`
Expected: FAIL with arbitrary ordering or unsupported speculative metrics.

- [x] **Step 3: Update accomplishment synthesis ranking and narrow unproven qualifiers**

1. In `packages/core/src/jobs/synthesis.ts`:
   Implement relevance-based bullet ranking that pairs requirement keywords against accomplishment evidence vectors. Prioritize items with direct verified evidence.
   Add constraint: When candidate phrasing introduces unsupported pluralizations (e.g. "SDKs" when only 1 SDK exists) or unproven causations, automatically narrow to singular, documented actions ("developed the client SDK").
2. In `packages/core/src/jobs/career-layout.ts`:
   Ensure reordered bullets emit valid diff operations and preserve page-fit budgets without dropping font sizes below LaTeX readability thresholds.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/accomplishment-synthesis.test.ts -t "ranks frontend visualization higher"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/core/src/jobs/synthesis.ts packages/core/src/jobs/career-layout.ts packages/cli/src/jobs/preparation.ts packages/core/tests/accomplishment-synthesis.test.ts
git commit -m "feat(synthesis): rank relevant supported accomplishments and narrow unsupported scope (FEAT-004)"
```

---

### Task 15 (FEAT-005): Reuse Scoped Human Employment Facts [Task Master: 45]

**Files:**
- Modify: `packages/core/src/corpus/schemas.ts`
- Modify: `packages/core/src/corpus/clarifications.ts`
- Modify: `packages/core/src/jobs/semantic-evidence.ts`
- Modify: `packages/core/src/jobs/semantic-transport.ts`
- Modify: `packages/cli/src/jobs/semantic-service.ts`
- Modify: `packages/cli/src/corpus/repository.ts`
- Modify: `packages/ui/src/views/jobs/JobFacts.tsx`
- Test: `packages/cli/tests/shared-clarification-workflow.test.ts`
- Test: `packages/ui/tests/job-facts.test.tsx`

- [x] **Step 1: Write failing test for source-free title confirmation and cross-job reuse**

In `packages/cli/tests/shared-clarification-workflow.test.ts`:
```typescript
it('allows confirming formal title without ledger quotation and reuses it for the same employment in another job', async () => {
  const service = new JobSemanticService(fixtureRepo, mockRunner);

  // 1. Confirm title at Kong with no ledger quotations
  const answer = await service.saveHumanConfirmation({
    job_id: 'job-1',
    employment: { employer: 'Kong', period: '2021 - 2024' },
    question: 'Was Senior Software Engineer your formal title at Kong?',
    confirmed_title: 'Senior Software Engineer',
    scope: 'remember_for_employment',
  });

  expect(answer.support_basis).toBe('human_confirmation');
  expect(answer.sources).toHaveLength(0);

  // 2. Classify a second job with Kong employment
  const secondJobResult = await service.resolveJobSupport('job-2', { employer: 'Kong' });
  const titleClaim = secondJobResult.passages.find(p => p.text.includes('Senior Software Engineer'));
  expect(titleClaim?.status).toBe('supported');
  expect(titleClaim?.support_label).toBe('Confirmed by you');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/shared-clarification-workflow.test.ts -t "allows confirming formal title without ledger quotation"`
Expected: FAIL because schema requires `sources.length > 0` or rejects source-free shared clarifications.

- [x] **Step 3: Implement stable employment identity and human confirmation support basis**

1. In `packages/core/src/corpus/schemas.ts` and `semantic-evidence.ts`:
   Update `SharedClarificationSchema`:
   - `support_basis: z.enum(['captured_evidence', 'human_confirmation', 'both'])`
   - `sources: z.array(z.string()).default([])` (optional when `support_basis` is `'human_confirmation'`)
   - `human_provenance`: `{ actor: 'user', confirmed_at: string, question: string, answer: string, employment_id: string }`
2. In `packages/cli/src/corpus/repository.ts`:
   Store and index clarifications by stable `employment_id` (hash of normalized company + tenure period).
3. In `packages/cli/src/jobs/semantic-service.ts`:
   Resolve title support by matching stable `employment_id`. Do not require ledger quotes. Retain label "Confirmed by you".
4. In `packages/ui/src/views/jobs/JobFacts.tsx`:
   Provide "Remember for this employment" option when answering title prompts.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/shared-clarification-workflow.test.ts -t "allows confirming formal title without ledger quotation"`
Expected: PASS.

- [x] **Step 5: Commit changes**

```bash
git add packages/core/src/corpus/schemas.ts packages/core/src/corpus/clarifications.ts packages/core/src/jobs/semantic-evidence.ts packages/core/src/jobs/semantic-transport.ts packages/cli/src/jobs/semantic-service.ts packages/cli/src/corpus/repository.ts packages/ui/src/views/jobs/JobFacts.tsx packages/cli/tests/shared-clarification-workflow.test.ts
git commit -m "feat(corpus): allow source-free human confirmation for employment titles with cross-job reuse (FEAT-005)"
```

---

## Phase 4: Integrated Verification & Acceptance Gate

Focus: Verify the 13 required scenarios from [`docs/implementation/netbox-followups/README.md`](file:///C:/Users/drewk/featherduster/docs/implementation/netbox-followups/README.md).

### Task 16: Comprehensive Suite & Delivery Verification

**Files:**
- Create: `scripts/verify-netbox-followups.mjs`
- Test: Full Vitest suite (`packages/core`, `packages/cli`, `packages/ui`)

- [x] **Step 1: Create automated verification script running all 13 NetBox scenarios**

Create `scripts/verify-netbox-followups.mjs` to execute programmatic tests against a disposable test workspace for each scenario:
1. 52 saved jobs, 37 PDFs, 4 confirmations -> no correction scan latency spike.
2. 1 correction among 52 jobs -> bounded discovery, no PDF bytes read.
3. Batch 3 malformed -> batches 1-2 preserved, technical retry available.
4. Numeric baseline finding -> bound to original baseline wording, not number-free replacement.
5. Generated bindings omit connective text -> gap offsets identified, strict contract satisfied.
6. Worker leases / snapshot bursts -> zero evidence/rubric refetches.
7. Mixed edits typing burst -> saved as atomic revision.
8. Human title confirmation -> reused in second synthetic job without quotes.
9. Final PDF change summary -> lists inherited corrections and original-to-final diff.
10. Same-named resume files -> unique namespaced identities and searchable selection.
11. Multi-region posting metadata -> US/UK/LATAM preserved across intake.
12. Job-specific accomplishment ranking -> visualization leads for frontend role.
13. Desktop & 390-pixel responsive layout -> zero horizontal overflow.

- [x] **Step 2: Run verification script**

Run: `node scripts/verify-netbox-followups.mjs`
Expected: All 13 scenario assertions PASS.

- [x] **Step 3: Run full repository test suite and typecheck**

Run: `npm test`
Run: `npm run build`
Expected: All tests pass, build succeeds with zero TypeScript errors.

- [x] **Step 4: Commit verification script**

```bash
git add scripts/verify-netbox-followups.mjs
git commit -m "test(acceptance): add end-to-end regression verification script for NetBox follow-ups"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-08-netbox-followups-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
