# Resume editing and finalization UX — PRD and design

Date: 2026-10-18
Status: Written specification approved by the user on 2026-10-18. Implementation planning follows this design.

## Outcome

Users can open a generated job resume, read it without navigating preparation details, edit it, see validation feedback as they work, finalize the edited version for that job, and download its PDF. Saving a draft does not require passing resume validation. This flow does not create a reusable resume variant.

Two adjacent improvements are included: searchable variant selection in the standalone canvas and URLs as the initial Jobs intake tab.

## Confirmed decisions

- Use a resume-first view with a **Details** menu, rather than persistent side navigation or a step-by-step wizard.
- Keep the job's default **Posting** landing view. Change the contents of its **Resume** tab.
- Finalize for the current job only; do not save generated content to the reusable variant library.
- Provide **Save draft**, **Finalize resume**, and **Back to resume** in the linked editor.
- Run validation reactively. Saving must not be blocked by content validation failures.
- Finalize becomes available only when the current edits have passed their required checks.
- Keep the existing generated PDF visible while a draft is being edited, with a compact pending-changes notice and clearly labeled previous-PDF download.
- Preserve edits when checking, saving, or PDF generation fails.

## Current implementation and gap

`packages/ui/src/views/jobs/JobResumeReview.tsx` renders corrections, a working candidate, the validated artifact, export controls, diagnostics, and history in the same page. Pending edits add a second resume representation above the PDF.

`packages/ui/src/views/ResumeTailor.tsx` explicitly hides the usual export drawer for linked job drafts. It saves those drafts through `apiClient.saveJobDraft`, but does not offer job-draft finalization. Its background `runPreflight` request is useful feedback but is not sufficient proof that a job candidate satisfies the captured inputs and PDF export requirements.

`packages/cli/src/jobs/routes.ts` provides job draft GET/PUT routes, artifact review/approval, and export routes. The draft PUT persists a schema-valid candidate without performing content validation. It has no job-draft check/finalize routes.

`packages/cli/src/jobs/artifacts.ts` publishes immutable artifacts from a draft revision under an ownership fence. `packages/cli/src/jobs/preparation.ts` orchestrates the automatic preparation path. New manual finalization must reuse the applicable validation/rendering and artifact integrity guarantees without regenerating suggestions or rewriting human edits.

`packages/cli/src/jobs/exports.ts` requires a current, verified, one-page PDF and rejects current exports while a working draft differs. Historical PDF access therefore needs an explicit historical path, rather than relabeling the current-export action.

## Scope

### 1. Searchable resume variants

Replace the native Resume Variant select in `/tailor/canvas` with an accessible searchable combobox. Search the displayed name and resume type, case-insensitively; normalize whitespace. Rank exact names first, then name prefixes, substring matches, and ordered-character fuzzy matches. For example, `snr eng` can match `Senior Engineer`. Ordered-character matching is the bounded fuzzy behavior for this release; arbitrary typo correction is not required.

An empty query shows all existing variants in their established order. Equal-ranked results retain that order. Show the full name and type, not an opaque ID as the normal label. Show **No matching resumes** for an empty result set. Preserve the selected source and the existing saved-source fallback even when it is absent from the currently loaded list.

Typing filters only; it must not switch the selected source or discard edits. Selection follows the existing source-switch behavior. Arrow keys navigate options, Enter selects, Escape closes without changing the selection, and Tab leaves the control normally. Expose expanded state, active option, and selected value to assistive technology. Keep focus stable and the active option visible.

This modifies selection among existing variants, not variant creation or job-draft promotion.

### 2. Jobs intake defaults

On a fresh visit to `/jobs`, the intake opens with **URLs** selected. Pasted text remains available. The explicit fallback flow for a URL that could not be captured continues to open in **Text** mode. Switching intake modes retains existing preview invalidation behavior. No persistence of the selected tab across visits is added.

### 3. Resume-first review

The main Resume view contains:

1. A short title and status describing the displayed version.
2. **Edit resume** (or **Continue editing** when a working draft exists), **Download PDF**, and **Details**.
3. The rendered resume preview, using the existing page images/PDF fallback.

Do not render working-draft markdown as another full resume above the PDF. Do not show expanded correction, comparison, evidence, or preparation panels by default.

The Details menu opens one secondary view at a time within the Resume tab:

- **Checks**: full validation diagnostics and existing version-bound human approval controls.
- **Corrections**: proposal corrections and their resolutions.
- **Comparison & evidence**: the existing comparison and supporting evidence/preparation explanations.
- **Version history**: previous artifacts and preparation history.
- **More export options**: existing alternative formats, material selection, and saved release bundles.

Each secondary view has **Back to resume**. Menu navigation is keyboard accessible; Escape dismisses the menu and restores focus to its trigger. Opening a view moves focus to its heading. Returning restores focus to Details. On mobile, the controls wrap and the content remains a single readable column.

