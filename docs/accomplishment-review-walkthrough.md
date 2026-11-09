# Verify accomplishment synthesis and resume review

Use this walkthrough to verify the local November 5–6 implementation. Allow about 20–30 minutes for the main flow, plus runner time. Shared-correction checks take longer and need two jobs with matching work.

The changes are implemented in this checkout, but have not been committed or released. Start the app from this checkout to see them.

## 1. Start the current build

In PowerShell:

```powershell
Set-Location C:\Users\drewk\featherduster
npm run build
node packages/cli/dist/bin.js C:\Users\drewk\career --port 4174
```

Open **http://127.0.0.1:4174/jobs**. Leave that terminal running. Port 4174 helps distinguish this build from an older server on 4173. Stop this server with Ctrl+C when finished.

Use the existing runner configuration, consent, and preparation budgets. If the app reports a missing tool or unavailable runner, record that diagnostic; it is not a completed evidence check.

**Pass:** the build succeeds, the app opens, and the workspace shown is your career workspace.

## 2. Prepare a fresh review

1. In **Jobs → Save a job**, choose **Posting text**.
2. Use a fullstack/product-engineering posting, or paste this test posting:

   > We seek a senior product engineer to build tenant-scoped configuration workflows across admin APIs and user interfaces. The role includes API design, input validation, end-to-end testing, and delivery of usable product capabilities. Experience with data connectors is relevant.

3. Give it a recognizable company/role label, such as **Walkthrough / Product Engineer**, and click **Save job**.
4. Open its **Inputs** tab and check the **Starting resume**. Choose a resume containing your relevant employment experience. For a clear consolidation test, it should contain at least two related bullets for that experience.
5. Return to the job's **Posting** tab and click **Tailor resume**. It should start tailoring and open the resume page without asking you to click a second start button. For multiple jobs, use the **Prepare** checkboxes and **Prepare selected resumes** on the Jobs list instead.
6. Follow its preparation link, then open **Resume** when it needs review or has a PDF ready.

**Pass:** saving a job does not itself start preparation. Preparation either produces a checked PDF or stops at a specific question or recoverable failure.

Use a fresh job for this walkthrough. Older saved generations intentionally retain their previous review behavior; opening one does not regenerate it. If every claim already has support, the app may reach the PDF without pausing on the editable draft. That is expected—use the automated companion in section 11 to inspect a guaranteed exception scenario.

## 3. Judge the accomplishments

Read the draft or PDF as a hiring manager would. Then inspect **Changes** on the draft, or **Changes in this PDF** beneath the PDF.

- [ ] Each accomplishment describes a contribution and meaningful scope, with a supported purpose or outcome where available.
- [ ] Related work can become one accomplishment instead of separate API/UI/validation task bullets.
- [ ] Relevant evidence absent from the starting resume can appear in the draft.
- [ ] Unrelated work stays separate or is omitted with a rationale.
- [ ] Technical detail explains the work; the writing does not read like a commit log.
- [ ] No unsupported ownership, adoption, impact percentages, or combined metrics appear.

For your confirmed connector example, an acceptable result is:

> Built tenant-scoped connector setup across admin APIs and configuration UI, with write-time validation to reject malformed configurations.

The admin API, configuration UI, and validation evidence support this example, together with your confirmation that the API and UI formed the same workflow. Database migration tooling should remain separate. Exact wording and selection can vary by posting and page budget; the model is not required to reproduce this sentence.

Open a **Consolidation** entry if one was generated. Its **Before** should contain multiple original bullets, and **After** should contain one accomplishment. On an editable draft, try **Undo change**, save, and inspect the restored originals. Use **Restore change** to include the consolidation again.

**Pass:** undo restores the original bullets together without rewriting unrelated accomplishments. If no consolidation was generated, mark that branch **Not exercised**, rather than treating its absence as a defect by itself.

## 4. Inspect the complete draft and exceptions

When a fresh job pauses for review:

1. Check that **Resume draft** shows the complete resume, including contact information, employment, skills, and education when present.
2. Look at **Review exceptions** beside it.
3. The first unresolved passage should already show its actual question and **Your factual answer** field. Use **Passage to review** or **Next passage** to switch. The corresponding resume wording should be highlighted.
4. Expand **Edit wording or evidence instead** when the claim itself needs changing. **All passages** provides the complete queue without pushing the current answer controls below it.
5. Resize the browser to roughly 390px wide. The exception panel should move below the resume and remain readable without horizontal page overflow.

