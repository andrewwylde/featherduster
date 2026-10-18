# Resume Editing and Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated job resumes easy to inspect, edit, reactively validate, finalize, and download, while improving variant search and defaulting Jobs intake to URLs.

**Architecture:** Keep draft persistence independent of validation. Add a job-bound check/finalize service using the existing evidence rules, renderer, immutable artifact bundles, and revision checks; present it through a focused editor controller and a preview-first review with a Details menu. Preserve automatic preparation, historical artifacts, approval semantics, and reusable-variant boundaries.

**Tech Stack:** TypeScript, React 18, Tailwind, Hono, Zod, better-sqlite3, existing LaTeX/PDF renderer, Vitest, React Testing Library.

---

## Read first

- Approved requirements: `docs/superpowers/specs/2026-10-18-resume-editing-and-finalization-design.md`.
- Baseline inspected: commit `9e4d805`; implementation has not started.
- Run commands from the repository root in PowerShell. Do not stage the user's unrelated `package-lock.json` change.
- Tasks 1 and 2 are independent, shippable improvements. Tasks 3–10 form the job-resume lifecycle change and should ship together; Task 11 verifies the combined result. Keep them in one plan because they share the approved user journey, but do not couple their APIs unnecessarily.
- Existing artifact `attempt_id` identifies the preparation lineage. Manual finalization will retain the parent's original attempt as provenance and add `origin: 'manual'`; it will not create or claim a fake worker attempt. A separate manual publication method uses compare-and-swap inside an immediate SQLite transaction. Rendering happens before that transaction.
- Existing immutable records must continue to deserialize byte-for-byte. New artifact fields are optional with **no schema default**. No database migration is required for optional JSON metadata or a new event payload kind.
- Keep each numbered step independently reviewable. For longer code blocks, add one exported function/method at a time and run the named focused test before the task commit.

## File map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Intake | `packages/ui/src/views/jobs/JobIntake.tsx` | URLs default, Text fallback |
| Variant picker | `packages/ui/src/components/ResumeVariantPicker.tsx`, `packages/ui/src/components/resume-variant-search.ts` | Accessible selection and deterministic fuzzy ranking |
| Draft contracts | `packages/core/src/jobs/draft-content.ts`, `packages/core/src/jobs/draft-validation.ts`, `packages/core/src/jobs/schemas.ts`, `packages/core/src/index.ts` | Editable shape, check bindings/issues, unchanged strict final schema |
| Shared candidate checks | `packages/core/src/jobs/candidate-checks.ts`, `packages/core/src/jobs/proposal-review.ts` | Field-level validation reused by proposal review and manual checks |
| Job context and rendering | `packages/cli/src/jobs/resume-context.ts`, `packages/cli/src/jobs/checked-render.ts`, `packages/cli/src/jobs/preparation.ts`, `packages/cli/src/jobs/exports.ts` | Shared freshness rules and verified output |
| Manual finalization | `packages/cli/src/jobs/draft-finalization.ts`, `packages/cli/src/jobs/artifacts.ts`, `packages/cli/src/jobs/repository.ts` | Bounded check cache, exact revision publication, idempotency |
| Transport | `packages/cli/src/jobs/runtime.ts`, `packages/cli/src/jobs/routes.ts`, `packages/ui/src/api/client.ts` | Typed check/finalize endpoints and historical PDF attachments |
| Reactive UI | `packages/ui/src/views/jobs/useJobDraftChecks.ts`, `packages/ui/src/views/jobs/JobDraftActions.tsx`, `packages/ui/src/views/ResumeTailor.tsx` | Debounce, stale-result rejection, independent saving, finalization and leave handling |
| Review presentation | `packages/ui/src/views/jobs/JobResumeDetails.tsx`, `packages/ui/src/views/jobs/JobResumeReview.tsx`, `packages/ui/src/views/jobs/job-utils.ts` | Details navigation, one preview, explicit download semantics |
| Verification | New focused tests named in each task; existing Jobs and canvas suites | Behavior, concurrency, regression protection |

## Task 1: Default Jobs intake to URLs

**Files:** Modify `packages/ui/src/views/jobs/JobIntake.tsx`; create `packages/ui/tests/job-intake-default.test.tsx`.

- [ ] **1. Add a focused regression test.**

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { JobIntake } from '../src/views/jobs/JobIntake.js';
afterEach(cleanup);
it('opens normal intake in URLs and still lets the user choose Text', () => {
  render(<JobIntake onSaved={() => {}} />);
  expect(screen.getByRole('button', { name: 'URLs', pressed: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Posting text' }));
  expect(screen.getByRole('button', { name: 'Posting text', pressed: true })).toBeInTheDocument();
});
it('opens failed-capture recovery in Text', () => {
  render(<JobIntake fallback={{ id: 'job', revision: 1 }} onSaved={() => {}} />);
  expect(screen.getByRole('button', { name: 'Posting text', pressed: true })).toBeInTheDocument();
});
```

- [ ] **2. Run the test before changing the component.** `npx vitest run packages/ui/tests/job-intake-default.test.tsx`. Expected: FAIL because the buttons lack pressed state and normal intake starts in Text.
- [ ] **3. Change the initializer and add pressed state to the existing buttons.** Keep their existing click handlers and styling.

```tsx
const [mode, setMode] = useState<'urls' | 'text'>(() => fallback ? 'text' : 'urls');
// URLs button:
aria-pressed={mode === 'urls'}
// Text button:
aria-pressed={mode === 'text'}
```

- [ ] **4. Verify.** `npx vitest run packages/ui/tests/job-intake-default.test.tsx packages/ui/tests/jobs-ui.test.tsx`. Expected: PASS after updating existing normal-intake tests to explicitly select Text before pasting text. Use `fireEvent.click(screen.getByRole('button', { name: 'Posting text' }));` only in tests intending text input; do not weaken assertions.
- [ ] **5. Commit.** `git add packages/ui/src/views/jobs/JobIntake.tsx packages/ui/tests/job-intake-default.test.tsx packages/ui/tests/jobs-ui.test.tsx` then `git commit -m "feat(jobs): default intake to URLs"`.

## Task 2: Searchable variant selection

**Files:** Create the two picker files in the map and `packages/ui/tests/resume-variant-picker.test.tsx`; modify `packages/ui/src/views/ResumeTailor.tsx` and the native-select assertions in `packages/ui/tests/resume-tailor.test.tsx`.

- [ ] **1. Write search and keyboard behavior tests.**

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { rankResumeVariants } from '../src/components/resume-variant-search.js';
import { ResumeVariantPicker } from '../src/components/ResumeVariantPicker.js';
const options = [
  { id: 'a', name: 'Senior Engineer', type: 'tailored' },
  { id: 'b', name: 'Engineer', type: 'template' },
  { id: 'c', name: 'Principal Engineer', type: 'tailored' },
];
afterEach(cleanup);
it('ranks exact before substring and supports ordered-character search', () => {
  expect(rankResumeVariants(options, ' engineer ').map(x => x.id)).toEqual(['b', 'a', 'c']);
  expect(rankResumeVariants(options, 'snr eng').map(x => x.id)).toEqual(['a']);
  expect(rankResumeVariants(options, 'TEMPLATE').map(x => x.id)).toEqual(['b']);
  expect(rankResumeVariants(options, '')).toEqual(options);
});
it('filters without selection and commits only on Enter', () => {
  const select = vi.fn();
  render(<ResumeVariantPicker options={options} value="b" onSelect={select} />);
  const input = screen.getByRole('combobox', { name: 'Select resume variant' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'snr eng' } });
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith('a');
});
it('retains a missing selected source and supports escape/no-results', () => {
  render(<ResumeVariantPicker options={options} value="saved-id" onSelect={() => {}} />);
  const input = screen.getByRole('combobox');
  expect(input).toHaveValue('saved-id (saved source)');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'zzzz' } });
  expect(screen.getByText('No matching resumes')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue('saved-id (saved source)');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});
```

- [ ] **2. Run:** `npx vitest run packages/ui/tests/resume-variant-picker.test.tsx`. Expected: missing modules.
- [ ] **3. Create `resume-variant-search.ts`.**

```ts
export interface VariantOption { id: string; name: string; type: string }
const normalize = (s: string) => s.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
function subsequence(query: string, text: string): boolean {
  let i = 0;
  for (const c of text) if (c === query[i]) i++;
  return i === query.length;
}
export function rankResumeVariants<T extends VariantOption>(options: readonly T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return [...options];
  return options.map((option, index) => {
    const name = normalize(option.name), text = `${name} ${normalize(option.type)}`;
    const rank = name === q ? 0 : name.startsWith(q) ? 1 : text.includes(q) ? 2
      : subsequence(q.replace(/\s/g, ''), text.replace(/\s/g, '')) ? 3 : 4;
    return { option, index, rank };
  }).filter(x => x.rank < 4).sort((a, b) => a.rank - b.rank || a.index - b.index).map(x => x.option);
}
```

- [ ] **4. Create `ResumeVariantPicker.tsx`.**

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import { rankResumeVariants, type VariantOption } from './resume-variant-search.js';
export function ResumeVariantPicker({ options, value, onSelect }: {
  options: readonly VariantOption[]; value: string; onSelect(id: string): void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const selected = options.find(o => o.id === value);
  const label = selected ? `${selected.name} (${selected.type})` : value ? `${value} (saved source)` : '';
  const results = rankResumeVariants(options, query);
  const close = () => { setOpen(false); setQuery(''); setActive(-1); };
  const choose = (option: VariantOption) => { onSelect(option.id); close(); };
  useEffect(() => {
    root.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, query]);
  return <div ref={root} className="relative" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  }}>
    <input role="combobox" aria-label="Select resume variant" aria-autocomplete="list"
      aria-expanded={open} aria-controls={`${id}-list`}
      aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
      value={open ? query : label} placeholder="Search resumes…"
      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={e => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); setOpen(true);
          setActive(n => results.length ? (e.key === 'ArrowDown' ? (n + 1) % results.length : (n <= 0 ? results.length - 1 : n - 1)) : -1);
        }
        if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); }
        if (e.key === 'Tab') close();
      }} />
    {open && <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-700 bg-slate-950 text-white shadow-lg">
      <ul id={`${id}-list`} role="listbox" aria-label="Resume variants">
        {results.map((option, index) => <li key={option.id} id={`${id}-${index}`} role="option"
          aria-selected={option.id === value} data-active={index === active}
          className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-slate-700' : ''}`}
          onMouseDown={e => e.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(option)}>
          {option.name} ({option.type})
        </li>)}
      </ul>
      {!results.length && <p role="status" className="p-3 text-sm">No matching resumes</p>}
    </div>}
  </div>;
}
```

- [ ] **5. Integrate.** Import `ResumeVariantPicker` from `../components/ResumeVariantPicker.js` in `ResumeTailor.tsx`; replace only the existing select labeled `Select resume variant` with:

```tsx
<ResumeVariantPicker options={resumes} value={selectedResumeId} onSelect={handleSelectResume} />
```

Replace the existing saved-source assertion `toHaveValue('second')` with `toHaveValue('second (saved source)')`. Replace source-selection `fireEvent.change` tests with focus, query, ArrowDown, Enter. Keep `handleSelectResume` unchanged, including its `onSourceSelect` interception.

- [ ] **6. Run:** `npx vitest run packages/ui/tests/resume-variant-picker.test.tsx packages/ui/tests/resume-tailor.test.tsx packages/ui/tests/tailoring-setup-drafts.test.tsx`. Expected: PASS.
- [ ] **7. Commit:** `git add packages/ui/src/components/ResumeVariantPicker.tsx packages/ui/src/components/resume-variant-search.ts packages/ui/src/views/ResumeTailor.tsx packages/ui/tests/resume-variant-picker.test.tsx packages/ui/tests/resume-tailor.test.tsx packages/ui/tests/tailoring-setup-drafts.test.tsx` then `git commit -m "feat(tailor): add searchable resume variant picker"`.

## Task 3: Allow incomplete drafts and define exact check bindings

**Files:** Create `packages/core/src/jobs/draft-content.ts`, `packages/core/src/jobs/draft-validation.ts`, `packages/core/tests/job-draft-content.test.ts`; modify `packages/core/src/jobs/schemas.ts`, `packages/core/src/index.ts`, and the job draft PUT route in `packages/cli/src/jobs/routes.ts`.

- [ ] **1. Add the schema regression test.**

```ts
import { expect, it } from 'vitest';
import { DraftResumeSpecSchema, ResumeSpecSchema, DEFAULT_STARTER_RESUME } from '../src/index.js';
it('persists incomplete text without weakening finalized resume requirements', () => {
  const candidate = structuredClone(DEFAULT_STARTER_RESUME);
  candidate.profile.name = '';
  candidate.experiences[0].bullets[0].text = '';
  expect(DraftResumeSpecSchema.parse(candidate)).toEqual(candidate);
  expect(ResumeSpecSchema.safeParse(candidate).success).toBe(false);
  expect(DraftResumeSpecSchema.safeParse({ ...candidate, experiences: 'wrong' }).success).toBe(false);
});
```

- [ ] **2. Run:** `npx vitest run packages/core/tests/job-draft-content.test.ts`. Expected: missing export.
- [ ] **3. Create the draft-only schema.** Preserve the same TypeScript shape while permitting empty editable strings. Do not loosen `ResumeSpecSchema` itself.

```ts
// packages/core/src/jobs/draft-content.ts
import { z } from 'zod';
import { ResumeSpecSchema, ResumeProfileSchema, ResumeExperienceSchema,
  ResumeBulletSchema, ResumeEducationSchema, ResumeSkillGroupSchema } from '../schemas/resume.js';
