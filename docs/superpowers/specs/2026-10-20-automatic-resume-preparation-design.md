# Automatic resume preparation and final review queue

Status: agreed conversational design; written specification awaiting user review.

## Outcome

The user requests preparation for selected jobs. The product finds supporting evidence, repairs routine problems, removes unsupported qualifiers, and generates verified PDFs. It asks only questions that need the user's knowledge or a material content decision. Every finished resume enters a review queue; only an explicit approval marks its exact version approved. Downloading and submitting remain separate actions.

This design follows recovery of seven real jobs. Recovery required locating missed evidence, confirming a small number of facts, narrowing unsupported wording, fixing invalid skill reorders and duplicated bullets, fitting PDFs, and correcting typography comparisons. Those internal steps should not become a sequence of user-operated recovery screens.

## Agreed decisions

- Keep the resume preview central. Evidence, checks, corrections, and history remain under Details.
- Save edits immediately without waiting for successful checks. Checks run reactively after edits.
- Automatically remove unsupported qualifiers, but retain supported work and avoid unnecessary weakening.
- Ask before omitting an accomplishment or materially changing its meaning.
- Group equivalent factual questions across selected jobs, with visible scope and separate job-local records.
- An unanswered question pauses that job; other jobs continue. Preserve the draft and offer supported narrower wording where possible.
- Generate the PDF automatically after preparation and checks succeed; do not require another Continue action.
- Use one queue with separate review and approval for each finished resume.
- Approve & next records approval and advances. It does not download or submit.
- Editing an approved resume creates a new version requiring review. Historical approval remains attached to the earlier version.
- No reusable resume or shared evidence updates are required by this workflow.

## Alternatives considered

1. **Automatic preparation with focused review (selected):** automate conservative repairs, ask about material uncertainty, then require final PDF review. This reduces operational work without treating generated output as approved.
2. **Approve all repairs as a batch:** provides more intervention before generation but requires reviewing routine changes and still needs final PDF review.
3. **Generate a conservative PDF immediately:** produces output quickly but can silently omit or weaken valuable accomplishments. This is unsuitable when unresolved facts could preserve meaningful experience.

## User flow

### Start and monitor preparation

Prepare resumes starts work for the selected jobs using their current inputs and configured runner. Show actionable counts: Preparing, Needs your answer, Ready for your review, and Approved. These are presentation states derived from preparation, questions, current artifacts, and version-specific approvals; do not overload application submission status.

The product schedules jobs within configured concurrency and model budgets. A job waiting for an answer does not occupy a worker slot. Reloading, opening a page, or polling reads stored progress and does not dispatch duplicate model work.

### Necessary questions

Before asking, search captured sources using explicit citations, project context, terminology aliases, and related concepts. Missing a keyword is not proof that experience is unsupported. Aliases help retrieve evidence; they do not prove claims.

A question presents the precise uncertain fact, supporting or conflicting source excerpts, and the affected jobs. Example: “Is AI Analytics the same feature as Time Spend/TTS?” Actions are concrete answers, Use narrower wording when available, and Answer later. Show the proposed narrower sentence before the user selects it.

Equivalent questions can be answered once across visibly selected jobs. Equivalence requires matching work identity, predicate, and qualifiers, not merely the same employer or similar words. Revalidate each job's current bindings before applying the answer. Store linked job-local confirmations with human provenance. If a job changed, retain the answer for successfully bound jobs and identify the remaining job for review; do not silently attach it to changed claims.

Answer later preserves the draft and unresolved question. Other jobs continue. Links from the jobs list or worker status open the actual question, never a generic Posting page. Returning to a saved question preserves entered text. Advancing to the next question leaves its answer field editable while prior checks refresh.

### Automatic wording and technical repair

The repair process is conservative and auditable:

| Finding | Automatic action | User decision boundary |
|---|---|---|
| Terminology mismatch or incomplete retrieval | Inspect cited records and related source passages; verify exact support | Ask only if factual uncertainty remains |
| Unsupported leadership, scope, or timing qualifier | Remove the qualifier while preserving the documented implementation | Ask if the change would erase the accomplishment or materially alter its meaning |
| Composite sentence with partially supported claims | Separate supported content from uncertain assertions | Ask before dropping a distinct accomplishment or outcome |
| Repeated wording, duplicate bullets, invalid skill reorder, internal source IDs | Repair structure or formatting without adding facts | Ask before removing meaningful unique content |
| PDF overflow | Trim repetition and equivalent wording, then re-render | Ask before dropping accomplishments or changing the selected page limit |
| Transient check/worker/tool failure | Resume completed work and retry within bounded limits | Show a technical recovery action when the budget is exhausted; never ask the user to attest a technical failure |
| Conflicting evidence | Preserve both records and explain the conflict | Require factual clarification or the existing dated correction flow |

Removing “led” while retaining the documented implementation is permitted. Removing a project, a unique outcome, or the only statement of a relevant capability is material and requires a question. If the system cannot distinguish those cases confidently, ask instead of silently deleting content.

Every repair retains before/after text, reason, source bindings, and affected job/version. Meaningful wording changes appear in final review. Routine typography and mechanical repairs remain available under Details. Undo restores the prior wording as a new draft edit and reruns applicable checks; it does not bypass validation or restore approval.

### Final review queue