| State | What it should mean |
| --- | --- |
| Needs your answer | A factual decision or blocking correction is still required. |
| Checking | A persisted evidence check is running. |
| Needs retry | A completed usable check is missing or failed; inspect its diagnostic. |
| Resolved | Persisted support exists for the saved wording. |

**Pass:** missing results do not appear as Resolved. Unsaved edits are visibly distinguished from checked saved wording.

## 5. Verify saving and factual confirmation are separate

Use an actual unresolved question in a fresh review.

1. Enter a truthful answer in **Your factual answer**.
2. Click **Save answer, keep unresolved**.
3. Navigate away, return, and reload the browser.
4. Confirm the exact answer is retained and the fact still needs resolution.
5. Complete or correct the answer. Choose **This job only** under **Reuse this answer** if you do not want to share it.
6. Click **Confirm for this job and continue**. Alternatively, choose **Matching work in this project** and **Confirm and save for this project** for reusable support.

**Pass:** saving an answer does not imply confirmation. Confirmation is recorded as human support, separately from machine evidence checks. The resume is still subject to its remaining checks.

Your earlier chat answer is recorded in the calibration notes and calibration report. It was not inserted into every saved application's project knowledge. To exercise in-app shared reuse, save an answer through these controls.

## 6. Change an evidence mapping

Before final PDF generation, expand **Evidence** and inspect the titled sources and excerpts.

1. Select **Add or remove evidence** for a generated passage.
2. In its editor, open the evidence chooser. Find a source by title and inspect its text.
3. Change a mapping, close with **Done choosing evidence**, and save the draft or use **Save for this job**.
4. Observe the new checks. Restore the correct source mapping and save again.

**Pass:** source changes are saved independently of checking. A previous successful check cannot automatically stand in for the changed mapping. An insufficient mapping may need a question, narrower wording, or retry; changing a mapping does not guarantee failure if the remaining sources still support the claim.

The chooser contains the job's captured sources. Newly added corpus evidence requires an explicit input refresh before that job can use it.

## 7. Verify automatic PDF continuation and final approval

1. Resolve required questions and save the draft.
2. Let the evidence and resume checks finish.
3. Verify that PDF generation continues automatically. **Retry PDF generation** is a recovery action if continuation fails.
4. Inspect the actual PDF preview and **Changes in this PDF**. Check before/after wording and omitted accomplishments. **Complete before and after text** includes the full comparison.
5. Approve only if the displayed version is the one you want to approve.

**Pass:** you do not have to acknowledge every supported generated edit. **Approve Resume** applies to the displayed current PDF. Downloading it and **Mark applied** remain separate actions.

The [confirmed calibration PDF](../walkthrough-output/accomplishment-real/coherent-confirmed/resume.pdf) is a small writing/export sample, not a complete job application resume. It remains unapproved.

## 8. Restore an omission and verify a new version

On a PDF with an **Omitted accomplishments** entry:

1. Note the current PDF and, if you approved it, its approval state.
2. Click **Restore accomplishment**.
3. Observe that the app saves a working draft, checks it, and generates a new PDF when it passes.
4. Verify the restored accomplishment appears in the new PDF.
5. Check that the new PDF requires fresh approval. The previous approval belongs to its historical version.

If restoration exceeds the page budget, the app first tries conservative wording reductions. If it still does not fit, **Replace one accomplishment** offers concrete removal choices. You can instead use **Open saved draft and checks** to edit it yourself.

**Pass:** no unrelated accomplishment silently disappears to make room. While a draft is pending, the displayed PDF's change summary still describes that PDF and identifies the pending draft separately.

Omitted generated additions, rewrites, and consolidations also appear here. Restoring a consolidation brings back its combined wording as one accomplishment, with its citations; it does not revive separate source bullets. The next PDF lists the restored wording in its change summary and requires fresh approval.

Overflow is conditional; a short resume may fit immediately. The focused automated test in section 11 deliberately exercises the overflow branch.

## 9. Verify shared answers and selected corrections

This is the longer branch. Use two fresh test jobs prepared from the same starting work and unchanged evidence. A third matching job lets you verify that an unselected draft stays unchanged.