export const DraftResumeSpecSchema = ResumeSpecSchema.extend({
  profile: ResumeProfileSchema.extend({ name: z.string(), title: z.string(), email: z.string() }),
  experiences: z.array(ResumeExperienceSchema.extend({
    company: z.string(), role: z.string(), startDate: z.string(), endDate: z.string(),
    bullets: z.array(ResumeBulletSchema.extend({ text: z.string() })).default([]),
  })).default([]),
  education: z.array(ResumeEducationSchema.extend({ institution: z.string(), degree: z.string() })).default([]),
  skills: z.array(ResumeSkillGroupSchema.extend({ category: z.string() })).default([]),
});
```

- [ ] **4. Create transport schemas.**

```ts
// packages/core/src/jobs/draft-validation.ts
import { z } from 'zod';
import { DraftResumeSpecSchema } from './draft-content.js';
export const DraftIssueSchema = z.object({
  path: z.string(), code: z.string(), severity: z.enum(['block', 'warn']), message: z.string(),
}).strict();
export type DraftIssue = z.infer<typeof DraftIssueSchema>;
export const DraftBindingSchema = z.object({
  candidate_fingerprint: z.string().min(1), context_fingerprint: z.string().min(1),
  input_snapshot_id: z.string().uuid(), input_fingerprint: z.string().min(1),
  parent_artifact_id: z.string().uuid(), parent_artifact_fingerprint: z.string().min(1),
}).strict();
export type DraftBinding = z.infer<typeof DraftBindingSchema>;
export const CheckJobDraftRequestSchema = z.object({ candidate: DraftResumeSpecSchema }).strict();
export const JobDraftCheckSchema = z.object({
  binding: DraftBindingSchema, job_revision: z.number().int().nonnegative(),
  status: z.enum(['ready', 'blocked', 'unavailable']), issues: z.array(DraftIssueSchema),
}).strict();
export type JobDraftCheck = z.infer<typeof JobDraftCheckSchema>;
export const FinalizeJobDraftRequestSchema = z.object({
  expected_job_revision: z.number().int().nonnegative(),
  expected_draft_revision: z.number().int().nonnegative(), binding: DraftBindingSchema,
  idempotency_key: z.string().min(1),
}).strict();
export type FinalizeJobDraftRequest = z.infer<typeof FinalizeJobDraftRequestSchema>;
```

- [ ] **5. Wire schemas.** Import `DraftResumeSpecSchema` in `jobs/schemas.ts` and use `candidate: DraftResumeSpecSchema` only in `JobDraftSchema`. Export both new modules from the core index. In the draft PUT route import and use `DraftResumeSpecSchema` instead of `ResumeSpecSchema`. Keep revision CAS and `JobDraftRepository.save` intact.

```ts
export * from './jobs/draft-content.js';
export * from './jobs/draft-validation.js';
// Draft PUT body only:
const body = z.object({ expected_revision: revision, candidate: DraftResumeSpecSchema }).strict().parse(await c.req.json());
```

- [ ] **6. Run:** `npm run build:core` and `npx vitest run packages/core/tests/job-draft-content.test.ts packages/cli/tests/job-artifacts.test.ts`. Expected: PASS, including reads of old drafts and unchanged immutable artifact verification.
- [ ] **7. Commit:** stage the six named source/test files and commit `feat(jobs): separate editable draft schema from final checks`.

## Task 4: Share candidate validation without applying or rewriting proposals

**Files:** Create `packages/core/src/jobs/candidate-checks.ts`, `packages/core/tests/job-candidate-checks.test.ts`; modify `packages/core/src/jobs/proposal-review.ts` and `packages/core/src/index.ts`.

- [ ] **1. Add a test for the edited candidate, not the original proposal output.**

```ts
import { expect, it } from 'vitest';
import { checkCandidateFields, DEFAULT_STARTER_RESUME } from '../src/index.js';
it('checks edited text without mutating it or reapplying proposals', () => {
  const candidate = { ...structuredClone(DEFAULT_STARTER_RESUME), summary: '[METRIC NEEDED]', experiences: [] };
  const before = structuredClone(candidate);
  const issues = checkCandidateFields(candidate, [], {
    baseResume: candidate, analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] },
    alignment: { rows: [] }, evidence: [], skillSupport: [],
  });
  expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'summary', code: 'metric_needed', severity: 'block' })]));
  expect(candidate).toEqual(before);
});
it('locates empty fields before invoking claim validation', () => {
  const candidate = { ...structuredClone(DEFAULT_STARTER_RESUME), profile: { name: '', title: '', email: '' } };
  const issues = checkCandidateFields(candidate, [], {
    baseResume: candidate, analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] },
    alignment: { rows: [] }, evidence: [],
  });
  expect(issues.some(x => x.path === 'profile.name' && x.severity === 'block')).toBe(true);
});
```

- [ ] **2. Run:** `npx vitest run packages/core/tests/job-candidate-checks.test.ts`. Expected: missing export.
- [ ] **3. Add the field checker.** Its `proposals` argument contains only proposals actually applied to the candidate's parent. These provide summary citations and exact-match grounding lineage; the checker never applies them.

```ts
// packages/core/src/jobs/candidate-checks.ts
import { ResumeSpecSchema, type ResumeSpec } from '../schemas/resume.js';
import { ProposalSchema, type Proposal } from '../tailoring/schemas.js';
import type { ProposalValidationContext } from '../tailoring/validators.js';
import { validateCandidateProposals } from './preparation.js';
import { redactText } from '../integrity/redaction-engine.js';
import type { DraftIssue } from './draft-validation.js';
type Rules = Parameters<typeof redactText>[1];
export function checkCandidateFields(candidate: ResumeSpec, proposals: Proposal[], context: ProposalValidationContext,
  rules?: Rules, supportFor?: (proposal: Proposal) => ProposalValidationContext['skillSupport']): DraftIssue[] {
  const shape = ResumeSpecSchema.safeParse(candidate);
  if (!shape.success) return shape.error.issues.map(i => ({ path: i.path.join('.'), code: 'required_field', severity: 'block', message: i.message }));
  const issues: DraftIssue[] = [];
  const fields = [
    { path: 'summary', text: candidate.summary ?? '', citations: proposals.filter(p => p.type === 'summary.rewrite').flatMap(p => p.citations), ei: -1, bi: -1 },
    ...candidate.experiences.flatMap((e, ei) => e.bullets.map((b, bi) => ({ path: `experiences.${ei}.bullets.${bi}.text`, text: b.text, citations: b.citations ?? [], ei, bi }))),
  ];
  for (const f of fields) {
    if (!f.text && f.path === 'summary') continue;
    const origin = proposals.find(p => (p.edited_after ?? p.after) === f.text && JSON.stringify(p.citations) === JSON.stringify(f.citations));
    const probe = ProposalSchema.parse({ id: f.path, type: f.path === 'summary' ? 'summary.rewrite' : 'bullet.rewrite',
      target: { experience_index: f.ei, bullet_index: f.bi }, before: f.text, after: f.text, citations: f.citations });
    const checked = validateCandidateProposals([probe], { ...context, baseResume: candidate,
      skillSupport: origin && supportFor ? supportFor(origin) : context.skillSupport })[0];
    for (const i of checked.checks.filter(i => ['unsupported_experience', 'unsupported_citation', 'metric_unverified', 'metric_needed'].includes(i.kind))) {
      issues.push({ path: f.path, code: i.kind, severity: i.severity, message: i.message });
    }
  }
  const scan = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (/\[METRIC NEEDED\]/i.test(value) && !issues.some(i => i.path === path && i.code === 'metric_needed'))
        issues.push({ path, code: 'metric_needed', severity: 'block', message: 'Resolve the metric placeholder.' });
      if (rules) {
        const r = redactText(value, rules);
        if (!r.isClean || r.redactedText !== value) issues.push({ path, code: 'privacy', severity: 'block', message: r.violations.join('; ') || 'Remove private wording.' });
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}.${i}`));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => scan(v, path ? `${path}.${k}` : k));
  };
  scan(candidate, '');
  return issues;
}
```

This imports the existing redaction implementation; do not add another redactor.

- [ ] **4. Replace the candidate field/privacy loops inside `validateProposalReview` with this call.** Preserve proposal checks, `detectProposalConflicts`, and the return shape. Export the checker from the core index.

```ts
const candidateIssues = checkCandidateFields(result.candidate,
  result.proposals.filter(p => result.appliedProposalIds.includes(p.id)),
  { ...context, baseResume: result.candidate }, rules, supportFor);
for (const i of candidateIssues) items.push({ subject: { kind: 'candidate', path: i.path },
  issues: [{ kind: i.code, severity: i.severity, message: i.message }] });
```

- [ ] **5. Verify parity.** `npx vitest run packages/core/tests/job-candidate-checks.test.ts packages/core/tests/job-proposal-review.test.ts packages/core/tests/job-preparation.test.ts`. Expected: PASS; retain the existing claim/source-bound grounding assertions without weakening them.
- [ ] **6. Commit:** stage the four named files and commit `refactor(jobs): share candidate checks across review and editing`.

## Task 5: Share freshness checks and verified rendering

**Files:** Create `packages/cli/src/jobs/resume-context.ts`, `packages/cli/src/jobs/checked-render.ts`; modify `packages/cli/src/jobs/exports.ts`, `packages/cli/src/jobs/preparation.ts`; add tests to `packages/cli/tests/job-exports.test.ts` and create `packages/cli/tests/job-checked-render.test.ts`.

- [ ] **1. Add rendering tests.**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_STARTER_RESUME } from '@featherduster/core';
import { checkedRender } from '../src/jobs/checked-render.js';
it('does not accept a renderer pass with an incorrect page budget', async () => {
  const renderPdf = async () => ({ status: 'passed' as const, source: 'tex', pdf: Buffer.from('pdf'),
    previews: [{ page: 1, mimeType: 'image/png' as const, bytes: Buffer.from('png') }], diagnostics: [],
    report: { passed: true, pageCount: 2, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] } });
  const result = await checkedRender({ renderPdf }, { templateId: 'default', spec: DEFAULT_STARTER_RESUME }, 1);
  expect(result.status).toBe('blocked');
});
it('reports tool failure separately from invalid content', async () => {
  const result = await checkedRender({ renderPdf: async () => { throw Error('Compiler unavailable'); } },
    { templateId: 'default', spec: DEFAULT_STARTER_RESUME }, 1);
  expect(result).toMatchObject({ status: 'unavailable', issues: [expect.objectContaining({ code: 'renderer_unavailable' })] });
});
```

- [ ] **2. Run:** `npx vitest run packages/cli/tests/job-checked-render.test.ts`. Expected: missing module.
- [ ] **3. Create the shared renderer adapter.**

```ts
// packages/cli/src/jobs/checked-render.ts
import type { DraftIssue } from '@featherduster/core';
import type { LatexRenderer } from '../render/latex-renderer.js';
export interface CheckedPdf {
  source: string; pdf: string; previews: string[];
  report: { passed: true; pageCount: number; pageBudget: number; coverage: number;
    missingFragments: string[]; diagnostics: { code: string; message: string }[] };
}
export async function checkedRender(renderer: Pick<LatexRenderer, 'renderPdf'>,
  request: Parameters<LatexRenderer['renderPdf']>[0], budget: number): Promise<{
    status: 'ready' | 'blocked' | 'unavailable'; issues: DraftIssue[]; output?: CheckedPdf;
  }> {
  try {
    const r = await renderer.renderPdf(request);
    if (request.signal?.aborted) throw request.signal.reason;
    const report = r.report;
    if (r.status === 'passed' && report?.passed && report.pageCount <= budget && report.pageBudget === budget
      && r.source && r.pdf?.length && r.previews.length && r.previews.every(p => p.bytes.length)) {
      return { status: 'ready', issues: [], output: { source: r.source, pdf: r.pdf.toString('base64'),
        previews: r.previews.map(p => p.bytes.toString('base64')), report: { ...report, passed: true } } };
    }
    const status: 'blocked' | 'unavailable' = report ? 'blocked' : 'unavailable';
    const diagnostics = r.diagnostics.length ? r.diagnostics : [{ code: 'pdf_layout', message: 'The PDF did not pass its required layout checks.' }];
    return { status, issues: diagnostics.map(d => ({ path: '', severity: 'block', ...d })) };
  } catch (error) {
    return { status: 'unavailable', issues: [{ path: '', code: 'renderer_unavailable', severity: 'block', message: error instanceof Error ? error.message : 'PDF checks unavailable.' }] };
  }
}
```

- [ ] **4. Create `resume-context.ts` by moving the shared freshness logic out of export resolution.** The exact implementation follows. Preserve the stricter export-specific gates after this function returns.

```ts
import * as C from '@featherduster/core';
import { sourceFingerprint } from '../corpus/load.js';
import { JobArtifactsService } from './artifacts.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { getLatexTemplate } from './templates.js';
import type { selectJobSkillset } from './skillset.js';
export const canonicalResumeValue = (value: unknown): string => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export type SelectResumeEvidence = (id: string, ids: string[]) => ReturnType<typeof selectJobSkillset>;
export function currentResumeContext(r: JobsRepository, artifacts: JobArtifactsService, jobId: string, artifactId: string,
  select: SelectResumeEvidence, currentRules: () => C.PrivacyRulesConfig) {
  const fail = (message: string): never => { throw new RepositoryError('ineligible', message); };
  const job = r.getJob(jobId), artifact = artifacts.getArtifact(artifactId);
  if (artifact.job_id !== jobId) throw new RepositoryError('invalid_relationship', 'Artifact belongs to another job');
  if (job.artifact_version_ids.at(-1) !== artifact.id) fail('This is historical. Return to the current resume.');
  if (r.active().some(a => a.job_id === jobId)) fail('Stop or finish preparation before finalizing current files.');
  const context = artifacts.capturedContext(artifact.input_snapshot_id), input = context.input;
  const canonical = canonicalResumeValue;
  if (!context.job_scope || canonical(context.job_scope) !== canonical({ company: job.company, role: job.role, employer_id: job.employer_id })) fail('Job scope changed. Review current inputs first.');
  const latest = r.database.db.prepare("SELECT id FROM input_snapshots WHERE job_id=? AND json_extract(payload, '$.schema_version')=1 ORDER BY rowid DESC LIMIT 1").get(jobId) as { id: string } | undefined;
  if (latest?.id !== input.id || job.posting_snapshot_id !== input.posting.id || job.recovery?.kind === 'stale_inputs') fail('Posting or starting inputs changed. Review current inputs first.');
  const read = (ref: C.ImmutableReference) => r.database.files.readSnapshot(ref, jobId, input.id).toString();
  const rules = C.PrivacyRulesConfigSchema.parse(JSON.parse(read(input.privacy_rules)));
  if (canonical(rules) !== canonical(C.PrivacyRulesConfigSchema.parse(currentRules()))) fail('Privacy rules changed. Review current inputs first.');
  const evidence = context.evidence.getAll();
  let live: ReturnType<SelectResumeEvidence>;
  try { live = select(jobId, evidence.map(e => e.id)); }
  catch { return fail('Selected evidence is unavailable. Inspect sources and prepare again.'); }
  if (canonical(evidence.map(sourceFingerprint)) !== canonical(live.evidence.map(sourceFingerprint)) || canonical(context.knowledge.materialized ?? { support: [], sources: [] }) !== canonical(live.knowledge.materialized ?? { support: [], sources: [] })) fail('Evidence or scoped support changed. Inspect sources and prepare again.');
  const template = C.LatexTemplateProfileSchema.parse(JSON.parse(read(input.template)));
  if (canonical(template) !== canonical(getLatexTemplate(template.id)) || template.page_budget !== input.policy.page_budget) fail('Template changed. Review current inputs first.');
  const contextFingerprint = fingerprint(canonical({ input: input.fingerprint, scope: context.job_scope, rules, template,
    evidence: evidence.map(sourceFingerprint), knowledge: context.knowledge.materialized, parent: artifact.version_fingerprint }));
  return { job, artifact, context, rules, template, contextFingerprint };
}
```

- [ ] **5. Replace only the shared block in `JobExports.resolve`.** Import `currentResumeContext`; retain artifact fingerprint/latest checks, pending-draft block, verified report gate, privacy scan, returned export binding, and all saved-release behavior. Replace the block from `const context = this.artifacts.capturedContext` through the evidence/support comparison with:

```ts
const { context, rules } = currentResumeContext(this.r, this.artifacts, jobId, artifact.id, this.select, this.rules);
const input = context.input;
```

- [ ] **6. Use `checkedRender` in automatic preparation's compile stage.** Keep the existing `retainFailure` helper and stage envelope. Replace the renderer invocation/result parsing part of that callback with:

```ts
const checked = await abortable(checkedRender(renderer, { templateId: template.id, spec: cleaned.candidate, rules, signal }, input.policy.page_budget), signal);
guard();
if (checked.status !== 'ready' || !checked.output) return retainFailure(checked, checked.issues.map(i => i.message).join('; '));
return renderedSchema.parse(checked.output);
```

- [ ] **7. Run:** `npx vitest run packages/cli/tests/job-checked-render.test.ts packages/cli/tests/job-exports.test.ts packages/cli/tests/job-proposal-service.test.ts packages/cli/tests/jobs-worker.test.ts`. Expected: PASS. Preserve export tests that reject stale privacy, evidence, inputs, or active processing; only update changed explanatory text where it remains equally actionable.
- [ ] **8. Commit:** stage the six named files and commit `refactor(jobs): share resume freshness and PDF verification`.

## Task 6: Publish a manually finalized artifact with atomic revision guards

**Files:** Modify `packages/core/src/jobs/schemas.ts`, `packages/cli/src/jobs/repository.ts`, `packages/cli/src/jobs/artifacts.ts`, `packages/ui/src/views/jobs/job-utils.ts`; add tests to `packages/cli/tests/job-artifacts.test.ts`.

- [ ] **1. Add a repository/service test using that file's existing `fixture`.**

```ts
it('publishes manual edits once without claiming another preparation attempt', () => {
  const f = fixture(), parent = f.service.publishCandidate(f.publish);
  f.repo.transitionPreparation(f.job.id, 'complete', f.repo.getJob(f.job.id).revision, 'complete-parent', f.publish.fence);
  const draft = f.service.continueEditing({ job_id: f.job.id, artifact_version_id: parent.id,
    artifact_fingerprint: parent.version_fingerprint, expected_job_revision: f.repo.getJob(f.job.id).revision, idempotency_key: 'edit' });
  const request = { draft_id: draft.id, expected_draft_revision: draft.revision,
    expected_job_revision: f.repo.getJob(f.job.id).revision, parent_artifact_id: parent.id,
    parent_artifact_fingerprint: parent.version_fingerprint, source: 'edited tex', pdf: 'edited pdf',
    previews: ['edited preview'], validation_report: '{"passed":true}', idempotency_key: 'finalize' };
  const first = f.repo.withReceipt('finalize_job_draft', 'finalize', request, () => f.service.publishManualCandidate(request)).result;
  const replay = f.repo.withReceipt('finalize_job_draft', 'finalize', request, () => { throw Error('must not publish twice'); }).result;
  expect(replay).toEqual(first);
  expect(first).toMatchObject({ origin: 'manual', parent_version_id: parent.id, attempt_id: parent.attempt_id });
  expect(f.repo.getJob(f.job.id).artifact_version_ids).toEqual([parent.id, first.id]);
  expect(f.repo.active()).toEqual([]);
  expect(f.repo.listEvents(f.job.id).filter(e => e.payload.kind === 'resume_review')).toHaveLength(0);
  expect(() => f.service.publishManualCandidate({ ...request, idempotency_key: 'stale' })).toThrow();
});
```

- [ ] **2. Run:** `npx vitest run packages/cli/tests/job-artifacts.test.ts`. Expected: missing publication method.
- [ ] **3. Add optional artifact provenance and a separate event.** In `ArtifactVersionSchema` add `origin: z.enum(['automatic', 'manual']).optional(),` without a default. Add this member to the `JobEventSchema.payload` discriminated union:

```ts
z.object({ kind: z.literal('resume_finalized'), artifact_version_id: uuid,
  parent_artifact_version_id: uuid, draft_id: uuid, draft_revision: count }).strict(),
