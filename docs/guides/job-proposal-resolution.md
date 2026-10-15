# Resolve a blocked job proposal review

Use this guide when a job is in **Needs input → Proposals** or its Resume page says **Proposal review unavailable**.

## The pipeline in plain language

1. **Review generated changes.** Open the job, choose **Resume**, and inspect proposals marked **Needs attention**. Edit wording to match the evidence, add a citation and exact supporting passage, or reject a proposal to keep the original wording.
2. **Correct the starting resume.** These findings refer to the resume snapshot captured when preparation began. Editing generated proposals does not change the starting resume. Update the source resume in your career workspace, return to the job, and use **Refresh inputs**. Refreshing captures a new input snapshot; it does not start model work.
3. **Save and recheck.** Save proposal changes for this job, then select **Recheck saved revision**. A blocked review stays editable; **Continue preparation** unlocks only when the saved revision passes validation and inputs are current.
4. **Continue preparation explicitly.** This uses the exact saved review and starts the next stage. It does not approve or submit an application.
5. **Review the rendered resume separately.** After preparation succeeds, inspect the PDF and approve it only when the content is right.

## Choosing how to resolve a finding

- If a proposal adds an unsupported term or experience, remove that claim from the wording, reject the proposal, or cite a source that explicitly supports it. A terminology decision by itself does not establish experience.
- To add grounding, choose evidence attached to the proposal, select a literal passage, and explain how it supports the claim. Do not infer facts or metrics from a job description.
- For a finding on the starting resume, correct the source resume first. Then refresh inputs and prepare the refreshed snapshot as a separate action. Older reviews remain in history.
- **Remember a reusable relationship** only when the correction is factual and applies beyond this job. Job-only wording changes do not update shared evidence or skills.

## When a request times out

The page retains the last successfully loaded review and shows a timeout notice while it retries. Keep the page open; a later successful refresh clears the notice. If the service remains unavailable, reload the job after it responds. Do not prepare a new version merely because a review request timed out.

## Current checkpoint: one-page PDF ready (2026-10-15)

