# Job proposal recovery and corpus learning — approved design

Date: 2026-10-14
Status: Approved by the user on 2026-10-14, including reusable corpus learning. Implementation planning follows this design.

## Outcome

A job that stops on unsupported proposal wording should show the exact proposed change, the evidence used, why validation stopped, and the available corrections. The user can save corrections, leave, return, and explicitly continue without losing completed work or repeatedly asking a model for the same output.

The default remains automatic candidate preparation. User review is required when something blocks that preparation; generating a candidate does not accept proposals or approve the final resume.

User feedback must also improve subsequent runs. Corrections that establish reusable evidence or skill knowledge should become inspectable, versioned corpus updates, so the user does not repeatedly resolve the same grounding problem. Job-specific decisions must retain their narrower scope.

## What the current incident establishes

Job `1fe3d32d-3cc7-4d8b-a829-6ccc9e3683ff` reached the proposals stage. Its posting analysis and alignment were saved, but its proposal generation failed validation before a proposals checkpoint or draft was written. Only the joined error messages survived.

The alignment classified backend experience as backed using `ev-014`, `ev-025`, `ev-026`, and `ev-017`. Those entries describe APIs, schemas, connector logic, and BFF authentication without the literal term `backend`. Candidate validation deliberately uses a stricter evidence boundary than manual Tailor: it does not treat a model's alignment classification as authority to introduce unsupported terminology.

The captured evidence also contains entries with the literal term, including `ev-028` through `ev-031`. That makes citation selection a plausible correction, but each proposed claim still needs inspection. Matching a keyword alone does not establish the entire claim.

The Jobs UI cannot currently inspect these rejected proposals. Its generic preparation answer is not consumed by the proposal validator, and Resume review requires an artifact that this job never reached. Start automatic preparation skips jobs with unresolved blockers.

## Approaches

| Approach | Benefit | Cost or limitation |
| --- | --- | --- |
| Review only blockers, with access to all proposals — selected | Keeps automatic preparation useful while making failures recoverable. Preserves valid edits and lets the user make targeted corrections. | Requires durable proposal output, a revisioned review record, and explicit continuation rules. |
| Require review of every proposal before generating a PDF | Gives the user control over every change. | Adds a mandatory manual stage to every queued job and changes the existing candidate-preparation workflow. |
| Automatically omit blocked proposals and generate a partial candidate | Produces an artifact quickly. | Can silently discard an important rewrite or leave an untailored section. Omission should be an explicit user choice, not an invisible default. |

A retry button can supplement the recommended approach, but cannot replace editing and evidence inspection. Repeated generation must not become the only way out of a deterministic validation failure.

## The user journey

1. The job header says **Needs review — proposal wording needs evidence** and offers **Resolve proposals**. The worker explains that it is idle because jobs need review.
2. The Resume tab opens a review workspace even when there is no PDF. Blocking proposals appear first; all other proposals remain accessible.
3. Each proposal shows the original text, proposed text, affected resume section, relevant posting requirement, cited evidence passages, and its current checks. Related checks about the same claim are grouped without discarding their underlying details.
4. The user edits wording, changes citations, rejects the proposal, or records a claim-specific grounding decision. When the feedback establishes reusable knowledge, the editor previews what the corpus would learn and offers **Save and remember** or **Save for this job**. Unsaved changes remain visible until a successful save is acknowledged.
5. Saving creates a new review revision and recomputes validation locally. **Save and remember** also promotes the previewed reusable update into the corpus. Neither action makes a model call or starts the worker. The result explains exactly what remains unresolved.
6. Once all included proposals and the resulting candidate pass the required checks, **Continue preparation** runs the remaining stages using that exact validated revision.
7. The resulting PDF, diff, and brief enter the existing resume review flow. Approval remains bound to the exact artifact and inputs.

Saving a correction and continuing are distinct actions. A user should never discover that opening evidence or saving text unexpectedly resumed processing.

## Resolution actions