```

In `describeJobEvent`, add `case 'resume_finalized': return 'Edited resume finalized';`.

- [ ] **4. Add two methods to `JobsRepository`.** The guard is synchronous and is re-run inside the same transaction as the publish. No renderer promise runs under a SQLite write transaction.

```ts
assertManualPublication(request: { draft_id: string; expected_draft_revision: number;
  expected_job_revision: number; parent_artifact_id: string; parent_artifact_fingerprint: string }) {
  const draft = this.getLatestDraft(request.draft_id), job = this.getJob(draft.job_id);
  this.revision(draft.revision, request.expected_draft_revision);
  this.revision(job.revision, request.expected_job_revision);
  const parent = this.getArtifact(request.parent_artifact_id);
  this.sameJob(parent, job.id);
  if (parent.version_fingerprint !== request.parent_artifact_fingerprint || draft.parent_artifact_version_id !== parent.id
    || job.artifact_version_ids.at(-1) !== parent.id || draft.input_snapshot_id !== parent.input_snapshot_id)
    this.error('invalid_relationship', 'The draft or current resume changed. Reload before finalizing.');
  if (this.active().some(a => a.job_id === job.id) || job.recovery?.kind === 'stale_inputs')
    this.error('ineligible', 'Job preparation or changed inputs must be resolved first.');
  return { draft, job, parent };
}
publishManualArtifact(value: C.ArtifactVersion, request: Parameters<JobsRepository['assertManualPublication']>[0], idempotencyKey: string) {
  return this.tx(() => {
    const { draft, job, parent } = this.assertManualPublication(request);
    const artifact = C.ArtifactVersionSchema.parse(value);
    this.sameJob(artifact, job.id);
    if (artifact.origin !== 'manual' || artifact.attempt_id !== parent.attempt_id
      || artifact.parent_version_id !== parent.id || artifact.input_snapshot_id !== parent.input_snapshot_id
      || artifact.input_fingerprint !== parent.input_fingerprint || artifact.validation_result !== 'passed')
      this.error('invalid_relationship', 'Manual artifact binding mismatch');
    this.verifyArtifact(artifact);
    this.immutable('artifacts', artifact, C.ArtifactVersionSchema, { attempt_id: artifact.attempt_id,
      input_snapshot_id: artifact.input_snapshot_id, parent_version_id: artifact.parent_version_id });
    this.putJob({ ...job, artifact_version_ids: [...job.artifact_version_ids, artifact.id],
      preparation_state: 'resume_ready', state_reason: null, recovery: undefined });
    this.appendEvent({ schema_version: 1, id: this.uuid(), workspace_id: job.workspace_id, job_id: job.id,
      created_at: this.now(), actor: { kind: 'user', id: 'local-human' }, attempt_id: null,
      idempotency_key: `finalize:${idempotencyKey}`, payload: { kind: 'resume_finalized', artifact_version_id: artifact.id,
        parent_artifact_version_id: parent.id, draft_id: draft.id, draft_revision: draft.revision } });
    return artifact;
  });
}
```

- [ ] **5. Add `publishManualCandidate` to `JobArtifactsService`.** It creates the same manifest/bundle format as automatic publication. Retain the consumed draft's immutable parent linkage; the new artifact's `parent_version_id` matches it. The review lookup for the new artifact naturally finds no pending working draft until Continue editing forks a new one.

```ts
publishManualCandidate(request: Parameters<JobsRepository['assertManualPublication']>[0] & {
  source: Bytes; pdf: Bytes; previews: Bytes[]; validation_report: Bytes; idempotency_key: string;
}): C.ArtifactVersion {
  return this.tx(() => {
    const r = this.repository, { draft, parent } = r.assertManualPublication(request);
    const input = this.getInputSnapshot(draft.input_snapshot_id);
    const id = this.uuid(), files = r.database.files, root = files.bundlePath('artifacts', draft.job_id, id);
    const bundle: Record<string, Bytes> = {};
    const add = (name: string, bytes: Bytes): C.ImmutableReference => {
      bundle[name] = bytes; return { id: `${root}/${name}`, fingerprint: fingerprint(bytes) };
    };
    const previews = request.previews.map((p, i) => add(`preview-${i}.png`, p));
    const artifact = { schema_version: 1 as const, id, workspace_id: draft.workspace_id, job_id: draft.job_id,
      origin: 'manual' as const, attempt_id: parent.attempt_id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint,
      parent_version_id: parent.id, created_at: this.now(), source: add('source.tex', request.source),
      pdf: add('resume.pdf', request.pdf), preview: previews[0] ?? null,
      validation_report: add('validation.json', request.validation_report), validation_result: 'passed' as const };
    const bytes = canonical(artifactManifest.parse({ schema_version: 1, artifact, draft_id: draft.id, draft_revision: draft.revision, previews }));
    bundle['manifest.json'] = bytes;
    const result = C.ArtifactVersionSchema.parse({ ...artifact, version_fingerprint: fingerprint(bytes) });
    files.writeBundle('artifacts', draft.job_id, id, bundle);
    return r.publishManualArtifact(result, request, request.idempotency_key);
  });
}
```

Also expose the existing read-only `attemptReview` method by removing its `private` modifier. Its purpose is to retrieve the exact review that supplied an artifact's preparation lineage, not the mutable latest review.

- [ ] **6. Preserve validation on new event references.** In `appendEvent`, before its existing `channel_action` branch, add:

```ts
else if (event.payload.kind === 'resume_finalized') {
  const a = this.getArtifact(event.payload.artifact_version_id);
  const d = this.getDraftRevision(event.payload.draft_id, event.payload.draft_revision);
  this.sameJob(a, event.job_id); this.sameJob(d, event.job_id);
  if (a.origin !== 'manual' || a.parent_version_id !== event.payload.parent_artifact_version_id
    || d.parent_artifact_version_id !== a.parent_version_id || d.input_snapshot_id !== a.input_snapshot_id)
    this.error('invalid_relationship', 'Finalization event binding mismatch');
}
```

- [ ] **7. Run:** `npm run build:core` then `npx vitest run packages/cli/tests/job-artifacts.test.ts packages/cli/tests/jobs-repository.test.ts packages/ui/tests/jobs-polish.test.tsx`. Expected: PASS. Confirm old artifact manifest fingerprints still verify with `origin` absent.
- [ ] **8. Commit:** stage the five named files and commit `feat(jobs): add atomic manual resume publication`.

## Task 7: Check and finalize the exact job draft

**Files:** Create `packages/cli/src/jobs/draft-finalization.ts`; modify runtime, routes, UI API client; add end-to-end service tests to `packages/cli/tests/job-exports.test.ts` (reuse its real runtime fixture).

- [ ] **1. Add the success/invalid-save regression tests before implementing the service.** These use the existing `fixture()` defined in `job-exports.test.ts`.

```ts
async function editFixture() {
  const f = await fixture();
  const draft = f.runtime.artifacts.continueEditing({ job_id: f.job.id,
    expected_job_revision: f.runtime.repository.getJob(f.job.id).revision,
    artifact_version_id: f.artifact.id, artifact_fingerprint: f.artifact.version_fingerprint, idempotency_key: 'edit-job' });
  f.run.mockClear(); f.deps.renderer.renderPdf.mockClear();
  return { ...f, draft };
}
it('saves empty required text, checks reactively, then finalizes only the corrected version', async () => {
  const f = await editFixture();
  const candidate = structuredClone(f.draft.candidate); candidate.profile.name = '';
  const saved = await f.app.request(`/api/jobs/${f.job.id}/drafts/${f.draft.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: f.draft.revision, candidate }),
  });
  expect(saved.status).toBe(200);
  expect(f.deps.renderer.renderPdf).not.toHaveBeenCalled();
  const blocked = await f.runtime.drafts.check(f.job.id, f.draft.id, candidate);
  expect(blocked.status).toBe('blocked');
  candidate.profile.name = 'Edited Name';
  const checked = await f.runtime.drafts.check(f.job.id, f.draft.id, candidate);
  expect(checked.status).toBe('ready');
  const latest = f.runtime.repository.getLatestDraft(f.draft.id);
  const next = f.runtime.repository.saveDraft({ ...latest, candidate }, latest.revision);
  const request = { expected_job_revision: checked.job_revision, expected_draft_revision: next.revision,
    binding: checked.binding, idempotency_key: 'finish-edits' };
  const first = await f.runtime.drafts.finalize(f.job.id, next.id, request);
  const replay = await f.runtime.drafts.finalize(f.job.id, next.id, request);
  expect(first.artifact.id).toBe(replay.artifact.id);
  const review = f.runtime.artifacts.review(f.job.id, first.artifact.id);
  expect(review.draft.candidate.profile.name).toBe('Edited Name');
  expect(review.working_draft).toBeNull();
  expect(f.runtime.exports.files(f.job.id, { artifact_id: first.artifact.id,
    artifact_fingerprint: first.artifact.version_fingerprint, dossier: false }).files[0].name).toBe('resume.pdf');
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime.repository.listEvents(f.job.id).some(e => e.payload.kind === 'resume_review')).toBe(false);
});
it('invalidates a passing check when privacy changes and retains the prior PDF', async () => {
  const f = await editFixture(), checked = await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  f.privacy({ banned_keywords: ['Synthetic'], strip_patterns: [], replacements: [] });
  await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, {
    expected_job_revision: checked.job_revision, expected_draft_revision: f.draft.revision,
    binding: checked.binding, idempotency_key: 'changed-privacy',
  })).rejects.toThrow();
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
});
```

- [ ] **2. Run:** `npx vitest run packages/cli/tests/job-exports.test.ts`. Expected: missing `runtime.drafts`.
- [ ] **3. Create the service below.** Cache only trusted results, never a client-supplied success flag. Bound the cache to 8 entries / 32 MiB / five minutes. One in-flight request per draft prevents concurrent render storms from duplicate clients; a competing request returns an actionable busy error and the UI retries. Candidate debouncing/coalescing is implemented in Task 8.

```ts
import * as C from '@featherduster/core';
import { JobArtifactsService } from './artifacts.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { sourceFingerprint } from '../corpus/load.js';
import { claimFingerprint } from './proposal-service.js';
import { currentResumeContext, canonicalResumeValue as canonical, type SelectResumeEvidence } from './resume-context.js';
import { checkedRender, type CheckedPdf } from './checked-render.js';
import type { LatexRenderer } from '../render/latex-renderer.js';
type Cached = { result: C.JobDraftCheck; output?: CheckedPdf; expires: number; bytes: number };
export class JobDraftFinalization {
  private cache = new Map<string, Cached>();
  private running = new Map<string, AbortController>();
  private operations = new Set<Promise<unknown>>();
  private renderControllers = new Set<AbortController>();
  private closed = false;
  constructor(private r: JobsRepository, private artifacts: JobArtifactsService,
    private select: SelectResumeEvidence, private rules: () => C.PrivacyRulesConfig,
    private renderer: Pick<LatexRenderer, 'renderPdf'>) {}
  private context(jobId: string, draftId: string, candidate: C.ResumeSpec) {
    const draft = this.r.getLatestDraft(draftId);
    if (draft.job_id !== jobId || !draft.parent_artifact_version_id) throw new RepositoryError('invalid_relationship', 'Select a job-linked draft.');
    const ctx = currentResumeContext(this.r, this.artifacts, jobId, draft.parent_artifact_version_id, this.select, this.rules);
    if (draft.input_snapshot_id !== ctx.context.input.id) throw new RepositoryError('invalid_relationship', 'Draft inputs changed.');
    const binding: C.DraftBinding = { candidate_fingerprint: fingerprint(canonical(candidate)),
      context_fingerprint: ctx.contextFingerprint, input_snapshot_id: ctx.context.input.id,
      input_fingerprint: ctx.context.input.fingerprint, parent_artifact_id: ctx.artifact.id,
      parent_artifact_fingerprint: ctx.artifact.version_fingerprint };
    return { ...ctx, draft, binding };
  }
  private key(jobId: string, draftId: string, binding: C.DraftBinding) { return canonical({ jobId, draftId, binding }); }
  private prune() {
    for (const [key, v] of this.cache) if (v.expires <= Date.now()) this.cache.delete(key);
    while (this.cache.size > 8 || [...this.cache.values()].reduce((n, v) => n + v.bytes, 0) > 32 * 1024 * 1024) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
  private supports(ctx: ReturnType<JobDraftFinalization['context']>) {
    const review = this.artifacts.attemptReview(ctx.artifact.attempt_id);
    const proposals = ctx.draft.proposals.proposals.filter(p => p.decision !== 'rejected');
    const supportFor = (p: C.Proposal): C.SkillSupport[] => {
      const groundings = (review?.groundings ?? []).filter(g => g.proposal_id === p.id && g.claim_fingerprint === claimFingerprint(p)
        && C.containsTerm(p.edited_after ?? p.after, g.term) && g.sources.every(s => {
          const record = ctx.context.evidence.get(s.evidence_id);
          return p.citations.includes(s.evidence_id) && !!record && record.confidence !== 'retracted'
            && sourceFingerprint(record) === s.evidence_fingerprint
            && [record.title, record.summary, record.impact, record.narrative].some(t => t.includes(s.quote));
        }));
      return [...ctx.context.skillSupport, ...groundings.map(g => ({ skill: g.term, facet: g.term, permitted_terms: [g.term],
        support: 'direct' as const, scope: { kind: 'job' as const, key: ctx.job.id }, sources: g.sources, explanation: g.explanation }))];
    };
    return { proposals, supportFor };
  }
  private track<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new RepositoryError('ineligible', 'Resume checker is shutting down.'));
    const promise = Promise.resolve().then(work);
    this.operations.add(promise);
    void promise.then(() => this.operations.delete(promise), () => this.operations.delete(promise));
    return promise;
  }
  check(jobId: string, draftId: string, raw: C.ResumeSpec): Promise<C.JobDraftCheck> {
    return this.track(() => this.checkNow(jobId, draftId, raw));
  }
  private async render(request: Parameters<LatexRenderer['renderPdf']>[0], budget: number) {
    const controller = new AbortController(); this.renderControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(Error('PDF check timed out. Retry.')), 60000);
    try { return await checkedRender(this.renderer, { ...request, signal: controller.signal }, budget); }
    finally { clearTimeout(timeout); this.renderControllers.delete(controller); }
  }
  private async checkNow(jobId: string, draftId: string, raw: C.ResumeSpec): Promise<C.JobDraftCheck> {
    if (this.closed) throw new RepositoryError('ineligible', 'Resume checker is shutting down. Retry after reconnecting.');
    const candidate = C.DraftResumeSpecSchema.parse(raw), ctx = this.context(jobId, draftId, candidate);
    const key = this.key(jobId, draftId, ctx.binding); this.prune();
    const hit = this.cache.get(key);
    if (hit) return { ...hit.result, job_revision: ctx.job.revision };
    if (this.running.has(draftId)) throw new RepositoryError('ineligible', 'A resume check is still running. Retry when it finishes.');
    const controller = new AbortController(); this.running.set(draftId, controller);
    const timeout = setTimeout(() => controller.abort(Error('PDF check timed out. Retry.')), 60000);
    try {
      const parent = this.artifacts.review(jobId, ctx.artifact.id), { proposals, supportFor } = this.supports(ctx);
      if (!parent.analysis || !parent.alignment) throw new RepositoryError('ineligible', 'The preparation context is unavailable. Review job inputs.');
      const issues = C.checkCandidateFields(candidate, proposals, { baseResume: parent.base_resume,
        analysis: parent.analysis, alignment: parent.alignment, evidence: ctx.context.evidence.getAll(), skillSupport: ctx.context.skillSupport }, ctx.rules, supportFor);
      let output: CheckedPdf | undefined;
      let status: C.JobDraftCheck['status'] = issues.some(i => i.severity === 'block') ? 'blocked' : 'ready';
      if (status === 'ready') {
        const rendered = await this.render({ templateId: ctx.template.id, spec: candidate, rules: ctx.rules }, ctx.context.input.policy.page_budget);
        issues.push(...rendered.issues); status = rendered.status; output = rendered.output;
      }
      if (this.closed) throw new RepositoryError('ineligible', 'Resume checker is shutting down.');
      const fresh = this.context(jobId, draftId, candidate);
      if (canonical(fresh.binding) !== canonical(ctx.binding)) throw new RepositoryError('revision_conflict', 'Inputs changed during checking. Check again.');
      const result: C.JobDraftCheck = { binding: ctx.binding, job_revision: fresh.job.revision, status, issues };
      if (status !== 'unavailable' && !controller.signal.aborted && !this.closed) {
        this.cache.set(key, { result, output, expires: Date.now() + 300000, bytes: Buffer.byteLength(JSON.stringify({ result, output })) });
        this.prune();
      }
      return result;
    } finally { clearTimeout(timeout); this.running.delete(draftId); }
  }
  finalize(jobId: string, draftId: string, raw: C.FinalizeJobDraftRequest): Promise<{ artifact: C.ArtifactVersion }> {
    return this.track(() => this.finalizeNow(jobId, draftId, raw));
  }
  private async finalizeNow(jobId: string, draftId: string, raw: C.FinalizeJobDraftRequest): Promise<{ artifact: C.ArtifactVersion }> {
    const request = C.FinalizeJobDraftRequestSchema.parse(raw);
    const { idempotency_key, ...body } = request, receiptInput = { jobId, draftId, ...body };
    // Probe the durable receipt before requiring a still-current parent. A replay is allowed after publication.
    const absent = Symbol('absent');
    try { return this.r.withReceipt('finalize_job_draft', idempotency_key, receiptInput, () => { throw absent; }).result as { artifact: C.ArtifactVersion }; }
    catch (e) { if (e !== absent) throw e; }
    const saved = this.r.getLatestDraft(draftId), ctx = this.context(jobId, draftId, saved.candidate);
    if (ctx.job.revision !== request.expected_job_revision || saved.revision !== request.expected_draft_revision
      || canonical(ctx.binding) !== canonical(request.binding)) throw new RepositoryError('revision_conflict', 'The saved draft or its inputs changed. Check again.');
    const checked = await this.checkNow(jobId, draftId, saved.candidate);
    if (checked.status !== 'ready') throw new RepositoryError('ineligible', 'Resolve the current resume checks before finalizing.');
    let output = this.cache.get(this.key(jobId, draftId, checked.binding))?.output;
    // Large PDFs may intentionally exceed the cache budget. Re-render without requiring an unbounded cache.
    if (!output) {
      const rendered = await this.render({ templateId: ctx.template.id, spec: saved.candidate, rules: ctx.rules }, ctx.context.input.policy.page_budget);
      if (rendered.status !== 'ready' || !rendered.output) throw new RepositoryError('ineligible', rendered.issues.map(i => i.message).join('; '));
      output = rendered.output;
    }
    if (this.closed) throw new RepositoryError('ineligible', 'Resume checker is shutting down.');
    const verified = output;
    return this.r.withReceipt('finalize_job_draft', idempotency_key, receiptInput, () => {
      const fresh = this.context(jobId, draftId, this.r.getLatestDraft(draftId).candidate);
      if (canonical(fresh.binding) !== canonical(request.binding)) throw new RepositoryError('revision_conflict', 'The checked content changed. Check again.');
      const artifact = this.artifacts.publishManualCandidate({ draft_id: draftId,
        expected_draft_revision: request.expected_draft_revision, expected_job_revision: request.expected_job_revision,
        parent_artifact_id: request.binding.parent_artifact_id, parent_artifact_fingerprint: request.binding.parent_artifact_fingerprint,
        source: verified.source, pdf: Buffer.from(verified.pdf, 'base64'), previews: verified.previews.map(p => Buffer.from(p, 'base64')),
        validation_report: JSON.stringify(verified.report), idempotency_key });
      return { artifact };
    }).result;
  }
  async dispose() {
    this.closed = true;
    for (const c of this.running.values()) c.abort(Error('Shutdown'));
    for (const c of this.renderControllers) c.abort(Error('Shutdown'));
    await Promise.allSettled([...this.operations]); this.cache.clear();
  }
}
```

Both reactive checking and cache-miss finalization use the bounded `render` method. Keep renderer tool-level limits enabled as well.

- [ ] **4. Wire runtime and routes.** In runtime import `JobDraftFinalization`, initialize `const renderer = deps.renderer ?? new LatexRenderer();`, pass that renderer to automatic preparation, and after `selectFit` is defined add:

```ts
const drafts = new JobDraftFinalization(repository, artifacts, selectFit, deps.loadPrivacyRules, renderer);
```

Include `drafts` in the returned runtime. Replace its `dispose` method with the following so active checks settle before database closure:

```ts
dispose(): Promise<void> {
  if (!disposed) {
    clearInterval(timer); listeners.clear(); corpusListeners.clear();
    disposed = Promise.allSettled([drafts.dispose(), service.dispose()]).then(results => {
      database.close();
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    });
  }
  return disposed;
},
```

Add core schema imports to routes and these handlers after draft PUT:

```ts
app.post('/api/jobs/:id/drafts/:draftId/check', handle(async (c, r) => {
  const draft = getDraft(c, r), body = CheckJobDraftRequestSchema.parse(await c.req.json());
  return r.drafts.check(draft.job_id, draft.id, body.candidate);
}));
app.post('/api/jobs/:id/drafts/:draftId/finalize', handle(async (c, r) => {
  const jobId = uuid.parse(c.req.param('id')), draftId = uuid.parse(c.req.param('draftId'));
  const result = await r.drafts.finalize(jobId, draftId, FinalizeJobDraftRequestSchema.parse(await c.req.json()));
  r.flushEvents(); return result;
}, 201));
```

Add API-client imports for `JobDraftCheck` and `FinalizeJobDraftRequest`, then:

```ts
checkJobDraft(id: string, draft: string, candidate: ResumeSpec) {
  return this.fetchJson<JobDraftCheck>(`/api/jobs/${id}/drafts/${draft}/check`, this.jsonRequest('POST', { candidate }), 75000);
}
finalizeJobDraft(id: string, draft: string, body: FinalizeJobDraftRequest) {
  return this.fetchJson<{ artifact: ArtifactVersion }>(`/api/jobs/${id}/drafts/${draft}/finalize`, this.jsonRequest('POST', body), 135000);
}
```

The existing client hard-codes a 15-second timeout. Change only its private signature to `private async fetchJson<T>(endpoint: string, init?: RequestInit, timeoutMs = 15000): Promise<T>` and replace the timeout's `15000` with `timeoutMs`. Other callers keep the existing default. Check/finalize callers allow bounded PDF rendering to finish; lost responses still recover through receipts.

- [ ] **5. Extend the fixture tests for concurrency and failure.** Add imports for `openJobsDatabase` from `../src/jobs/database.js` and `JobsRepository` from `../src/jobs/repository.js`, then add:

```ts
async function checkedFixture() {
  const f = await editFixture();
  const checked = await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  const request = { expected_job_revision: checked.job_revision, expected_draft_revision: f.draft.revision,
    binding: checked.binding, idempotency_key: 'finalize-once' };
  return { ...f, checked, request };
}
it('concurrent identical finalizations publish once and changed intent is rejected', async () => {
  const f = await checkedFixture();
  const [a, b] = await Promise.all([
    f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request),
    f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request),
  ]);
  expect(a.artifact.id).toBe(b.artifact.id);
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toHaveLength(2);
  await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, { ...f.request,
    binding: { ...f.request.binding, candidate_fingerprint: 'different' },
  })).rejects.toMatchObject({ code: 'idempotency_conflict' });
});
it('a save from another database connection fences the checked revision', async () => {
  const f = await checkedFixture(), db = openJobsDatabase(f.root);
  try {
    const other = new JobsRepository(db);
    other.saveDraft({ ...f.draft, candidate: { ...f.draft.candidate, summary: 'New draft' } }, f.draft.revision);
    await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
  } finally { db.close(); }
});
it('render outages preserve drafts and are retryable', async () => {
  const f = await editFixture();
  f.deps.renderer.renderPdf.mockRejectedValueOnce(Error('compiler failed'));
  const result = await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  expect(result.status).toBe('unavailable');
  expect(f.runtime.repository.getLatestDraft(f.draft.id)).toEqual(f.draft);
  expect((await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate)).status).toBe('ready');
});
it('a failed publication preserves the prior artifact and a retry can complete', async () => {
  const f = await checkedFixture();
  const write = vi.spyOn(f.runtime.repository.database.files, 'writeBundle').mockImplementationOnce(() => { throw Error('disk full'); });
  await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request)).rejects.toThrow('disk full');
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
  expect(f.runtime.repository.getLatestDraft(f.draft.id)).toEqual(f.draft);
  write.mockRestore();
  const result = await f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request);
  expect(result.artifact.parent_version_id).toBe(f.artifact.id);
});
```

The wrong-page-budget/blocked-render case is tested independently in Task 5. Also add the historical HTTP test below before changing the route:

```ts
it('downloads the previous PDF despite pending edits without creating a release', async () => {
  const f = await editFixture();
  f.runtime.repository.saveDraft({ ...f.draft, candidate: { ...f.draft.candidate, summary: 'Pending edit' } }, f.draft.revision);
  const response = await f.app.request(`/api/jobs/${f.job.id}/artifacts/${f.artifact.id}/pdf?download=1`);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toContain(`resume-${f.artifact.id}.pdf`);
  expect(await response.text()).toBe('synthetic test PDF');
  expect(f.runtime.exports.list(f.job.id)).toEqual([]);
});
```

- [ ] **6. Add attachment behavior to the existing artifact-content route.** After `bytes` is obtained through `r.artifacts.content` and before returning the Response, use:

```ts
if (page === undefined && c.req.query('download') === '1') {
  c.header('Content-Disposition', `attachment; filename="resume-${uuid.parse(c.req.param('versionId'))}.pdf"`);
}
```

Replace the route's final raw `new Response` with `return c.body(new Uint8Array(bytes), 200, { 'Content-Type': page === undefined ? 'application/pdf' : 'image/png', 'Cache-Control': 'private, no-store' });` so the attachment header is preserved. Do not bypass `artifacts.content` to read disk paths.

- [ ] **7. Run:** `npm run build:core`, `npm run build:cli`, and `npx vitest run packages/cli/tests/job-exports.test.ts packages/cli/tests/jobs-routes.test.ts packages/cli/tests/job-artifacts.test.ts`. Expected: PASS.
- [ ] **8. Commit:** stage the service, runtime, route, API client, and tests; commit `feat(jobs): check and finalize job-linked resume drafts`.

## Task 8: Reactive checks with one in-flight request and stale-response protection

**Files:** Create `packages/ui/src/views/jobs/useJobDraftChecks.ts`, `packages/ui/tests/job-draft-checks.test.tsx`.

- [ ] **1. Write the race regression test.**

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { JobDraftCheck } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { useJobDraftChecks } from '../src/views/jobs/useJobDraftChecks.js';
const candidate = { profile: { name: 'A', title: 'Engineer', email: 'a@example.com' }, experiences: [], education: [], skills: [] };
const ready: JobDraftCheck = { status: 'ready', issues: [], job_revision: 1, binding: {
  candidate_fingerprint: 'candidate', context_fingerprint: 'context', input_snapshot_id: 'input', input_fingerprint: 'input-fp',
  parent_artifact_id: 'artifact', parent_artifact_fingerprint: 'artifact-fp',
} };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('does not enable finalization from an older in-flight result', async () => {
  vi.useFakeTimers();
  let finish!: (value: JobDraftCheck) => void;
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ...ready, status: 'blocked' });
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: '' } } });
  expect(h.result.current.ready).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => { finish(ready); await vi.advanceTimersByTimeAsync(1); });
  expect(h.result.current.ready).toBe(false);
  expect(check).toHaveBeenCalledTimes(2);
  expect(h.result.current.status).toBe('blocked');
});
it('marks failures unavailable and retries without changing content', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'checkJobDraft').mockRejectedValueOnce(Error('offline')).mockResolvedValue(ready);
  const h = renderHook(() => useJobDraftChecks('job', 'draft', candidate));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.result.current.status).toBe('unavailable');
  act(() => h.result.current.retry());
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.result.current.ready).toBe(true);
});
```

- [ ] **2. Run:** `npx vitest run packages/ui/tests/job-draft-checks.test.tsx`. Expected: missing hook.
- [ ] **3. Create the hook.** It compares the response with the active request identity on every render, not only after effects execute.

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobDraftCheck, ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { sseClient } from '../../api/events.js';
type Result = { key: string; value?: JobDraftCheck; error?: string };
export function useJobDraftChecks(jobId: string | undefined, draftId: string | undefined, candidate: ResumeSpec, paused = false) {
  const [nonce, setNonce] = useState(0), [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([jobId, draftId, candidate, nonce]);
  const current = useRef({ key, jobId, draftId, candidate, paused });
  current.current = { key, jobId, draftId, candidate, paused };
  const pending = useRef<{ key: string; due: number } | null>(null);
  const running = useRef(false), alive = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pump = useRef<() => void>(() => {});
  const schedule = () => {
    clearTimeout(timer.current);
    if (!pending.current || !alive.current) return;
    timer.current = setTimeout(() => pump.current(), Math.max(0, pending.current!.due - Date.now()));
  };
  pump.current = () => {
    if (running.current || !alive.current || !pending.current) return;
    const request = current.current;
    if (request.paused || !request.jobId || !request.draftId) { pending.current = null; return; }
    if (pending.current.due > Date.now()) { schedule(); return; }
    pending.current = null; running.current = true;
    apiClient.checkJobDraft(request.jobId, request.draftId, request.candidate).then(value => {
      if (alive.current && current.current.key === request.key && !current.current.paused) setResult({ key: request.key, value });
    }, error => {
      if (alive.current && current.current.key === request.key && !current.current.paused)
        setResult({ key: request.key, error: error instanceof Error ? error.message : 'Checks unavailable.' });
    }).finally(() => { running.current = false; if (alive.current) schedule(); });
  };
  const retry = useCallback(() => setNonce(n => n + 1), []);
  useEffect(() => {
    alive.current = true;
    const focus = () => retry();
    window.addEventListener('focus', focus);
    const offJobs = sseClient.onJobs(event => { if (jobId && event.job_id === jobId) retry(); });
    const offCorpus = sseClient.onCorpus(() => { if (jobId) retry(); });
    return () => { alive.current = false; clearTimeout(timer.current); window.removeEventListener('focus', focus); offJobs(); offCorpus(); };
  }, [retry, jobId]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!jobId || !draftId || paused) { pending.current = null; return; }
    pending.current = { key, due: Date.now() + 600 }; schedule();
    return () => clearTimeout(timer.current);
  }, [key, jobId, draftId, paused]);
  const active = result?.key === key ? result : null;
  const status = active?.error ? 'unavailable' : active?.value?.status ?? 'checking';
  return { status, ready: !paused && status === 'ready', check: active?.value,
    issues: active?.value?.issues ?? [], error: active?.error, retry };
}
export type JobDraftChecks = ReturnType<typeof useJobDraftChecks>;
```