**Next step:** Open [the job’s Resume page](http://127.0.0.1:4173/jobs/1fe3d32d-3cc7-4d8b-a829-6ccc9e3683ff/resume), scroll to **Resume Review & Verification**, select the newest artifact (`6b0f958e-2402-42e9-b6b7-be56955cc2c8`), and click **Open PDF**. Inspect the wording, citations in the saved proposal review, and base-to-candidate diff. If Orca’s embedded PDF frame is blank, use [the PDF directly](http://127.0.0.1:4173/api/jobs/1fe3d32d-3cc7-4d8b-a829-6ccc9e3683ff/artifacts/6b0f958e-2402-42e9-b6b7-be56955cc2c8/pdf) in a PDF viewer. Do not repeat preparation just to view it. No approval or submission has been performed.

- Job revision **102**, state **resume_ready**, application **not_started**.
- Final attempt: `1bc4430d-32ae-4236-adc9-9660608d3627`; the input snapshot and one-page budget are unchanged.
- Saved review: `1afcb525-ad32-42f1-984b-22adac0f7428`, revision **1**, ready with no issues. Ten wording patches shorten the summary and proposed bullets, retaining their citations and prioritizing React/TypeScript, full-stack delivery, accessibility, and verified video experience. No music expertise or new unsupported experience was added. Source career resumes were not edited.
- All four preceding history revisions are JSON-identical to the backup; both prior feedback records remain unchanged. History now has five revisions and feedback has three records. Browser storage was backed up before reload; prior factory sessions were not edited.
- The final PDF passed the existing independent gate: **1 page / budget 1**, **100% expected-text coverage**, no missing fragments, and one PNG preview. The downloaded preview was visually inspected, including the contact links and bottom skills section. The earlier render artifact remains in history; use the newest artifact above.

### Additional rendering diagnosis

Condensation exposed a separate PDF extraction problem: this MiKTeX installation rendered T1 Computer Modern as Type 3 bitmap fonts without Unicode mappings. Ligatures such as `fi`, `fl`, and `ff` extracted as control characters. Discretionary hyphenation also split words that exact text verification correctly rejected. The compiler now emits Latin Modern outline fonts, glyph-to-Unicode mappings, and non-hyphenating paragraph settings with emergency stretch so long contact lines wrap within the page. The template identity, font size, margins, page budget, and exact verifier assertions are unchanged. Latin Modern and `glyphtounicode` must be installed; automatic package installation remains disabled.

### Default-test diagnosis and verification

The host reports 24 available processors. Unbounded file parallelism runs many subprocess-heavy integration suites simultaneously; elapsed wall time includes child-process startup and scheduler contention. The recorded Typst failure measured 1730 ms against the unchanged 1000 ms bound; the proposal continuation fixture uses a real 3000 ms lease and previously ended interrupted. The default Vitest configuration now bounds file workers to two (minimum one), rather than increasing deadlines or weakening assertions. This is a test resource policy, not a change to production worker leases or PDF timeouts.

The alignment failure showed citations saved but classification reverted to `gap`. Its row updater rebuilt state from a render-captured `draft`, allowing a later queued edit to overwrite an earlier update. It now merges each patch into the latest state using a functional updater. The original classification-and-citation assertion remains intact.

`npm run build` and plain **`npm test`** both exited **0** after the final changes. Earlier plain runs also exited 0, confirming the former failures were intermittent, not a consistently red baseline. Private evidence for this checkpoint is in `adws/adw_data/sessions/2efc54a8/context_handoff/`: `build-final.log`, `tests-final.log`, `template-red.log`, `before.sqlite3`, `feedback-preserved.json`, `final-proposals.json`, `artifact-review.json`, `final-resume.pdf`, and `final-page.png`. Runtime artifacts and career data must not be committed.

## Previous checkpoint: preflight fixed, content still two pages (2026-10-15)

The following records the earlier checkpoint; its remaining steps are superseded by the current PDF review step above.

Open [this job’s Resume page](http://127.0.0.1:4173/jobs/1fe3d32d-3cc7-4d8b-a829-6ccc9e3683ff/resume).

**PDF preflight is unblocked; a new saved proposal review is ready for human review.**
Normal browser polling remained active throughout preparation. Nothing was approved or submitted.

- Attempt: `796deaab-dd8b-4cbd-b3c9-9e6f30fe1b1a`, input `63e60811-b256-4f05-a684-5e24d976af3d`.
- Job revision: 76. The worker passed preflight, completed four model calls, and compiled a PDF.
- New generation: `2f3f9bad-52db-4cff-8ce8-d2779dae4635`.
- Saved review: `1afcb525-ad32-42f1-984b-22adac0f7428`, revision 0, validation ready with no issues; 12 proposed edits.
- The PDF gate correctly stopped at **Expected 1 pages, found 2**. The job is Needs input / Compile, not PDF-approved or resume-ready. A valid one-page PDF remains a separate layout/content decision.
- All three prior review revisions, including review `09bababe-4525-4515-8e34-1315a99e32aa` revision 2 and its saved corrections, compare byte-for-byte as parsed JSON before/after. History now contains four revisions. No old patch was automatically transferred to the new generation.
- Codex still uses the blank-model CLI default and existing ChatGPT sign-in. Claude Code also supports a blank model; API and Ollama runners require a model. No runner defaults, credentials, sources or timeouts were changed.
- The earlier explanation-only browser draft `Number` remains archived in localStorage and private backups. It is not saved feedback.

### Diagnosed cause and fix

Standalone tools were healthy. Under normal browser polling, synchronous request work
prevented Node from processing child-process completion before the five-second PDF
probe timers fired. Two contributors were reproduced:

1. Runner discovery and authentication status used synchronous subprocesses. A concurrent
   health request waited about 5.45 seconds during discovery. These read operations now
   use bounded asynchronous subprocesses, with unchanged deadlines, output limits and
   stripped credential environments. Login/logout behavior was not refactored.
2. A live CPU profile showed repeated `lstat → realpathSync → JobFiles.checked` calls
   during proposal reads. Each history revision revalidated the same 126 captured evidence
   files. Native path resolution avoids repeated JS ancestor walks; a synchronous read-only
   scope now shares already-verified immutable bytes within a proposal read. Every new
   request rechecks files, hashes and containment. No persistent cache or validation bypass
   was added.

Before the fix, proposal reads took 11–12 seconds. After both fixes, a measured read took
250 ms; health samples with polling active were 2–780 ms. Tests reproduce fast PDF probes
incorrectly timing out during slow discovery/path resolution, then pass with the fixes.
Additional checks cover tampering between reads, wrong fingerprints, returned-buffer
isolation, subprocess timeouts, oversized output and nonzero status parsing.

The existing Orca PowerShell terminal runs this worktree with:

```text
node packages/cli/dist/bin.js C:/Users/drewk/career --port 4173 --no-open
```

The unchanged host PATH resolves LaTeX/Poppler under
`C:/Users/drewk/AppData/Local/Programs/MiKTeX/miktex/bin/x64`.
Live worker progress through analysis, alignment, proposals, brief and compilation proves
preflight succeeded in the service, not just in a standalone probe. Browser resource
entries confirm normal visible-page polling; it was not disabled to obtain this result.

### Earlier remaining human steps (completed by the condensation checkpoint)

1. Open the Resume URL above. If the revision notice remains, compare the server candidate
   and use **Reconcile revision (keep edits)**, or reload if there are no unsaved changes.
2. Review the 12 new proposals and compare historical feedback, particularly the earlier
   unsupported wording correction. A validator-ready result is not human approval.
3. Decide how to fit the one-page template. Edit/reject wording as appropriate, **Save for
   this job**, and **Recheck saved revision**. Merely repeating Continue without changing
   the content/layout can reproduce the two-page gate.
4. **Continue preparation** only for the chosen saved revision, then inspect the resulting
   PDF. Approval and submission remain the user’s responsibility. Do not change source
   claims or page validation merely to force success.

### Timeouts are different

- HTTP read timeouts affect refresh; the last loaded editor remains available.
- PDF preflight uses five-second subprocess probes. Neither this deadline nor verification was relaxed.
- The model step deadline is separate and was not changed.

### Verification evidence

Private evidence is in `adws/adw_data/sessions/914f3ad2/context_handoff/`:
`latency-red.log`, `path-latency-red.log`, `live.cpuprofile`,
`latency-after-job.json`, `latency-after-proposals.json`, `latency-polling.json`,
and `latency-final.png`. The consistent active-database backup is
`latency-actual-backup.sqlite3` (not `latency-backup.sqlite3`, which targets the unused legacy path).

`npm run build` and the final `npm test -- --maxWorkers=2 --minWorkers=1` exited 0
(74 files, 958 tests passed, one skipped). Scoped regressions also exited 0. Two earlier
unbounded-parallel full runs exposed unrelated timing-sensitive assertions; the complete
suite passed with bounded worker concurrency. Do not commit runtime data, backups or screenshots.

### Earlier verification follow-up (superseded above)

The subsequent quality-gate failure in exact proposal continuation was inspected in
`quality/07_vitest/command.log`. A fresh unmodified `npm test` exited 0; a second
unmodified run passed that continuation test but failed the Typst elapsed-time and
alignment-editor assertions. This does not establish a new application defect or
justify changing leases, deadlines, or assertions. Default-parallel suite reliability
remains a follow-up; its precise scheduling cause has not been established.
`npm test -- --maxWorkers=2 --minWorkers=1` was independently rerun and exited 0,
as did `npm run build`. See `repair-tests.log`, `repair-tests-repeat.log`,
`repair-tests-confirmed.log`, and `repair-build.log` for the complete results.

Read-only live verification confirmed the proposal response is byte-for-byte
JSON-equivalent to the prior captured response: the ready review and all four history
entries remain unchanged. The existing Orca tab still polls job/control/proposals
normally (roughly five-second cadence), with sampled job reads around 0.9–1.1 seconds
and proposal reads around 0.2–0.8 seconds. Evidence: `repair-proposals.json`,
`repair-live-job.json`, `repair-browser.json`, and `repair-polling.json`.
No further attempt, content edit, approval, or submission was made. The remaining
human decision is still the two-page output against the one-page budget, not PDF
preflight or missing proposal history.