1. In job A, confirm an answer with **Matching work in this project** selected.
2. Open job B and check the matching claim. Inspect **Resolved facts and supporting sources** for the saved answer. Different work, claim wording, qualifiers, or evidence versions may correctly prevent reuse.
3. If a real correction is needed, open the fact's **Review this fact** control in job A. Under **Correct an earlier answer about this claim (optional)**, select the exact earlier answer. Only answers matching this claim's work, predicate, and qualifiers are offered; another clause in the same summary is a separate question. Enter the corrected answer and effective date. If the correction changes the resume's claim, edit and save that wording as well.
4. Return to **Jobs** and inspect **Shared factual corrections**. Compare each affected draft's old wording and proposed replacement. Edit a replacement when the answer alone does not specify suitable resume wording.
5. Select only job B and choose **Update selected**.
6. Open B and verify that only the selected affected passages changed. Compare an unrelated bullet and any personal wording edits you made earlier.
7. Verify job C, if present, still has its previous wording and remains flagged.
8. Expand **Correction changes and undo**. After active preparation finishes, try **Undo update**.

**Pass:** conflicting answers require an explicit correction decision. Selected jobs are checked independently. Undo restores wording without deleting the correction from factual history. Published PDFs remain historical; a corrected draft needs a new PDF and approval. Reuse of a PDF with a known conflicting fact is blocked.

For deliberate false-to-true test corrections, use the synthetic integration test below rather than recording invented facts in your career workspace. If you have no real correction to make, mark the manual correction branch **Not exercised**.

## 10. Verify explicit style saving

1. On the editable review, expand **Use this style again**.
2. Enter a preference you want reused, such as “Lead with the delivered capability, then explain the technical scope.”
3. Click **Use this style again** and check the saved confirmation.
4. Make an ordinary wording edit elsewhere without using that control.

**Pass:** the explicit preference is saved separately from factual support. Ordinary wording edits remain local. Saving a preference does not retroactively rewrite existing drafts; a later fresh generation can use it.

## 11. Run the reproducible companions

These commands run from `C:\Users\drewk\featherduster` after the build in section 1.

### Browser, persistence, and real PDF workflow

```powershell
node scripts/verify-accomplishment-review.mjs
```

To verify that a user-omitted consolidation stays out of the first PDF and can then be restored atomically into a new PDF:

```powershell
node scripts/verify-accomplishment-review.mjs --omit-before-pdf
```

To reproduce a long exception queue like the 13-question review reported during the walkthrough:

```powershell
node scripts/verify-accomplishment-review.mjs --many-questions
```

That variant checks visible question/answer controls, passage switching, and mobile overflow. Its screenshots and report are saved under `walkthrough-output/accomplishment-ui-many-questions`.

This uses a disposable synthetic workspace and a deterministic fake model, with the real app, database, renderer, PDF checks, and browser. It verifies deferred-answer reload, mobile layout, automatic PDF continuation, visible change summary, omission restoration, and fresh approval. It approves only its synthetic test PDF and removes its temporary workspace afterward. It does not leave an interactive demo running.

Inspect:

- [Result report](../walkthrough-output/accomplishment-ui/report.json)
- [Desktop draft](../walkthrough-output/accomplishment-ui/desktop-draft.png)
- [Mobile draft](../walkthrough-output/accomplishment-ui/mobile-draft.png)
- [PDF and final change summary](../walkthrough-output/accomplishment-ui/final-pdf-and-changes.png)

**Pass:** the command exits successfully, all report checks are true, and `browser_errors` is empty. This proves workflow behavior; it does not measure the writing quality of a live model.

### Consolidation, shared corrections, and overflow

```powershell
npm test -- packages/core/tests/accomplishment-synthesis.test.ts packages/cli/tests/shared-clarification-workflow.test.ts packages/ui/tests/accomplishment-review.test.tsx
```

**Pass:** all tests pass. These cover atomic undo, stale/overlapping/reordered targets, legacy proposals, clarification reuse and conflicts, selected updates, historical approval, undo after publication, persisted exception states, and restoration with overflow recovery.

The existing [real-evidence report](../walkthrough-output/accomplishment-real/coherent-confirmed/report.json) records the configured-runner calibration plus your explicit workflow confirmation. Its machine result and human answer are kept separate. The one-page PDF passed export verification and the source ledger remained unchanged.