- [ ] **4. Add focus, stale-error, and unmount tests to the same file.**

```tsx
it('ignores an older error and checks the newest candidate', async () => {
  vi.useFakeTimers();
  let rejectOld!: (error: Error) => void;
  vi.spyOn(apiClient, 'checkJobDraft').mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; })).mockResolvedValue(ready);
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: 'New' } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); rejectOld(Error('old request failed')); await vi.advanceTimersByTimeAsync(1); });
  expect(h.result.current.status).toBe('ready');
  expect(h.result.current.error).toBeUndefined();
});
it('invalidates readiness on focus before rechecking', async () => {
  vi.useFakeTimers();
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockResolvedValue(ready);
  const h = renderHook(() => useJobDraftChecks('job', 'draft', candidate));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.result.current.ready).toBe(true);
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(h.result.current.ready).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(check).toHaveBeenCalledTimes(2);
});
it('does not schedule queued edits after unmount', async () => {
  vi.useFakeTimers();
  let finish!: (value: JobDraftCheck) => void;
  const check = vi.spyOn(apiClient, 'checkJobDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const h = renderHook(({ spec }) => useJobDraftChecks('job', 'draft', spec), { initialProps: { spec: candidate } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  h.rerender({ spec: { ...candidate, profile: { ...candidate.profile, name: 'New' } } });
  h.unmount();
  await act(async () => { finish(ready); await vi.advanceTimersByTimeAsync(1000); });
  expect(check).toHaveBeenCalledTimes(1);
});
```
- [ ] **5. Run:** `npx vitest run packages/ui/tests/job-draft-checks.test.tsx`. Expected: PASS.
- [ ] **6. Commit:** stage the hook and test, commit `feat(jobs): reactively check the latest resume edits`.