| Problem | Useful action | Expected result |
| --- | --- | --- |
| Wording exceeds the cited evidence | Edit wording | Recheck the revised claim against its citations. |
| Relevant support already exists in the captured evidence | Choose evidence | Search and inspect captured entries, then recheck the proposal with the selected citations. |
| The proposed change is unwanted or cannot be supported | Reject proposal | Exclude that change and show the retained original text in the candidate preview. |
| The claim is supported but uses different terminology | Record grounding decision | Attach an evidence passage and explanation to this claim; optionally remember the supported skill/evidence relationship for future jobs. |
| Evidence needs a factual correction or a new entry | Open evidence editor, then refresh inputs | Preserve the review, show the changed inputs, and explicitly start a new preparation version. |
| The user wants another model suggestion | Suggest a revision | Make one explicit, bounded request for the selected proposal and display the suggestion alongside the user's current text. |

Evidence search results should distinguish literal term matches, the evidence's confidence, and human grounding decisions. None should be labelled proof that an entire claim is true merely because a keyword matches.

**Suggest a revision** is optional follow-up scope. It must not overwrite human edits, change citations silently, or loop until validation happens to pass.

## Grounding decisions and reusable knowledge

The user's corpus-learning requirement extends the proposed claim-specific grounding decision: a correction can resolve the current proposal and establish reusable knowledge when the user chooses to remember it.

Selected policy: allow a narrowly scoped human grounding decision for terminology, while preserving strict metric, citation, privacy, and factual-experience checks. For example, API/BFF work may support the broader label `backend`; RabbitMQ work does not establish direct Kafka experience.

Such a decision records the claim text, proposal revision, cited evidence versions, selected passage, explanation, and who recorded it. The immediate resolution remains bound to the particular claim. A reusable skill/evidence relationship is a separate record with a defined scope and support level. Neither becomes an unrestricted global synonym rule or a blanket candidate-confirmed flag. Editing the claim or changing its supporting evidence requires review of the affected decision again.

Literal matches remain one form of support. Approved, evidence-bound skill relationships provide another, so users do not have to insert job keywords into source narratives just to satisfy a string matcher.

## Learning from feedback across jobs

The feedback loop is: **correct a proposal → inspect the reusable update → save and remember → use that knowledge in later jobs**. This is durable application knowledge in the local corpus, not a promise that a model's weights or conversational memory have learned the correction.

### Learn the right kind of information

| User feedback | What the corpus can remember | Boundary |
| --- | --- | --- |
| “This API/BFF work demonstrates backend development.” | A confirmed relationship between the named evidence passages and a specific backend-development skill or concept. | Does not establish every backend technology, architectural responsibility, or domain. |
| “Use these entries to support that claim.” | A claim/skill-to-evidence association and citation-selection guidance. | Future text still needs support from the selected sources. |
| “I also owned this component; here is what I did.” | A proposed addition or correction to the factual evidence, retaining the user's statement and its provenance. | Do not silently mark unrelated details or metrics verified. |
| “This evidence does not support that claim.” | An evidence-specific negative relationship or correction to an earlier relationship. | Does not imply that the person lacks the skill entirely. |
| “This is true but irrelevant to this role.” | A job- or role-scoped relevance decision. | Do not retract the underlying evidence. |
| “Avoid this wording in my resumes.” | A scoped writing preference or preferred phrasing. | Writing preferences do not become evidence of experience. |
| Reject with no explanation | The proposal decision and its history. | Do not infer a global factual correction from an ambiguous rejection. |

Every saved correction retains its feedback history. Only an explicitly selected reusable update becomes active corpus knowledge. The proposed update is visible in the same editor, avoiding a separate confirmation dialog for each save. A reasonable scope is suggested from the correction, and the user can narrow it.

### Represent supported skills explicitly

A reusable relationship should identify:

- The canonical skill or concept, its precise facet, and permitted terminology.
- The supporting evidence IDs, versions or fingerprints, and selected passages.
- Whether the support is direct, transferable, or explicitly absent from those sources.
- Relevant employer, project, role, or workspace scope.
- The user's explanation, originating feedback and job, confirmation time, and active/superseded status.

