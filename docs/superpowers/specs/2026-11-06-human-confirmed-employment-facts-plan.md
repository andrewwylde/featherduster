# Human-confirmed employment facts

Status: implementation plan; no application changes made for this plan.

## Intended outcome

A user can confirm a formal job title once, retain that exact answer as human-provided factual support, and reuse it for the same employment in other tailored resumes. An accomplishment-ledger entry is not required. The UI makes the scope and source of the confirmation clear.

Example: “Yes, Senior Software Engineer was my formal title at Kong.” After choosing the Kong employment and confirming, the current claim resolves. A later application can reuse that fact for the same employment, even if its summary has changed. It cannot establish that the user held that title at Parable or support an unrelated component-library contribution.

## Findings in the current implementation

- `semantic-service.ts` constructs the source picker exclusively from captured evidence entries: title, summary, impact, and narrative. A ledger entry’s title is not an employment title.
- Job-only human confirmations already work without source quotations.
- `SharedClarificationSchema.sources` requires at least one ledger binding. `saveClarification` rejects project reuse without one, rolling back the local save too.
- Shared reuse currently matches work, model-generated predicate, qualifiers, exact confirmed claim text, and captured evidence bindings.
- Summary work identity hashes the entire summary. Experience work identity also incorporates mutable role information. Merely allowing an empty source list would not provide reliable employment-fact reuse.
- Corrections currently require source IDs and an effective date, including corrections to an earlier human answer. That contract needs a separate human-answer correction path.
- Progress, inline save errors, job-only fallback, and persisted confirmation feedback are already present. Preserve these behaviors.

## Product decisions

1. Treat an explicit human confirmation as its own support type. Label it **Confirmed by you**, with the exact answer and recorded date. Never label it independently verified or convert it into a fabricated ledger quotation.
2. Keep documentary evidence optional for human confirmation. Existing evidence-backed support still retains its exact quotations and fingerprints.
3. For a title question, show the company, employment period, and exact title being confirmed. If a summary claim has ambiguous employment context, ask the user to select the employment before making the fact reusable. Job-only confirmation remains available.
4. Offer **Remember for this employment** and **This job only**. Preserve an existing saved scope choice; do not silently promote job-only answers into shared knowledge. For new, unambiguously scoped employment facts, present employment reuse as the default and state it in the confirmation button.
5. Use **Supporting evidence (optional)** for documentary sources. Explain that the starting resume provides context and the user’s confirmation supplies human support; repeating a title in the resume is not independent verification.
6. Keep **Save answer, keep unresolved** distinct. An unconfirmed answer cannot resolve a claim or become reusable support.
7. Apply the support-type design to reusable factual answers generally, while introducing structured cross-application identity for employment titles first. Other work claims retain conservative matching; do not broaden them through fuzzy similarity.

## Implementation sequence

### 1. Version support and correction contracts

Primary files: `packages/core/src/corpus/schemas.ts`, `packages/core/src/jobs/semantic-evidence.ts`, `packages/core/src/jobs/semantic-transport.ts`.

- Add a versioned shared-clarification representation with explicit support basis: captured evidence, human confirmation, or both. Require at least one valid support basis, not merely an optional empty list.
- For human support, retain a server-issued clarification reference, actor, exact question and answer, confirmation time, original job/input/claim bindings, and revision. Generate provenance on the server; client/model output cannot assert that a user confirmed something.
- Preserve the existing strict reader for legacy source-backed records. Normalize legacy records in memory; do not rewrite historical data or silently change its support meaning.
- Distinguish correction targets: an earlier human answer versus a contradictory documentary assertion. Correcting a human answer references its exact record and prior text, without inventing source IDs. Keep documentary correction checks intact.
- Separate recorded time from an employment fact’s effective period. Correcting an erroneous answer does not require inventing the date of a promotion.
- Update request/response schemas and exported types together. Retain stale revision, input binding, and idempotency safeguards.

### 2. Give employment facts a stable scope

Primary files: `packages/core/src/jobs/evidence-discovery.ts`, semantic schemas/policy, corpus persistence and knowledge helpers.

- Persist an employment identity in the existing career corpus infrastructure. Bind it to the captured employment context and maintain references from job-specific inputs.
- Do not derive the identity from summary wording, bullet position, formal title, or a mutable end date. Match existing employment only when captured company/period context identifies it unambiguously; otherwise request a selection. Do not merge overlapping roles or repeated tenures automatically.
- Represent formal title as a structured predicate with a title value and employment scope. A changed title value is a possible correction, not a new unrelated employment identity.
- Bind generated title claims to this structured fact only when employer, period, title value, and qualifiers are compatible. A model may propose a mapping; it cannot bypass validation or the user's selection when ambiguous.
- Preserve exact claim/revision bindings for the current save. Reuse a structured title fact across new wording only for the matching title claim; do not resolve the rest of the summary or expand leadership/seniority claims.
- If an old job cannot be mapped safely, keep its existing behavior and request explicit scope selection when the user chooses to share an answer. No automatic historical regeneration.