## Task 9: Save, finalize, inline issues, and safe return from the editor

**Files:** Create `packages/ui/src/views/jobs/JobDraftActions.tsx`, `packages/ui/tests/job-draft-actions.test.tsx`; modify `packages/ui/src/views/ResumeTailor.tsx` and `packages/ui/src/App.tsx`. Use an inline leave-choice region with explicit focus handling.

- [ ] **1. Add tests for saving blocked content and using the saved revision for finalization.**

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import type { JobDraft, JobDraftCheck } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { JobDraftActions as Actions } from '../src/views/jobs/JobDraftActions.js';
import { useJobDraftChecks } from '../src/views/jobs/useJobDraftChecks.js';
function JobDraftActions(props: Omit<ComponentProps<typeof Actions>, 'checks'>) {
  const checks = useJobDraftChecks(props.draft.job_id, props.draft.id, props.candidate);
  return <Actions {...props} checks={checks} />;
}
const spec = { profile: { name: 'Name', title: 'Engineer', email: 'a@example.com' }, experiences: [], education: [], skills: [] };
const draft: JobDraft = { schema_version: 1, id: 'draft', workspace_id: 'workspace', job_id: 'job', revision: 2,
  input_snapshot_id: 'input', parent_artifact_version_id: 'artifact', candidate: spec, proposals: { proposals: [] },
  created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z' };
const ready: JobDraftCheck = { status: 'ready', issues: [], job_revision: 4, binding: {
  candidate_fingerprint: 'fp', context_fingerprint: 'ctx', input_snapshot_id: 'input', input_fingerprint: 'ifp',
  parent_artifact_id: 'artifact', parent_artifact_fingerprint: 'afp' } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
it('saves invalid edits even when checking fails', async () => {
  vi.spyOn(apiClient, 'checkJobDraft').mockRejectedValue(Error('offline'));
  const save = vi.spyOn(apiClient, 'saveJobDraft').mockResolvedValue({ draft: { ...draft, revision: 3 } });
  render(<JobDraftActions draft={draft} candidate={{ ...spec, profile: { ...spec.profile, name: '' } }}
    onSaved={() => {}} onBack={() => {}} onBusy={() => {}} onFocusIssue={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('job', 'draft', 2, expect.objectContaining({ profile: expect.objectContaining({ name: '' }) })));
  expect(screen.getByRole('button', { name: 'Finalize resume' })).toBeDisabled();
});
it('finalizes the saved edited revision and returns after success', async () => {
  vi.spyOn(apiClient, 'checkJobDraft').mockResolvedValue(ready);
  vi.spyOn(apiClient, 'saveJobDraft').mockResolvedValue({ draft: { ...draft, revision: 3 } });
  const finalize = vi.spyOn(apiClient, 'finalizeJobDraft').mockResolvedValue({ artifact: { id: 'new' } as never });
  const back = vi.fn();
  render(<JobDraftActions draft={draft} candidate={{ ...spec, profile: { ...spec.profile, name: 'Edited' } }}
    onSaved={() => {}} onBack={back} onBusy={() => {}} onFocusIssue={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Finalize resume' })).toBeEnabled(), { timeout: 2000 });
  fireEvent.click(screen.getByRole('button', { name: 'Finalize resume' }));
  await waitFor(() => expect(finalize).toHaveBeenCalledWith('job', 'draft', expect.objectContaining({ expected_draft_revision: 3, binding: ready.binding })));
  expect(back).toHaveBeenCalledOnce();
});
```

- [ ] **2. Run:** `npx vitest run packages/ui/tests/job-draft-actions.test.tsx`. Expected: missing component.
- [ ] **3. Add `JobDraftActions`.** Hold save acknowledgements internally so an immediate second action cannot use a stale prop revision. Keep a retry request until a different candidate is explicitly finalized. A failed finalization never clears edits.

```tsx
import { useEffect, useRef, useState } from 'react';
import type { DraftIssue, FinalizeJobDraftRequest, JobDraft, ResumeSpec } from '@featherduster/core';
import { apiClient, ApiError } from '../../api/client.js';
import type { JobDraftChecks } from './useJobDraftChecks.js';
export type JobLeaveGuard = (proceed: () => void) => void;
export function JobDraftActions({ draft, candidate, checks, onSaved, onBack, onBusy, onFocusIssue, onLeaveGuard, onDiscard }: {
  draft: JobDraft; candidate: ResumeSpec; onSaved(draft: JobDraft): void; onBack(): void;
  onBusy(busy: boolean): void; onFocusIssue(issue: DraftIssue): void;
  checks: JobDraftChecks; onLeaveGuard?(guard: JobLeaveGuard | null): void; onDiscard?(candidate: ResumeSpec): void;
}) {
  const saved = useRef(draft), lock = useRef(false), current = useRef(candidate);
  current.current = candidate;
  const [busy, setBusy] = useState<'save' | 'finalize' | null>(null);
  const [message, setMessage] = useState(''), [conflict, setConflict] = useState(false), [leaving, setLeaving] = useState(false);
  const [savedKey, setSavedKey] = useState(JSON.stringify(draft.candidate));
  const retryRequest = useRef<{ key: string; request: FinalizeJobDraftRequest }>();
  const pendingDestination = useRef<(() => void) | null>(null);
  const leave = () => { const next = pendingDestination.current; pendingDestination.current = null; if (next) next(); else onBack(); };
  useEffect(() => {
    onLeaveGuard?.(proceed => {
      if (lock.current) { setMessage('Wait for the current save or finalization.'); return; }
      if (JSON.stringify(current.current) === JSON.stringify(saved.current.candidate)) { proceed(); return; }
      pendingDestination.current = proceed; setLeaving(true);
    });
    return () => onLeaveGuard?.(null);
  }, [onLeaveGuard]);
  const dirty = JSON.stringify(candidate) !== savedKey;
  useEffect(() => {
    if (draft.revision > saved.current.revision) { saved.current = draft; setSavedKey(JSON.stringify(draft.candidate)); }
  }, [draft]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const persist = async (snapshot: ResumeSpec) => {
    if (JSON.stringify(snapshot) === JSON.stringify(saved.current.candidate)) return saved.current;
    const result = await apiClient.saveJobDraft(draft.job_id, draft.id, saved.current.revision, snapshot);
    saved.current = result.draft; setSavedKey(JSON.stringify(snapshot)); onSaved(result.draft); return result.draft;
  };
  const act = async (kind: 'save' | 'finalize', leave = false) => {
    if (lock.current || conflict || (kind === 'finalize' && !checks.ready)) return;
    const check = checks.check, snapshot = structuredClone(current.current);
    lock.current = true; setBusy(kind); setMessage(''); if (kind === 'finalize') onBusy(true);
    try {
      const next = await persist(snapshot);
      if (kind === 'save') {
        setMessage('Draft saved.');
        if (leave && JSON.stringify(current.current) === JSON.stringify(snapshot)) {
          const nextDestination = pendingDestination.current; pendingDestination.current = null;
          if (nextDestination) nextDestination(); else onBack();
        }
        else if (leave) setMessage('New edits arrived while saving. Save again before leaving.');
      } else if (check) {
        const key = JSON.stringify([next.id, next.revision, check.job_revision, check.binding]);
        const request = retryRequest.current?.key === key ? retryRequest.current.request : {
          expected_job_revision: check.job_revision, expected_draft_revision: next.revision,
          binding: check.binding, idempotency_key: crypto.randomUUID(),
        };
        retryRequest.current = { key, request };
        await apiClient.finalizeJobDraft(draft.job_id, draft.id, request);
        onBack();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Request failed. Your edits are retained.';
      setMessage(text);
      if (error instanceof ApiError && error.status === 409) setConflict(true);
    } finally {
      lock.current = false; setBusy(null); onBusy(false);
      if (kind === 'finalize') checks.retry();
    }
  };
  const reloadRevision = async () => {
    try {
      const result = await apiClient.getJobDraft(draft.job_id, draft.id);
      saved.current = result.draft; setSavedKey(JSON.stringify(result.draft.candidate));
      onSaved(result.draft); setConflict(false); checks.retry();
      setMessage('Latest saved revision loaded. Your local edits are retained; review before saving over it.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Reload failed.'); }
  };
  return <section className="space-y-3 rounded-xl border border-slate-700 p-4" aria-label="Job resume actions">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!!busy || conflict} onClick={() => void act('save')}>Save draft</button>
      <button type="button" disabled={!!busy || conflict || !checks.ready} onClick={() => void act('finalize')}>Finalize resume</button>
      <button type="button" disabled={!!busy} onClick={() => dirty ? setLeaving(true) : onBack()}>Back to resume</button>
    </div>
    <p role="status" aria-live="polite">{busy === 'finalize' ? 'Finalizing resume…' : busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : 'Draft saved'}</p>
    <p role="status" aria-live="polite">{checks.status === 'checking' ? 'Checking current edits…' : checks.ready ? 'Ready to finalize' : checks.status === 'blocked' ? 'Resolve the issues below to finalize. Saving is available.' : 'Checks unavailable — Retry'}</p>
    {checks.error && <p>{checks.error}</p>}
    {checks.status === 'unavailable' && <button disabled={!!busy} onClick={checks.retry}>Retry checks</button>}
    {checks.issues.length > 0 && <ul aria-label="Resume issues">{checks.issues.map((issue, i) => <li key={`${issue.path}-${issue.code}-${i}`}>
      {issue.path ? <button onClick={() => onFocusIssue(issue)}>{issue.message}</button> : issue.message}
    </li>)}</ul>}
    {message && <p role="status">{message}</p>}
    {conflict && <button disabled={!!busy} onClick={() => void reloadRevision()}>Review latest saved revision</button>}
    {leaving && <section role="region" aria-label="Unsaved changes" className="rounded border p-3">
      <p>Save your changes before returning to the resume?</p>
      <button disabled={!!busy || conflict} onClick={() => void act('save', true)}>Save and return</button>
      <button disabled={!!busy} onClick={() => { pendingDestination.current = null; setLeaving(false); }}>Keep editing</button>
      <button disabled={!!busy} onClick={() => { onDiscard?.(saved.current.candidate); current.current = saved.current.candidate; leave(); }}>Discard unsaved changes and return</button>
    </section>}
  </section>;
}
```

Use an inline leave region, as above, rather than a modal; focus its first action when shown and restore focus to Back to resume on Keep editing. No modal hook is needed for this inline version. Add refs to those two buttons and this effect:

```tsx
const saveAndReturnRef = useRef<HTMLButtonElement>(null);
const backRef = useRef<HTMLButtonElement>(null);
useEffect(() => { if (leaving) saveAndReturnRef.current?.focus(); }, [leaving]);
// Back to resume: ref={backRef}
// Save and return: ref={saveAndReturnRef}
// Keep editing handler:
onClick={() => { pendingDestination.current = null; setLeaving(false); backRef.current?.focus(); }}
```

- [ ] **4. Integrate into `ResumeTailor`.** Replace its linked-draft section with the following. Remove the old `savingJobDraft` state/ref and inline save callback. Add `const [finalizingJobDraft, setFinalizingJobDraft] = useState(false);` and guard the `changeField` entry point with `if (finalizingJobDraft) return;`. Wrap the editable canvas content after this toolbar in `<fieldset disabled={finalizingJobDraft} className="min-w-0 border-0 p-0 m-0">` so all native inputs/buttons are disabled during finalization. Do not wrap the toolbar itself.

```tsx
{linkedJobDraft && jobDraft && <JobDraftActions
  draft={jobDraft} candidate={currentSpec} checks={jobChecks} onSaved={setJobDraft}
  onBack={() => onBackToRuns?.()} onBusy={setFinalizingJobDraft} onFocusIssue={focusJobIssue}
  onLeaveGuard={onLeaveGuard} onDiscard={candidate => {
    const next = manualFromSpec(candidate, payloadRef.current.selectedResumeId);
    payloadRef.current = next; setPayload(next);
  }} />}
```

Add a focused issue navigation callback. Set `data-resume-path` on profile, summary, experience header, bullet, education, and skills fields; paths must refer to the exported `currentSpec`, not internal bullet IDs. Excluded bullets are not counted in that projection. For a visible bullet with stable `id`, compute its index as `experience.bullets.filter(b => b.included).findIndex(b => b.id === bullet.id)`.

```tsx
const focusJobIssue = (issue: DraftIssue) => {
  if (issue.path.startsWith('profile.')) setShowProfileEditor(true);
  if (issue.path.startsWith('education.')) setShowEduEditor(true);
  if (issue.path.startsWith('skills.')) setShowSkillsEditor(true);
  if (issue.path.startsWith('experiences.')) setMobilePane('bullets');
  else setMobilePane('matcher');
  requestAnimationFrame(() => {
    const field = Array.from(document.querySelectorAll<HTMLElement>('[data-resume-path]'))
      .find(element => element.dataset.resumePath === issue.path);
    field?.focus(); field?.scrollIntoView({ block: 'center' });
  });
};
```

Add a summary textarea to the candidate editor if absent (the current canvas has summary state but no directly labeled summary editor):

```tsx
<label className="block text-sm">Professional summary
  <textarea data-resume-path="summary" value={summary} onChange={e => setSummary(e.target.value)}
    className="mt-2 w-full rounded border border-slate-700 bg-slate-950 p-3 text-white" />
</label>
```

Render path-specific issues alongside fields, not just in the toolbar. In `ResumeTailor` import `useJobDraftChecks`, `JobDraftActions`, `JobLeaveGuard`, and core `DraftIssue`. Add `onLeaveGuard?: (guard: JobLeaveGuard | null) => void` to its props and destructuring. After `currentSpec` is created, call the hook once, with `const jobChecks = useJobDraftChecks(loading ? undefined : linkedJobDraft?.jobId, loading ? undefined : linkedJobDraft?.draftId, currentSpec, finalizingJobDraft);`. Use this helper beside each field:

```tsx
const fieldIssues = (path: string) => jobChecks.issues.filter(i => i.path === path);
const inlineIssues = (path: string) => <span id={`issue-${path}`} className="block text-sm text-amber-700 dark:text-amber-300">
  {fieldIssues(path).map((i, n) => <span key={n} className="block">{i.message}</span>)}
</span>;
// On each editable field:
// aria-invalid={fieldIssues(path).some(i => i.severity === 'block') || undefined}
// aria-describedby={fieldIssues(path).length ? `issue-${path}` : undefined}
// After that field: {inlineIssues(path)}
```

For standalone canvas mode, call the hook with undefined job/draft IDs so it makes no requests. Suppress the generic preflight badge for linked drafts, because its pass result is not job readiness. In `compileActiveSpec`, retain markdown preview compilation but skip `runPreflight` for linked drafts. Keep generic behavior unchanged elsewhere.

- [ ] **5. Preserve a retry intent across reloads and lost success responses.** Import the value `FinalizeJobDraftRequestSchema` in `JobDraftActions`. Change the retry ref's type to include `candidateKey: string`, then add the code below. Call `rememberIntent({ key, request, candidateKey: JSON.stringify(snapshot) })` in place of the existing assignment immediately before finalization; call `forgetIntent()` immediately after an acknowledged success and before `onBack()`. Do not replay on mount automatically.

```ts
const intentStorageKey = `job-finalize:${draft.job_id}:${draft.id}`;
const [hasPendingIntent, setHasPendingIntent] = useState(false);
useEffect(() => {
  try {
    const raw = sessionStorage.getItem(intentStorageKey);
    if (!raw) return;
    const value = JSON.parse(raw);
    if (typeof value.key !== 'string' || typeof value.candidateKey !== 'string') return;
    retryRequest.current = { key: value.key, candidateKey: value.candidateKey,
      request: FinalizeJobDraftRequestSchema.parse(value.request) };
    setHasPendingIntent(true);
  } catch { /* Invalid recovery data is never sent to the server. */ }
}, [intentStorageKey]);
const rememberIntent = (intent: { key: string; candidateKey: string; request: FinalizeJobDraftRequest }) => {
  retryRequest.current = intent;
  setHasPendingIntent(true);
  try { sessionStorage.setItem(intentStorageKey, JSON.stringify(intent)); } catch { /* in-memory retry still works */ }
};
const forgetIntent = () => {
  retryRequest.current = undefined; setHasPendingIntent(false);
  try { sessionStorage.removeItem(intentStorageKey); } catch {}
};
const recoverFinalization = async () => {
  const intent = retryRequest.current;
  if (!intent || lock.current) return;
  lock.current = true; setBusy('finalize'); onBusy(true); setMessage('');
  try {
    await apiClient.finalizeJobDraft(draft.job_id, draft.id, intent.request);
    forgetIntent();
    if (JSON.stringify(current.current) === intent.candidateKey) onBack();
    else setMessage('The previous finalization completed. Your newer local edits are still here; review the current resume before continuing.');
  } catch (e) {
    setMessage(e instanceof Error ? e.message : 'Could not retrieve the finalization result.');
    if (e instanceof ApiError && e.status === 409) setConflict(true);
  } finally { lock.current = false; setBusy(null); onBusy(false); checks.retry(); }
};
// Render next to the normal actions:
{hasPendingIntent && <button disabled={!!busy} onClick={() => void recoverFinalization()}>Check finalization result</button>}
```

In the conflict-reload success path call `forgetIntent()` after explicitly retrieving the new saved revision: this is the user's chosen replacement of the stale intent. Below the conflict message render `<details><summary>Latest saved content</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(saved.current.candidate, null, 2)}</pre></details>` so the user can actually inspect the saved version before overwriting it. The local editor candidate remains unchanged.

- [ ] **6. Wire dirty navigation throughout the app.** In `App.tsx`, import `JobLeaveGuard` as a type and add these refs beside the existing `navigationGuard`. The existing synchronous guard for standalone drafts stays unchanged.

```tsx
const linkedLeaveGuard = useRef<JobLeaveGuard | null>(null);
const linkedLeaveBypass = useRef(false);
const linkedVisibleRef = useRef(linkedVisible);
linkedVisibleRef.current = linkedVisible;
const navigateLatest = useRef<(path: string, replace?: boolean) => void>(() => {});
```

At the start of `navigatePath`, before its existing standalone-draft guard, insert:

```tsx
if (!replace && linkedVisibleRef.current && !linkedLeaveBypass.current && linkedLeaveGuard.current) {
  linkedLeaveGuard.current(() => {
    linkedLeaveBypass.current = true;
    try { navigateLatest.current(path, replace); } finally { linkedLeaveBypass.current = false; }
  });
  return;
}
```

Immediately after the `navigatePath` declaration assign `navigateLatest.current = navigatePath;`. In `handlePopState`, before the existing standalone-draft guard, insert:

```tsx
if (linkedVisibleRef.current && linkedLeaveGuard.current) {
  const destination = canonicalPath(window.location.pathname + window.location.search);
  window.history.pushState({}, '', currentPath.current);
  linkedLeaveGuard.current(() => {
    linkedLeaveBypass.current = true;
    try { navigateLatest.current(destination); } finally { linkedLeaveBypass.current = false; }
  });
  return;
}
```

Pass `onLeaveGuard={guard => { linkedLeaveGuard.current = guard; }}` to the linked `ResumeTailor` instance. Its explicit Back/Finalize success callback has already handled saving/discarding, so replace `onBackToRuns` with:

```tsx
onBackToRuns={() => {
  linkedLeaveBypass.current = true;
  try { navigatePath(`/jobs/${linkedDraft.jobId}/resume`); }
  finally { linkedLeaveBypass.current = false; }
}}
```

Remove the two old `window.confirm('Replace the open job draft?...')` blocks, because the linked guard now covers dirty replacement as well as every other departure. Do not register the linked guard for standalone canvas instances. Because the linked editor remains mounted while hidden, only invoke its guard while `linkedVisibleRef.current` is true. Keep the browser's native `beforeunload` protection for reload/closing; native browser dialogs do not offer custom Save buttons.
- [ ] **7. Run:** `npx vitest run packages/ui/tests/job-draft-actions.test.tsx packages/ui/tests/job-draft-checks.test.tsx packages/ui/tests/resume-tailor.test.tsx packages/ui/tests/jobs-ui.test.tsx` and `npm run build:ui`. Expected: PASS.
- [ ] **8. Commit:** stage the action component, hook type export, canvas, App navigation changes, and focused tests; commit `feat(jobs): complete the resume edit and finalize flow`.

## Task 10: Resume-first review and Details navigation

**Files:** Create `packages/ui/src/views/jobs/JobResumeDetails.tsx`; modify `packages/ui/src/views/jobs/JobResumeReview.tsx`; add focused tests to `packages/ui/tests/jobs-ui.test.tsx` and create `packages/ui/tests/job-resume-details.test.tsx`.

- [ ] **1. Test the menu's keyboard/focus contract.**

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { JobResumeDetails } from '../src/views/jobs/JobResumeDetails.js';
afterEach(cleanup);
it('opens one secondary view and returns focus to Details', () => {
  render(<JobResumeDetails preview={<p>Resume preview</p>} renderView={name => <p>{name} content</p>} />);
  expect(screen.queryByText('checks content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Checks' }));
  expect(screen.getByRole('heading', { name: 'Checks' })).toHaveFocus();
  expect(screen.queryByText('Resume preview')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to resume' }));
  expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
});
it('dismisses the menu with Escape and supports arrow keys', () => {
  render(<JobResumeDetails preview={<p>Preview</p>} renderView={() => null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByRole('menuitem', { name: 'Checks' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Corrections' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
});
```

- [ ] **2. Run:** `npx vitest run packages/ui/tests/job-resume-details.test.tsx`. Expected: missing component.
- [ ] **3. Add the focused secondary-view shell.**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
export const resumeViews = { checks: 'Checks', corrections: 'Corrections', comparison: 'Comparison & evidence',
  history: 'Version history', exports: 'More export options' } as const;
export type ResumeDetailView = keyof typeof resumeViews;
export function JobResumeDetails({ preview, renderView, actions, notice }: {
  preview: ReactNode; renderView(view: ResumeDetailView): ReactNode; actions?: ReactNode;
  notice?: (open: (view: ResumeDetailView) => void) => ReactNode;
}) {
  const [view, setView] = useState<ResumeDetailView | null>(null), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const menu = useRef<HTMLDivElement>(null), restore = useRef(false);
  const show = (value: ResumeDetailView) => { setOpen(false); setView(value); };
  useEffect(() => {
    if (view) heading.current?.focus();
    else if (restore.current) { trigger.current?.focus(); restore.current = false; }
  }, [view]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [open]);
  return <section className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">{actions}</div>
      <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
        <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>Details</button>
        {open && <div ref={menu} role="menu" aria-label="Resume details" className="absolute right-0 z-20 mt-2 w-64 rounded-lg border bg-white p-1 text-slate-900 shadow-lg dark:bg-slate-900 dark:text-white"
          onKeyDown={e => {
            const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
          }}>
          {(Object.keys(resumeViews) as ResumeDetailView[]).map(key => <button className="block min-h-11 w-full px-3 text-left" role="menuitem" key={key} onClick={() => show(key)}>{resumeViews[key]}</button>)}
        </div>}
      </div>
    </div>
    {notice?.(show)}
    {view ? <section className="space-y-4">
      <button onClick={() => { restore.current = true; setView(null); }}>Back to resume</button>
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{resumeViews[view]}</h2>
      {renderView(view)}
    </section> : preview}
  </section>;
}
```

- [ ] **4. Retain review loading, selected-artifact tracking, conflict handling, and `act` from the existing `JobResumeReview`.** Extract the PDF preview block (from `/* PDF Viewer & Page Previews */` through its matching card closure) unchanged into `const preview = ...` before the final return. Remove its standalone Open PDF action only if the shared toolbar provides the same access. Extract the comparison cards into `const comparison = ...`, dropping only their outer `<details>`/`<summary>`. Keep word-diff rendering, proposal citations, evidence alignment, and `BriefMarkdown` intact.

Replace the rendered page with this composition. Delete the old `if (!artifacts.length)` early return so Corrections can be opened through the same shell even before generation. Move the existing Approve Resume button/approval live region into `checksContent`; retain its complete disabled predicate and exact-bound approval behavior.

```tsx
const previous = pendingEdits || job.recovery?.kind === 'stale_inputs';
const historical = selected !== latestArtifact;
const unavailable = !displayedReview;
const checksContent = displayedReview ? <section className="space-y-3">
  <p>Validation: {displayedReview.artifact.validation_result}. Human approval: {isApproved ? 'Approved for this version' : 'Not approved for this version'}.</p>
  <span ref={approvalStatus} tabIndex={-1} role="status">{isApproved ? 'Resume approved' : ''}</span>
  {!isApproved && <button disabled={busy || conflict || pendingEdits || job.recovery?.kind === 'stale_inputs'
    || historical || job.revision !== revision || displayedReview.artifact.validation_result !== 'passed' || !displayedReview.artifact.pdf}
    onClick={() => void act(false)}>Approve Resume</button>}
  <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(displayedReview.validation_report, null, 2)}</pre>
</section> : <p>No generated resume checks yet.</p>;
return <section className="space-y-4 min-w-0">
  <div><h2 className="text-lg font-semibold">{historical ? 'Historical resume' : previous ? 'Previous finalized resume' : 'Resume'}</h2></div>
  {error && <div role="alert"><p>{error}</p><button onClick={() => { onSaved(); setReload(n => n + 1); }}>Retry</button></div>}
  <JobResumeDetails actions={<>
    {displayedReview && <button disabled={busy || conflict || job.revision !== revision || historical}
      onClick={() => workingDraft ? navigate(`/tailor/canvas/jobs/${job.id}/${workingDraft.id}`) : void act(true)}>
      {workingDraft ? 'Continue editing' : 'Edit resume'}
    </button>}
    {displayedReview?.artifact.pdf && (previous || historical ?
      <a href={`${apiClient.jobPdfUrl(job.id, selected)}?download=1`}>{historical ? 'Download historical PDF' : 'Download previous PDF'}</a>
      : <button disabled={busy} onClick={() => void downloadCurrent()}>Download PDF</button>)}
  </>} notice={open => <>
    {pendingEdits && <p role="status">You have draft changes — <button onClick={() => navigate(`/tailor/canvas/jobs/${job.id}/${workingDraft!.id}`)}>Continue editing</button>.</p>}
    {job.recovery?.kind === 'stale_inputs' && <p role="status">Starting inputs changed. This is the previous PDF. <button onClick={() => navigate(`/jobs/${job.id}`)}>Review posting and inputs</button></p>}
    {artifacts.length > 0 && job.preparation_state === 'needs_input' && job.recovery?.kind !== 'stale_inputs' &&
      <p role="status">Preparation needs attention. <button onClick={() => open(job.recovery?.kind === 'render' ? 'checks' : 'corrections')}>Resolve preparation issues</button></p>}
    {historical && <button onClick={() => setSelected(latestArtifact)}>Return to current resume</button>}
    {!artifacts.length && <p role="status">{job.preparation_state === 'preparing' ? 'Preparing your resume…' : 'No generated resume yet.'}
      {job.preparation_state === 'needs_input' ? <button onClick={() => open('corrections')}>Resolve corrections</button>
        : <button onClick={() => navigate(`/jobs/${job.id}`)}>Review posting and preparation</button>}</p>}
    {displayedReview && displayedReview.artifact.validation_result !== 'passed' && <p role="status">This version needs attention. <button onClick={() => open('checks')}>View checks</button></p>}
    {job.revision !== revision && <p role="status">The job changed. <button onClick={() => { onSaved(); setReload(n => n + 1); }}>Reload review</button></p>}
  </>} preview={unavailable ? (artifacts.length && !error ? <p role="status">Loading resume…</p> : null) : preview}
    renderView={view => {
      if (view === 'checks') return checksContent;
      if (view === 'corrections') return <JobProposalReview job={job} onSaved={onSaved} />;
      if (view === 'comparison') return displayedReview ? comparison : <p>No comparison available yet.</p>;
      if (view === 'exports') return displayedReview ? <JobExports job={job} artifact={displayedReview.artifact}
        blocked={job.recovery?.kind === 'stale_inputs' ? 'Starting inputs changed. Prepare with current inputs; historical files remain available.' : pendingEdits || historical} /> : <p>No exports available yet.</p>;
      return <section className="space-y-4">
        <label>Artifact version <select aria-label="Artifact version" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
          {artifacts.map(a => <option key={a.id} value={a.id}>{new Date(a.created_at).toLocaleString()} · {a.id.slice(0, 8)}</option>)}
        </select></label>
        <ol>{events.map(event => <li key={event.id}>{event.created_at} · {describeJobEvent(event.payload)}</li>)}</ol>
      </section>;
    }} />
</section>;
```

Import `JobResumeDetails` and `describeJobEvent`. Define `downloadCurrent` beside `act`:

```ts
const downloadCurrent = async () => {
  if (!displayedReview || pending.current) return;
  pending.current = true; setBusy(true); setError('');
  try {
    const selection = { artifact_id: displayedReview.artifact.id,
      artifact_fingerprint: displayedReview.artifact.version_fingerprint, dossier: false };
    const response = await fetch(`/api/jobs/${job.id}/exports/current/resume.pdf?selection=${encodeURIComponent(JSON.stringify(selection))}&download=1`);
    if (!response.ok) { const body = await response.json(); throw Error(body.error ?? 'Download failed. Retry.'); }
    const blob = await response.blob(), href = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = href; link.download = 'resume.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (e) { setError(e instanceof Error ? e.message : 'Download failed. Retry.'); }
  finally { pending.current = false; setBusy(false); }
};
```

Current download still runs the server's freshness checks. Historical download uses the exact immutable artifact route. No cover letter is selected by either action.

- [ ] **5. Update the existing review tests in `jobs-ui.test.tsx`.** Before asserting approval, click Details then Checks. Before asserting versions, click Details then Version history. Preserve tests for conflicting revisions, loading stale responses, exact artifact approval, preview images, and pending-edit export blocks. Add assertions to the existing pending-edit test:

```tsx
expect(screen.queryByText('Current working resume — edits pending checks')).not.toBeInTheDocument();
expect(screen.queryByText('Earlier corrections')).not.toBeInTheDocument();
expect(screen.getByRole('link', { name: 'Download previous PDF' })).toHaveAttribute('href', expect.stringContaining('?download=1'));
expect(screen.queryByText('Comparison, evidence and preparation history')).not.toBeInTheDocument();
```

- [ ] **6. Run:** `npx vitest run packages/ui/tests/job-resume-details.test.tsx packages/ui/tests/jobs-ui.test.tsx packages/ui/tests/jobs-polish.test.tsx packages/ui/tests/job-exports.test.tsx` and `npm run build:ui`. Expected: PASS.
- [ ] **7. Commit:** stage the new shell, review, and named tests; commit `feat(jobs): make resume review preview-first`.

## Task 11: Verify the full lifecycle and document it

**Files:** Create `docs/guides/job-resume-editing.md`; update acceptance tests identified above only when verification exposes a real gap.

- [ ] **1. Run the focused suite once.**

```powershell
npx vitest run packages/core/tests/job-draft-content.test.ts packages/core/tests/job-candidate-checks.test.ts packages/core/tests/job-proposal-review.test.ts packages/cli/tests/job-checked-render.test.ts packages/cli/tests/job-artifacts.test.ts packages/cli/tests/job-exports.test.ts packages/cli/tests/jobs-routes.test.ts packages/ui/tests/job-intake-default.test.tsx packages/ui/tests/resume-variant-picker.test.tsx packages/ui/tests/job-draft-checks.test.tsx packages/ui/tests/job-draft-actions.test.tsx packages/ui/tests/job-resume-details.test.tsx packages/ui/tests/jobs-ui.test.tsx
```

Expected: all pass. Do not treat mocked renderer tests as proof that actual LaTeX output fits.

- [ ] **2. Run required repository checks.** `npm test` then `npm run build`. Expected: exit 0 for both. Record failures and fix regressions attributable to this work; do not silently alter unrelated user changes. Run `git diff --check --` with the exact changed source/doc paths to avoid noise from the pre-existing lockfile change.
- [ ] **3. Perform a real browser walkthrough on a disposable job.** Use a copied/test workspace when finalizing to avoid changing the user's example job during verification. Open the existing example job read-only to check layout if helpful.

| Action | Required observation |
| --- | --- |
| Open `/jobs` | URLs selected; Text still works; failed-capture fallback starts in Text |
| Search variants with `snr eng`, clear, then use arrows/Enter | Stable fuzzy results; no source change until explicit selection |
| Open a generated job's Resume tab | One readable PDF preview; Edit, Download, Details; no expanded preparation sections |
| Open every Details destination, Escape from menu, return | Focus moves correctly; content is complete; no clipped menu at 375px width |
| Clear required name or add a metric placeholder | Inline block appears after debounce; Save draft still works; Finalize disabled with reason |
| Leave/reopen the saved invalid draft | Exact invalid text restored; no surprise validation failure during save |
| Edit while a slow prior check is running | Current status remains checking; old success never enables Finalize |
| Stop the checker/network, then save | Save independent where network permits; check failure labeled unavailable; retry available |
| Correct content and wait for PDF checks | Ready only after current candidate passes required content and rendered checks |
| Finalize | Exactly one new artifact; no model/proposal calls; no reusable variant or approval event; new preview/download |
| Retry after simulating lost success response | Same receipt/artifact returned, not a duplicate; pending intent can recover after reload |
| Make another edit, return to review | Compact pending notice, previous PDF explicitly labeled; previous bytes downloadable without a saved release |
| Change evidence/privacy during checking | Readiness invalidated; no mismatched publication; draft retained |
| Internal navigation, Back, Save-and-return, Stay, explicit Discard | No silent loss; intended destination respected after save; discarded unsaved content does not reappear |

- [ ] **4. Create the concise usage guide.**

```markdown
# Editing a job resume

Open the job and select Resume. The generated PDF is the main view. Edit resume opens its job-linked editor. Details contains checks, corrections, comparison and evidence, versions, and more export options.

Checks run as you edit. Save draft preserves incomplete work, even when checks identify issues. Finalize resume becomes available when the current edits pass their required checks. Finalizing generates the updated PDF for this job and returns to its preview. It does not create a reusable variant, approve the resume, or submit an application.

While draft changes are pending, the review page shows the previous finalized PDF. Download previous PDF downloads that version, excluding your pending edits. Previous versions remain in Version history.

If checking is unavailable, retry checks; you can still save. If saving conflicts with a newer revision, review the latest saved revision before saving your retained local edits. If finalization fails, the draft and previous PDF remain available. A pending finalization can be checked again using its original request without creating another artifact.

The standalone canvas's resume selector supports searching names and types, including ordered-character matches. Jobs intake starts in URLs; choose Text to paste a posting.
```

- [ ] **5. Final review and commit.** Verify no app flow exposes fingerprints, internal attempt tokens, or implementation instructions. Confirm status labels distinguish checking, saved, finalized, and human-approved states. Stage only the guide and actual fixes from verification; commit `docs(jobs): describe editing and finalizing resumes`.

## Requirement coverage

| Spec requirement | Tasks |
| --- | --- |
| URLs default and Text fallback | 1 |
| Search, fuzzy ranking, keyboard, missing selected source | 2 |
| Save invalid/incomplete draft independently | 3, 9 |
| Captured evidence, claim-specific grounding, privacy, rendered checks | 4, 5, 7 |
| Exact candidate/context bindings and immutable publication | 3, 6, 7 |
| Reactive debounce, one in-flight check, old-response rejection, retries | 7, 8, 9 |
| Finalize/save/return, issue focus, leave protection | 9 |
| Resume-first Details menu and previous downloads | 7, 10 |
| Existing approval, exports, materials, preparation remain separate | 5, 6, 7, 10 |
| Full regression, keyboard/mobile, real PDF walkthrough | 11 |

## Execution handoff

This is a plan, not implemented application behavior. Execute tasks in dependency order, review each commit, and record test results. Use either subagent-driven development with review between tasks or inline execution with checkpoints; obtain the user's execution preference before starting implementation.

## Planning self-review

- Cross-checked the requirements against the task coverage table; no approved feature is deferred to a separate unspecified task.
- Checked existing module paths, event/record shapes, privacy configuration, intake labels, and navigation interception before specifying integration changes.
- Kept strict finalized schemas separate from editable content; preserved old artifact fingerprints by making provenance optional without defaults.
- Included client timeouts, bounded rendering, request cleanup, stale-response rejection, exact-revision publication, durable replay, and explicit historical download semantics.
- Syntax-checked the standalone import-bearing TypeScript/TSX code blocks. This is syntax verification only; the proposed implementation and tests have not been executed. The task commands are required during implementation.

## Staging commands for Tasks 3–11

Use these explicit paths at each task's commit step. Include any additional test file only if that task actually changed it. Never use `git add .` in this workspace.

```powershell
# Task 3
git add packages/core/src/jobs/draft-content.ts packages/core/src/jobs/draft-validation.ts packages/core/src/jobs/schemas.ts packages/core/src/index.ts packages/core/tests/job-draft-content.test.ts packages/cli/src/jobs/routes.ts
git commit -m "feat(jobs): separate editable draft schema from final checks"
# Task 4
git add packages/core/src/jobs/candidate-checks.ts packages/core/src/jobs/proposal-review.ts packages/core/src/index.ts packages/core/tests/job-candidate-checks.test.ts
git commit -m "refactor(jobs): share candidate checks across review and editing"
# Task 5
git add packages/cli/src/jobs/resume-context.ts packages/cli/src/jobs/checked-render.ts packages/cli/src/jobs/exports.ts packages/cli/src/jobs/preparation.ts packages/cli/tests/job-checked-render.test.ts packages/cli/tests/job-exports.test.ts
git commit -m "refactor(jobs): share resume freshness and PDF verification"
# Task 6
git add packages/core/src/jobs/schemas.ts packages/cli/src/jobs/repository.ts packages/cli/src/jobs/artifacts.ts packages/ui/src/views/jobs/job-utils.ts packages/cli/tests/job-artifacts.test.ts
git commit -m "feat(jobs): add atomic manual resume publication"
# Task 7
git add packages/cli/src/jobs/draft-finalization.ts packages/cli/src/jobs/runtime.ts packages/cli/src/jobs/routes.ts packages/ui/src/api/client.ts packages/cli/tests/job-exports.test.ts
git commit -m "feat(jobs): check and finalize job-linked resume drafts"
# Task 8
git add packages/ui/src/views/jobs/useJobDraftChecks.ts packages/ui/tests/job-draft-checks.test.tsx
git commit -m "feat(jobs): reactively check the latest resume edits"
# Task 9
git add packages/ui/src/views/jobs/JobDraftActions.tsx packages/ui/src/views/ResumeTailor.tsx packages/ui/src/App.tsx packages/ui/tests/job-draft-actions.test.tsx
git commit -m "feat(jobs): complete the resume edit and finalize flow"
# Task 10
git add packages/ui/src/views/jobs/JobResumeDetails.tsx packages/ui/src/views/jobs/JobResumeReview.tsx packages/ui/tests/job-resume-details.test.tsx packages/ui/tests/jobs-ui.test.tsx
git commit -m "feat(jobs): make resume review preview-first"
# Task 11
git add docs/guides/job-resume-editing.md
git commit -m "docs(jobs): describe editing and finalizing resumes"
```