Only a current PDF that passes factual and independent export checks is Ready for your review. Present the actual PDF prominently, the company and role, a link to the original posting, and a compact summary of meaningful automatic changes. Previously approved omissions must remain visible in this summary. Unresolved factual questions keep that job in Needs your answer, outside the approvable queue.

Order ready items by the user's preparation selection order. Newly ready items do not interrupt the item being reviewed. Show queue position and remaining count. Review later advances without approval and leaves the item available in the queue. When all remaining items have been deferred, show that state rather than cycling indefinitely.

- **Approve & next:** approve the exact displayed artifact, then open the next ready item. Advance only after approval succeeds; duplicate submissions are idempotent.
- **Edit:** open the job's current draft, save freely, and schedule affected checks. Show that a displayed older PDF is being refreshed. Disable approval until the displayed PDF matches current content and checks.
- **Review later:** preserve the item's unapproved state and move on.

At queue completion, show approved and deferred counts. Downloads remain available separately. Neither approval nor download changes the job's application submission lifecycle. A user may download an unapproved PDF, but its review status must remain explicit.

## Architecture and integration

Build on the existing job repositories, immutable input snapshots, semantic service, proposal/base-correction overlays, draft finalization, artifact publication, and artifact approval route.

1. **Preparation coordinator:** owns durable work stages, bounded retries, worker scheduling, cancellation, and automatic continuation to rendering. It stops for material decisions and resumes from valid checkpoints after an answer.
2. **Evidence resolution and repair:** retrieves relevant captured evidence, classifies claims, proposes conservative transformations, and returns either validated edits or focused questions. It cannot grant human confirmation or publication approval.
3. **Question grouping:** groups only equivalent open facts across the selected jobs and applies scoped answers through each job's normal revision checks.
4. **Artifact validation/publication:** verifies the exact candidate and PDF. Preserve independent metric, citation, privacy, page-count, and text-coverage checks. Normalization of typographic quotes must still reject missing or changed words.
5. **Review queue:** projects current ready artifacts and their version-specific approvals. It owns navigation and deferral, not generation or evidence decisions. Approval uses the existing artifact fingerprint and input/revision binding.

Use stable original targets or explicit target mappings when applying repairs. Rendered bullet order must not be used as an original-base index; the recovery run exposed how that can replace the wrong bullet and introduce repetition.

Invalidate only affected work where safe. Reuse exact unchanged passage results under the existing input/evidence/configuration bindings. A newer edit or evidence revision must prevent stale rendering results and stale approvals from becoming current.

## Recovery behavior and budgets

Technical failures and factual uncertainty are distinct states. A timeout is not “unsupported experience.” Preserve saved text and successful checks through both.

Allow one automatic retry for a transient failed operation and at most two automatic wording/layout repair passes per candidate revision. All calls count toward the existing configured preparation limits; reaching a limit stops automatic dispatch even if a local retry allowance remains. No silent provider/model escalation, consent change, or unbounded loop is permitted. A substantive user edit or an explicit Retry starts a new bounded cycle; polling never does.

Retry checks opens or resumes the affected operation. Review current inputs opens the actual changed inputs and explains what changed. Worker busy is handled by scheduling, not shown as a factual blocker. Exhausted recovery shows one concise explanation and the relevant action, with technical diagnostics under Details.

## Acceptance criteria

- A selected batch progresses from preparation to verified PDFs without manual navigation through proposals, checks, and Continue screens.
- Removing an unsupported qualifier retains documented work and produces a visible, undoable final-review change.
- A recoverable retrieval mismatch is resolved from captured evidence before prompting the user.
- Missing evidence, contradictions, and technical outages remain distinguishable.
- A material omission requires a decision; an unanswered question pauses only its job.
- One answer can resolve equivalent facts in selected jobs without updating reusable resumes or shared evidence; a mismatched or stale job is not silently confirmed.
- Saving succeeds while checks are unavailable, and the next question's field remains editable during refresh.
- Repeated refreshes, retries, and event delivery do not duplicate preparation, confirmations, artifacts, or approvals.
- Repairs respect original target identities after reordering and do not create duplicate bullets or unsupported skills.
- PDF generation automatically follows passing checks. Page overflow, missing text, privacy violations, and stale inputs still block publication.
- The queue shows the actual current PDF and meaningful changes. Approve & next approves only that version and does not download or submit.
- A subsequent edit requires review of a new PDF; an older approval remains historical.
- Review later does not approve, lose the item, or create an endless navigation loop.
- Batch completion exposes separate download and job-posting links for the final artifacts.

## Verification

Use focused service tests for repair boundaries, equivalence grouping, revision races, retry budgets, stable targets, and approval binding. Use UI tests for question navigation, editable answers during refresh, PDF freshness, deferral, and queue advancement after successful approval. Use an end-to-end batch with synthetic equivalents of the observed cases and the real PDF renderer: terminology mismatch, missing role evidence, ambiguous feature identity, unsupported qualifiers, reordered bullets, skills duplication, overflow, typographic quotes, and an interrupted worker.

Measure questions per job, duplicate questions avoided, jobs reaching final review without intervention, retries exhausted, and repairs undone during review. Reduced prompts alone is not success: factual constraints and explicit final approval must remain intact.

## Scope and next step

This is one end-to-end workflow with staged implementation across coordination, factual review, and final approval. It excludes auto-submission, automatic approval, broad shared-evidence learning, reusable resume creation, provider escalation, and unrelated layout redesign.

After written-spec review, create an implementation plan with dependencies and focused checks. This specification does not authorize implementation by itself.