For this incident, the system could remember that confirmed API/BFF passages in the cited Parable evidence support **backend application development**. It can then retrieve that evidence and use the broader term appropriately on subsequent jobs. That relationship does not by itself support claims about specific technologies, music/ML experience, scale, metrics, or a higher level of ownership.

The source evidence remains inspectable. The Skills view can show the relationship and its supporting passages; it must not count the feedback event as a second accomplishment or inflate evidence coverage by duplicating the original source.

### Apply learning consistently

The same active corpus knowledge must be consumed by:

1. Evidence retrieval, so a search for backend work can find the confirmed API/BFF examples.
2. Analysis/alignment and proposal prompts, so models receive the supported concepts and relevant corrections before generating wording.
3. Deterministic proposal validation, so an approved, appropriately scoped skill/evidence relationship is recognized when the proposal actually cites its sources.
4. The evidence and skills UI, so the user can inspect, revise, or withdraw what was learned.

A prompt-only memory would not fix this incident because the validator could still reject the wording. Conversely, weakening validation without improving retrieval could keep selecting poor citations. Accepted learning must travel through both paths.

Missing or retracted citations, unsupported metrics, privacy rules, and unsupported experience upgrades remain independently enforced. The generation model cannot promote its own suggestion into human-confirmed corpus knowledge.

### Version, conflict, and undo behavior

Reusable updates are local, versioned, and auditable. Repeated saves of the same correction should not create duplicate knowledge. Contradictory feedback should surface a conflict or explicitly supersede an older decision rather than silently use the last write.

The user can undo or withdraw a learned relationship. New runs stop using it; historical job snapshots retain the knowledge version they actually used. A source correction or retraction invalidates dependent relationships for future use until rechecked. An unrelated source edit should retain the relationship when its bound passages can be verified unchanged; otherwise mark it for review.

New job snapshots capture the applicable active corpus-knowledge version together with the evidence. Already-running jobs do not silently switch to new knowledge midway through preparation.

A current job can use its explicit claim-review decision against its existing evidence snapshot while the corresponding reusable relationship is promoted for future jobs. If the correction adds factual evidence absent from that snapshot, applying it to the current job requires an explicit input refresh and the usual invalidation rules.

### Fit the existing corpus format

The current evidence schema has themes, narrative, confidence, metrics, and source references, but no structured feedback or skill-grounding relationship. Its parser/serializer validates through that schema, so arbitrary new metadata would not reliably round-trip.

The current evidence-update endpoint also refuses to rewrite entries inside a consolidated ledger. Consequently, learning cannot depend on silently appending keywords to whichever source file an entry came from.

Selected storage direction: introduce a schema-backed companion collection of feedback, explicit evidence amendments, and skill/evidence relationships, keyed to stable evidence identities and versions. Merge approved amendments and active relationships into the effective corpus read model while keeping the original source and the amendment diff inspectable. An amendment needs a base-version check so an external ledger edit cannot be overwritten by an old correction. It can therefore support consolidated-ledger entries without rewriting the entire ledger. Direct source-file edits remain an explicit operation through an editor that supports the source's storage format. Use durable operation identities and recoverable publication so a save retry cannot leave a remembered update detached from its review or feedback history.

New factual statements retain their own confirmation basis and confidence; they must not inherit verification merely because they amend an otherwise verified record. In particular, adding a metric requires an explicit metric update and the existing metric-grounding rules. The effective corpus must preserve those distinctions when it is shown, searched, snapshotted, and validated.

The first delivery should support user-confirmed evidence corrections, skill/evidence relationships, corrected citation associations, and their withdrawal. Broader automatic preference learning and model-suggested factual enrichment can follow once those semantics are proven.

## Durable output and review

The design needs three distinct records:

- **Generated output:** immutable model output tied to its job, attempt, and input snapshot. Persist it before semantic validation can stop the stage. Normalize model-supplied decisions and ignore model-supplied validation authority.
- **Review revision:** append-only user edits, citation selections, inclusion decisions, and any grounding decisions. Each revision retains its generation and input binding.
- **Validation result:** server-computed issues and candidate preview bound to the exact review revision, input snapshot, and validator version.