### 3. Save and reuse human support atomically

Primary files: `packages/cli/src/jobs/semantic-service.ts`, `packages/cli/src/corpus/repository.ts`, `packages/cli/src/corpus/service.ts`, `packages/core/src/corpus/clarifications.ts`, `packages/core/src/jobs/semantic-policy.ts`.

- Permit explicitly confirmed shared answers with valid human provenance and no ledger quotation. Store the local clarification and shared knowledge revision in the existing transaction.
- Remove the source-required rejection only for this validated support path. Keep exact quotation validation for any documentary support supplied.
- Reuse human support without requiring an unrelated ledger source to be selected in the new job. Documentary-only support continues to require compatible source bindings.
- Make the support resolver return the active confirmation and its scope/provenance explicitly so UI, validation, and progress use the same persisted result.
- Ensure raw corpus update endpoints cannot bypass confirmation, ownership, scope, or conflict checks.
- Update semantic policy/checkpoint versions where resolution behavior changes. Old jobs remain readable; checks refresh through normal explicit review/preparation actions.
- Do not mutate the evidence ledger or turn writing preferences into factual support.

### 4. Handle conflicts, corrections, and affected drafts

Primary files: corpus clarification helpers, `packages/cli/src/jobs/clarification-updates.ts`, `SharedFactUpdates.tsx`.

- Compare the same employment and fact predicate before offering correction. Different employment, different fact, or different work remains independent.
- An identical fact/value can be reused. A conflicting title value presents the prior answer beside the proposed correction. Do not choose the newest answer automatically.
- A real promotion or distinct role period must be representable without overwriting an earlier valid title. Clarify effective scope when necessary.
- Preserve correction chains and withdrawal history. Detect affected drafts through saved fact references as well as legacy bindings, rather than relying solely on old summary hashes or exact old wording.
- Reuse the existing **Update selected** workflow, affected-bullet validation, and undo. Leave unrelated wording intact.
- Preserve approved PDFs as historical artifacts, flag known conflicts before reuse, and require fresh approval for changed PDFs.

### 5. Update the confirmation experience

Primary files: `JobFacts.tsx`, `ResumeDraftSurface.tsx`, `CorpusKnowledgePanel.tsx`, relevant API client types.

- Show a concrete question such as **Was Senior Software Engineer your formal title at Kong during [period]?**
- Display the scope before confirmation. Ask only the missing factual context; never ask users to retrieve internal evidence IDs.
- Replace the missing-quotation warning and job-only fallback for eligible human confirmations with the two scope choices above. A quotation remains optional.
- Confirm with one action, then show **Saved — confirmed by you for this employment**, update persisted progress, and show the next question or completed passage.
- In **Evidence**, distinguish **Your confirmation** from **Captured evidence**. Display the exact answer, scope, date, and correction/history controls. A confirmation can exist with zero ledger citations.
- Keep **Saving**, **Saved**, and **Checking** distinct. Preserve entered answers on failure, show actionable errors beside the button, and retain completion feedback across remounts/reloads.
- Reuse existing local-answer recovery keys. Do not discard the user's currently typed title answer or auto-submit it during upgrade.

### 6. Verify and document

Use synthetic workspaces for write tests; inspect the real title workflow read-only unless the user explicitly confirms in the updated UI. Run focused core, service, and UI tests, build all packages, and extend the existing browser walkthrough.

Required cases:

- No ledger title: explicitly confirm a title, save shared human support, resolve the claim, advance progress, and retain the answer after reload.
- New job, changed summary, same employment and title: reuse without asking again; confirm the ledger is byte-for-byte unchanged.
- Different employer, overlapping role, repeated tenure, ambiguous summary, different title, and unrelated library contribution: no accidental reuse or irrelevant correction prompt.
- A generic profile headline is not silently treated as an employer-specific formal title.
- Job-only and deferred answers never become shared confirmation automatically.
- Legacy source-backed records and old jobs still load; no automatic generation or approval.
- Documentary bindings still reject fabricated or stale quotations; model output alone cannot create human support.
- Identical retries produce one shared revision; stale saves fail clearly and retain input; shared-save failure does not report local success.
- Correct a source-free human answer without synthetic citations or an invented effective date. An unresolved conflict blocks shared reuse; a promotion preserves the old title's valid period.
- Corrections flag affected drafts and approved artifacts. Update selected changes only affected wording, supports undo, and requires new PDF approval.
- UI shows accurate saving/checking/completion state, persisted progress, and accessible controls on desktop and mobile.

Update `docs/accomplishment-review-walkthrough.md` with the exact title-confirmation scenario and cross-job reuse checks. Completion requires a demonstrated no-ledger title confirmation and reuse in a second job, not just a schema/unit-test change.

## Scope boundaries

No general document-upload system, employment-verification service, broad fuzzy matching of arbitrary claims, or conversion of all historical resume content into confirmed facts. Those are unnecessary to fix this flow. The current ledger, saved answers, unrelated layout work, and historical artifacts remain intact.