## Record your result

For each section, mark **Pass**, **Fail**, or **Not exercised**. For a failure, record:

```text
Section:
Job / URL:
Starting resume:
Action taken:
Expected result:
Actual result and exact message:
Does it survive reload?:
Screenshot, if useful:
```

A runner failure, a factual question, and poor writing are different findings. Record which one you observed so the next fix addresses the right problem.


### Confirming an answer and tracking progress

- Check the progress bars for resolved facts and passages. A passage may contain several factual questions; confirming one fact need not finish the passage.
- Confirm an answer. The form shows **Saving…**, then **Updating checks…**, and a saved confirmation naming the wording you confirmed. The progress count advances only when the saved result resolves the fact.
- If project reuse has no supporting quotation, an explanation appears beside the disabled project confirmation. Choose **Confirm for this job instead**, or add an exact quotation under **Use supporting evidence** to share it across the project.
- If a save response fails, the app checks whether the answer was recorded. It recovers a committed confirmation; otherwise it reports **Confirmation not recorded** or that saving could not be verified, and retains your text. If saving succeeded but later checks failed, the message explicitly says the answer was saved and directs you to **Update resume checks**.
- When all facts in a passage are resolved, use **Next passage** if other passages remain. Finishing factual review is separate from resume/PDF checks and final PDF approval.
- Reload after a successful confirmation: progress must still reflect the saved result.


### Moving past a saved confirmation

1. Confirm a fact, then select that completed passage again. Choose **Review the next question** in the status card. Verify that the app selects a passage with an unanswered question, scrolls to its question heading, and focuses it. It must not merely scroll to the sidebar title.
2. If the same passage has another unanswered fact, open a resolved fact and repeat the action. It must select the unanswered fact, preserving both your previous confirmation and any draft answer.
3. When there are no factual questions but a wording/evidence check still blocks the draft, the action is **Review remaining changes**. It shows the blocking reason and opens the wording/evidence editor.
4. A failed evidence check offers a retry; it does not ask you to reconfirm a fact. A saved confirmation names only the claim it resolved, and the UI explains when other questions remain.


### Previously answered questions

- After confirming an answer, verify its question and input disappear from the active form. Its answer and support remain in the collapsed **Resolved facts and supporting sources** history. Opening that history does not reopen a confirmation form.
- Reload and select the completed passage. The confirmed question must remain out of the active form, and **Next required action** must explain whether another passage or resume checks remain.
- If a previous answer exists only in browser recovery storage, expect **Finish saving your earlier answer**, not the original question as a new prompt. **Review or edit your earlier answer** starts collapsed. Use **Save existing answer for this job/project** without retyping it. This recovery state must not count as a saved confirmation until the server accepts it.
- An answer deliberately saved without confirmation shows **Confirm your saved answer**. It stays separate from completed questions.
- The page-level action updates from saved fact results immediately. While follow-up checks are running, it must not point back to the just-confirmed question.


### Leaving out an accomplishment

1. Select the passage and open **Edit wording or evidence instead**.
2. Choose **Leave out of this draft**. This removes the entire accomplishment from the preview, including a generated rewrite or consolidation. It does not confirm the fact or remove anything from the shared resume or ledger.
3. Choose **Save draft**. Verify that review no longer asks questions about the omitted accomplishment, including after reload.
4. Under **Changes**, find **Omitted by you**, choose **Restore accomplishment**, then **Save draft**. The original draft content and any earlier edits return; required checks run for restored content.
5. To remove only a phrase such as “reference application,” edit the wording instead of omitting the entire bullet.

This action requires the updated backend as well as the updated UI. Restart a previously running Featherduster server after rebuilding, then refresh the browser.


### Completed answers with remaining wording checks

- When every listed fact has saved support but wording/evidence checks still block publication, the page says **Factual answers complete; wording or evidence needs attention** and counts the affected passages.
- Choose **Review remaining changes**. The selected passage shows the blocking reason and an open wording/evidence editor. The factual panel explains that saved answers do not need reconfirmation.
- Passage-level completion describes only that passage. It does not imply that the whole resume or PDF is ready.
- While resume checks refresh, **Next required action** says to wait. Once they finish, it points to the remaining wording/evidence work or the resume status above.