The review also links to the feedback events and any corpus updates it produced. The corpus-knowledge version used for generation and validation becomes part of the preparation input binding.

A blocked generation must not be saved as a successfully completed proposals checkpoint. Retaining output and completing a stage are different events. A valid reviewed revision becomes the input to a completed proposals checkpoint when preparation continues.

Reuse the existing draft and artifact conventions where their meanings fit. Do not infer the active review by finding whichever draft happens to be newest: a historical artifact fork or alternative generation must not unexpectedly become the current preparation input.

Validation checks are derived data. On recheck, recompute machine checks from the current text and citations rather than retaining obsolete errors. Preserve human decisions as separate provenance; do not accept client-provided `checks`, approval flags, or validation status as authoritative.

## Resume and invalidation rules

| Change | Work to reuse | Work to invalidate or repeat |
| --- | --- | --- |
| Wording edit, rejection, or citation change within the same saved evidence | Posting analysis and alignment, when still valid | Proposal validation, candidate application, brief, editorial cleanup, compilation, and PDF verification. |
| Remember an evidence-bound skill relationship | Current explicit claim-review decision and unchanged evidence | Include the new corpus-knowledge version in future snapshots; current jobs opt into a refresh if they need the newly learned corpus state. |
| Add or edit source evidence | Keep the old review and outputs as history | Capture refreshed inputs. The current implementation conservatively invalidates the checkpoint chain when the input snapshot changes. |
| Change the posting or base resume | Keep prior versions for inspection | Capture refreshed inputs and rerun the affected preparation chain. |
| Change only the template or page policy | Keep prior content as history | Capture a new version and rerun the required checks. Selective reuse requires explicit dependency fingerprints. |
| Change wording or evidence used in a grounding decision | Unaffected decisions | Revisit that decision and all checks or output depending on it. |

Stage-specific dependency fingerprints could later preserve posting analysis across evidence changes or content across template changes. The first implementation should use conservative existing invalidation rather than claim partial reuse it cannot verify.

Continue must freeze the selected review revision. A second tab, late model response, or newer draft cannot alter an attempt's chosen input. Stale saves should return a conflict and preserve the user's local text for reconciliation.

**Ready to continue** means the saved content revision passed its required checks. Credentials, consent, installed tools, worker ownership, and Stop controls are checked again when execution starts. The start response must distinguish an active attempt, a genuinely queued request, and a prevented start. Repeated clicks on the same request must not create duplicate attempts or model calls.

Existing Stop and pause controls remain authoritative. If they prevent continuation, the UI must state the reason and next action; an acknowledgement with no launched attempt is not a successful start. Whether to add a separate one-job run while automatic preparation stays stopped is a separate product decision.

## Blockers need types, not only sentences

Keep `needs_input` as the overall preparation state, but distinguish what the user can resolve:

- Proposal validation: open the affected proposal or candidate field.
- Missing candidate or employer fact: show an appropriate answer form.
- Runner, consent, or tool setup: link to the relevant setup action and offer recheck.
- Stale evidence or inputs: explain the difference and offer an explicit refresh.
- Render or page-budget failure: retain the candidate and validation details so the user can revise content or select a suitable template.

Each issue needs a stable kind, subject, relevant evidence and requirements, and application-owned allowed actions. The UI should not parse error-message text to decide which form to display.

A generic confirmed answer must not suppress a proposal check. Confirmed candidate facts, claim-grounding decisions, and final resume approval have different meanings and must remain separate.

The headline is a summary; detailed issues remain individually inspectable. For the current incident, the two backend messages can be grouped as one grounding problem with two validation checks.

## Older jobs and interrupted work

This job's original proposal text was not retained and cannot be reconstructed reliably from the error messages. Offer **Recover proposal review**, explaining that it will reuse the saved analysis and alignment and generate the missing proposal output once. Preserve that output even if its checks fail again.

After recovery, ordinary wording and citation corrections should not require another proposal-generation call. A restart should reopen the same review revision. Interrupted or timed-out generation must remain distinct from an available generation that failed semantic validation.

Alternative generations form explicit versions. Preserve previous human edits and allow comparison; do not replace them automatically with newly generated text.