Keep human approval distinct from validation, finalization, download, and job submission. Finalization does not create an approval event. Existing approval remains available under Checks and remains bound to its exact artifact and inputs.

### Display states

| State | Primary content and action |
| --- | --- |
| Generated PDF, no pending changes | Current resume preview; Edit resume; Download PDF |
| Working draft differs | Existing PDF labeled **Previous finalized resume**; compact **You have draft changes — Continue editing** notice; Download previous PDF |
| No PDF yet, preparation running | Concise progress and preparation status |
| No PDF yet, corrections required | Concise explanation and **Resolve corrections** opening the relevant secondary view |
| Inputs changed since generation | Retained PDF labeled as previous; brief changed-input notice and action to review/refresh inputs |
| Historical artifact selected | Explicit historical label; download that exact historical PDF; return-to-current action |
| Loading or retrieval failure | Loading status or actionable retry in the preview area; do not show another artifact as current |

Blocking issues must remain discoverable through a short main-view notice even though their full details are secondary. Do not hide the only recovery action inside an unexplained disabled button.

**Download previous PDF** fetches the exact immutable artifact already displayed. It does not use or relax the current-export freshness gate, create a new release, or imply that draft edits are included. Enforce the existing artifact/job relationship and file-integrity checks. Provide attachment behavior and a filename that distinguishes the previous version. A previous PDF need not have a previously saved release bundle to be downloadable. Unavailable or corrupt historical files show a specific error.

### 4. Job-linked editing and reactive validation

Use the existing canvas for editing. Place the job context and the three actions where they remain easy to find. Do not expose the standalone export drawer as a shortcut around job finalization.

Saving and checking are independent state tracks:

- Saving: unsaved, saving, saved, save failed/conflict.
- Checking: checking, needs corrections, ready to finalize, unavailable/stale.

Load the candidate and schedule checks immediately. After an edit, immediately invalidate the previous ready state. Debounce checks by 600 ms after the latest edit. Send a candidate snapshot to a job-specific check service without first requiring persistence. The service uses the job's captured evidence, privacy rules, supported claim decisions, template, and preparation policy. Existing generic preflight may be reused internally where appropriate; it cannot independently mark the job candidate ready.

Required checks cover the edited candidate's grounding/citations, unresolved metric placeholders, confidentiality, required candidate structure, and rendered PDF/page-budget constraints. Apply the same applicable rules to reactive checking and finalization. Non-blocking warnings do not disable Finalize. Never use a prior human grounding decision as blanket permission for changed wording.

Reactive checking includes the PDF compilation/layout checks needed to establish readiness. It makes no model calls, does not publish an artifact, and does not replace the visible finalized PDF. Limit rendering to one active check per editor and coalesce intervening edits into the latest candidate. Superseded work may finish, but its response cannot overwrite newer feedback or enable finalization. Temporary render results are bounded and cleaned up; they are not added to history as finalized resumes.

Each result is bound to the candidate fingerprint and relevant input/context fingerprints. Associate local requests with a monotonic sequence so stale successes, failures, and completion handlers cannot update the active state. Recheck when the editor regains focus or the job context changes. Server checks at finalization remain authoritative if external inputs changed between checks.

Show field-specific issues next to editable content where a location exists, with an aggregate status and issue list for document-level problems. Links in the issue list focus the affected editor field. Announce status changes politely without announcing each keystroke. A check-service or renderer failure says **Checks unavailable — Retry**; it does not masquerade as a content error or prevent saving.

### Save draft

Persist schema-valid editor content regardless of content-validation status, including unresolved placeholders or missing supporting citations. Do not require a PDF, passing checks, approval, or a model request. The editor's candidate representation must permit incomplete text without inventing invalid transport structures.

Saving can fail because of storage/network errors, invalid transport data, or a concurrent revision conflict. Report these honestly as save failures, preserve the local edits, and do not claim that validation prevented saving. Do not silently overwrite a newer saved revision. Leaving with unsaved edits offers save, stay, or explicit discard; this does not introduce automatic saving as a separate feature.

### Finalize resume

Enable **Finalize resume** only when checks passed for the exact current candidate/context, with no active save/finalization or unresolved revision conflict. Show a nearby reason when disabled.

The action:

1. Capture the exact candidate being finalized and save it if needed, using the expected draft revision.
2. Verify the candidate and context match the successful check and that the job can accept this finalization.
3. Produce or reuse the verified PDF output for that exact candidate and context. Reuse is allowed only with verified bindings; a cache miss can rerun the same deterministic checks/rendering.
4. Publish a new immutable artifact atomically and make it the job's current resume. Preserve the previous artifact and the edited draft lineage. The consumed draft must not continue to appear as pending changes against the new artifact.
5. Return to `/jobs/:jobId/resume`, showing the updated PDF with Download PDF available.