## Edge cases the design must handle

- Rejected proposals do not contribute their claims, but rejecting everything must still validate the retained base resume.
- Candidate-wide issues need field-level destinations even when no individual proposal caused them.
- Multiple proposals changing the same target need explicit conflict handling and a predictable candidate preview.
- Missing or retracted citations cannot be resolved by merely asserting that the wording is acceptable.
- Live evidence changes are visible separately from the captured evidence version; publication must not silently mix them.
- Rechecking an unchanged revision should produce a stable result without duplicate events or model calls.
- A late save or model response cannot revive cancelled work or overwrite the revision selected by an active attempt.
- Server-sent refreshes should update status without erasing a focused, unsaved editor.
- Review controls should remain usable on a narrow screen and through keyboard navigation, with errors associated with the affected field.

## Suggested delivery boundaries

1. **Durable proposal recovery:** persist generated output, expose typed proposal issues, and recover this older job without losing its completed stages.
2. **Usable resolution:** provide wording edits, evidence inspection and citation changes, rejection, save/recheck, and explicit continuation of a validated revision.
3. **Grounding and corpus learning:** add scoped grounding decisions, remember user-confirmed evidence corrections, skill/evidence relationships, and citation corrections, use them in retrieval/generation/validation, and provide provenance, invalidation, and undo.
4. **Optional assistance:** add bounded suggestions, broader preference learning, and more selective reuse after the core recovery path is proven.

Steps 1 through 3 belong in the first usable delivery. Persisting invalid output alone, adding an editor whose changes are ignored on resume, or remembering feedback only in prompts would leave the requested recovery and learning loop incomplete.

## Acceptance examples

- The backend incident opens the affected proposal and its actual cited passages. Editing to supported wording or choosing supporting evidence removes the appropriate errors after recheck.
- Rejecting the affected proposal retains the original resume content and lets other valid edits proceed if the resulting candidate passes.
- Saving, reloading, and continuing use the same reviewed text and citations; analysis and alignment are not regenerated when their inputs are unchanged.
- A refreshed evidence snapshot invalidates old validation and never silently changes a historical artifact.
- Stale edits from two tabs preserve local text and cannot overwrite the current review.
- Rechecking makes zero model calls. Regeneration makes only the explicitly requested bounded calls.
- Stop, cancellation, missing tools, and PDF failure each show a concrete next action and preserve the work needed to resolve the problem.
- Resume approval continues to bind to the exact generated PDF and input version.
- Remembering the backend-development relationship on this job makes a subsequent job retrieve and recognize the same supporting evidence without requiring the same terminology decision again, provided the claim and source support remain applicable.
- A job-only rejection does not retract a skill; a wording preference does not become a factual evidence claim.
- A remembered broad skill relationship cannot validate a new unsupported metric, technology, domain, or ownership claim.
- Withdrawing the relationship or retracting its supporting evidence prevents future reuse while retaining the historical audit trail.
- Remembered relationships survive corpus reload and parser/serializer round trips, including when their source entries reside in a consolidated ledger.
- A factual correction to a consolidated-ledger entry is available in the effective corpus without destructive source-file rewriting, and an external change to its base version triggers reconciliation.
- New factual assertions and metrics retain their own confirmation basis instead of inheriting the original record's verification status.
- The same feedback saved twice creates one reusable update, and a conflicting correction is made explicit.

## Repository anchors

- Original intended behavior: `requests/job-application-queue.md`.
- Jobs generation and stage completion: `packages/cli/src/jobs/preparation.ts`.
- Current durable schemas: `packages/core/src/jobs/schemas.ts`.
- Candidate grounding rules: `packages/core/src/jobs/preparation.ts`.
- Manual Tailor proposal save/recheck pattern: `packages/cli/src/tailoring/orchestrator.ts`.
- Existing proposal review controls: `packages/ui/src/views/tailoring/steps/ProposalsStep.tsx`.
- Current job review and generic answer routing: `packages/ui/src/views/jobs/JobResumeReview.tsx` and `JobAnswers.tsx`.