Finalization is idempotent for the same intent and exact bound revision. Repeated clicks, request retries, or reopening after an interrupted response must not create duplicate artifacts. Reject conflicting finalizations or automatic preparation ownership rather than interleaving their writes. Do not regenerate proposals, apply de-slop rewriting, change citations, or silently replace user wording.

During finalization, temporarily disable editing and show progress so the visible candidate cannot diverge from the version being finalized. On failure, restore editing and retain the saved draft. A generation error offers retry. A changed-input/revision conflict invalidates readiness and directs the user to refresh/recheck without discarding local content. No failed finalization replaces the last good artifact.

Existing cover letters and other materials are not silently regenerated or rebound to the new artifact. Preserve their current version/freshness rules. Resume-only download does not require generating those materials.

## Implementation boundaries

Follow the existing React/TypeScript UI, CLI service, core validation, and SQLite/file-bundle patterns.

- Extract a focused variant combobox and deterministic ranking helper from the standalone canvas controls.
- Keep `JobResumeReview` as the coordinating view; extract its primary preview/actions and secondary-view navigation to keep the new presentation understandable. Reuse existing correction, export, and evidence components.
- Add a dedicated job-draft validation/finalization service, wired through Jobs runtime and routes. Keep HTTP input parsing separate from domain checks and artifact publication.
- Share candidate validation and compilation rules with automatic preparation rather than introducing a second weaker validator. Extract narrowly scoped shared functions where the existing preparation orchestration couples these operations.
- Add a focused React hook/controller for reactive checks and stale-response protection. Keep save state independent of validation state.
- Extend the existing repository and artifact publication mechanisms for explicit manual finalization ownership and atomic current-version updates. Do not fake an automatic preparation run or bypass its integrity constraints just to publish a manual edit.
- Extend the typed API client with check/finalize contracts and historical PDF download behavior.

Check responses carry candidate/context bindings, structured issues, and rendered-check status. Finalization requests carry the expected job and saved draft revisions, checked candidate/context bindings, and idempotency key. The server verifies these values against trusted state; client-provided success flags are never sufficient.

## Acceptance and verification

1. Fresh Jobs intake selects URLs; explicit failed-capture recovery still selects Text.
2. Variant search supports exact, prefix, substring, and ordered-character matches, stable ranking, no-results, saved-source fallback, and keyboard selection without changing the source during typing.
3. A generated job resume opens with a single preview and its primary controls. Earlier corrections and other detail content are absent until requested.
4. Every Details destination and Back to resume works by keyboard and at mobile width. The chosen view has predictable focus behavior.
5. An invalid draft saves and reloads successfully without PDF generation or model calls.
6. Editing invalidates a previously passing result immediately. Out-of-order success/error responses never enable finalization for different edits.
7. Candidate checks use the captured job context; inline issues and page-budget failures appear before finalization becomes available. Warnings alone do not block it.
8. A failed check request preserves edits, leaves Save draft usable, and offers retry.
9. A valid edited draft finalizes into a new immutable artifact and returns to a downloadable preview. The output contains the exact edited wording and does not create a reusable variant or human approval event.
10. Duplicate finalization requests produce one artifact. Changed inputs, concurrent saves, preparation ownership, and revision conflicts cannot publish mismatched output.
11. PDF generation/publication failure retains the prior artifact and draft; retry can complete without redoing proposal generation.
12. Pending edits show one compact notice and a correctly labeled previous PDF. Its download contains the prior artifact, never the draft, even without an existing saved release bundle.
13. Existing approval, historical access, optional material exports, and source/ privacy freshness protections remain intact.

Use Vitest and React Testing Library for ranking, UI state transitions, focus, and controlled out-of-order responses. Add service/repository tests for exact bindings, idempotency, ownership conflicts, failed publication, and historical-download integrity. Reuse the existing Jobs artifacts/exports and canvas regression suites. Run the monorepo tests and build before completion. Perform a browser walkthrough of generation → edit → reactive issue → save invalid draft → resolve → finalize → download, plus a narrow viewport and keyboard-only pass.

## Non-goals

- Reusable variant creation from job drafts.
- A redesign of Posting, Fit, or the overall Jobs navigation.
- Automatic submission or automatic human approval.
- Automatic proposal regeneration or AI rewriting during typing/finalization.
- New export formats, bundle semantics, or removal of confidentiality checks.
- General restructuring of the tailoring system beyond boundaries needed for this flow.

## Design evidence

Selected approach: A, resume preview plus Details menu. Alternative B kept persistent side navigation at the cost of preview space; alternative C added a guided sequence that made repeated editing more procedural.

The first visual comparison had a layout collision and was rejected as unusable. Its replacement, `.superpowers/brainstorm/resume-ux-20261018/content/resume-layout-v2.html`, shows one full-width option at a time and a simulated editing/finalization path. It is a design sketch, not product implementation or proof that the proposed workflow already works.
