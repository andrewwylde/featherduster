# Semantic evidence validation and factual review

Date: 2026-10-19
Status: Written specification approved by the user on 2026-10-20. Implementation plan: `docs/superpowers/plans/2026-10-20-semantic-evidence-review.md`.
Planning task: Taskmaster 30.

## Outcome

Recognize experience from what captured evidence establishes, rather than requiring matching vocabulary. Automatically support clear claims, ask focused questions about ambiguous facts, and make saving, resolving findings, and continuing preparation visibly distinct. Apply this behavior to generated proposals, inherited resume wording, and manual job-draft edits.

All new clarifications and support decisions remain scoped to this job. No reusable resume or workspace-wide knowledge is created automatically.

## Problem and current boundaries

`packages/core/src/jobs/preparation.ts` deliberately removes machine alignment authority and checks candidate terms against cited evidence or existing source-bound SkillSupport. Literal checks can reject backend work described as server-side APIs, and production work described as deployed services used by customers.

`packages/core/src/jobs/candidate-checks.ts` checks final summary and bullet text, including inherited text. Summary citations currently depend on summary-rewrite proposals. `packages/core/src/jobs/proposal-review.ts` assigns candidate findings the refresh_base action even when evidence resolution is the appropriate response. `packages/cli/src/jobs/proposal-service.ts` binds human groundings to proposal IDs and exact proposal text; inherited fields have no equivalent resolution mechanism.

These boundaries explain both false negatives and repeated Edit starting wording prompts. Improving labels alone is insufficient. The new semantic authority must be explicit and separately attributed; machine results must never masquerade as human confirmation.

Earlier UX and citation-metadata fixes are present as uncommitted workspace changes. Preserve them when implementing this plan, inspect their tests, and do not assume the running server contains the rebuilt validator. Task 28's backend rollout was previously blocked. Existing job data must not be rewritten or regenerated as part of deployment or testing.

## Approved decisions

1. Clear semantic support passes automatically with an inspectable supporting passage.
2. Search all evidence captured for the job, automatically attach clear supporting citations, and show additions. Newly added library evidence requires explicit input refresh.
3. Ambiguity prompts a specific factual question. The answer is a job-local human clarification, distinct from documentary evidence.
4. Reuse an answer across equivalent claims about the same work. Do not generalize to unrelated projects or stronger claims.
5. Apply the same support standard to inherited and generated wording. Prefer evidence matching and factual clarification over rewriting.
6. Use the configured runner and existing data-sharing permissions. Hosted CLEF and JEV are not dependencies of this change.
7. Classify during preparation, cache results, and reactively check changed claims. Saving never depends on classification success.
8. Organize review around unresolved facts grouped by work, rather than a sequence of every proposed edit.
9. During classifier outages, allow explicit manual factual review. Do not provide a blanket bypass of independent checks.
10. Allow dated job-local corrections to older contradictory evidence. Preserve both records and explain the human basis for resolution.
11. Make one bounded classification pass per batch. No automatic retry loops or escalation to a more expensive model.

## Chosen approach

Use dictionary-assisted discovery plus evidence-bound classification. A small versioned terminology map improves retrieval; it does not prove claims. A model evaluates the actual claim and retrieved passages. Deterministic validation checks its structure, source bindings, quotations, and coverage before accepting semantic support.

A dictionary-only solution cannot reliably distinguish consuming an API from implementing an API. A model-only solution needlessly repeats discovery work and makes source scope and caching harder to inspect. The hybrid approach reuses existing source fingerprints and evidence infrastructure while introducing explicit semantic provenance.

## Responsibilities and data contracts

### Claim inventory

Inventory substantive assertions in summary and experience bullet fields, whether inherited, generated, or manually edited. Keep existing structural checks on all other resume fields; do not remove existing coverage for skills, dates, metrics, or privacy.

Each passage has an exact text fingerprint and a subject reference: job ID, input snapshot, review/draft identity, and field/proposal location. Each claim identifies its original text span, normalized predicate, work identity, and qualifiers. Distinguish backend implementation, production deployment, technology use, ownership, scale, and measurable outcomes. Supporting one does not support the others.

Work identity must be anchored to captured employer/project/source information. Do not group solely on a similar job title or the word API. If identity is uncertain, ask which work the claim describes before reusing a clarification. Resolve location changes through stable subject identity and content bindings, not array index alone.

Extraction and semantic evaluation share the same bounded runner request. The response must account for every submitted passage and identify unsupported or uncertain assertions as well as supported ones. Missing passage results, invalid spans, or incomplete responses remain unchecked; they cannot become a passing empty result.

### Evidence discovery

Build a local index over the entire captured evidence set. Search original wording, terminology-map expansions, existing scoped support, and work identity. A terminology mapping may increase a source's retrieval rank but cannot grant support.

Send bounded relevant excerpts to the configured runner. Include source identity, fingerprint, confidence/status, work context, and enough surrounding text to preserve negation and deployment qualifiers. Exclude retracted sources from supporting matches. Never silently claim a search was exhaustive when retrieval or request bounds omitted evidence. If retrieved evidence does not establish support, use needs clarification rather than asserting that the user lacks the experience.

Automatically attached citations remain explicit records. Bullet citation bindings and a new field-level support binding for summaries/inherited fields must be available to every validator and exporter; summaries must not require a synthetic rewrite proposal just to cite evidence. Preserve original citation history. Do not silently remove a valid manually selected citation.

### Semantic support records

Persist versioned records containing claim and passage fingerprints, work identity, input fingerprint, source IDs/fingerprints, exact quoted spans, classification, rationale, runner/model identity, prompt/taxonomy/policy versions, and recorded time.

Classifications are supported, needs clarification, contradicted, and unavailable. Checking and unchecked are execution states, not conclusions about experience. Unsupported wording without affirmative contrary evidence belongs in needs clarification; the explanation must describe what the evidence fails to establish.

Supported requires a well-formed response, exact source/quotation bindings, no unresolved contradictory supplied evidence, and support for the actual qualifiers. A model's self-reported confidence alone is insufficient. Automatic decisions use model provenance. Existing human SkillSupport remains human provenance. Use a dedicated semantic validation interface rather than forging candidate_confirmed or human grounding fields.

### Human clarification and correction

Store the question, factual assertion, work identity, applicable claim predicates/qualifiers, actor, time, job scope, and source references. Each saved answer is immutable and superseded through a new revision when corrected. Record the original answer; do not make its scope broader through paraphrasing.

For example, confirming that an API served real customers may resolve production-deployment claims about that API. It does not establish traffic scale, reliability, ownership, or a technology. Reuse requires matching work and a compatible claim scope. Ambiguous reuse asks for a decision rather than silently spreading approval.

Questions should allow explicit factual answers, uncertainty, and rejection of the proposed claim. A manual-review fallback exposes the exact claims and known evidence so the user can affirm the specific fact even when the classifier is unavailable. Human provenance can resolve semantic ambiguity without a subsequent model call. It does not satisfy separate numeric verification or eliminate invalid/retracted citations.

Contradiction resolution requires a distinct correction action recording what changed, when, and which older assertion it corrects. Both source and correction remain visible. Deterministic scope/completeness checks allow the user to explicitly resolve the matching contradiction; other conflicting claims remain open. Never treat a generic yes as a correction to contradictory evidence.

### Cache and revision binding

Cache semantic results by exact passage/claim content, work identity, captured evidence-set fingerprint, selected bindings, relevant clarification revisions, and classifier/prompt/taxonomy/policy versions. A changed source status, new input snapshot, changed claim qualifier, or superseded clarification invalidates affected results. Moving an otherwise identical passage does not expand its authority.

Editing a claim immediately removes its passing state. Debounce subsequent checks by the existing 600 ms draft-check interval. Coalesce superseded work and reject stale responses, including A-B-A edits. At most one classification batch per job is in flight. Unrelated claims retain valid results.

Finalization binds the exact candidate, current support records and clarification revisions, captured inputs, and independent checks. It cannot reuse a pass from a different revision. Saving persists edits regardless of pending/blocked/unavailable classification.

## Execution limits and failure behavior

Use the runner and consent captured/configured through the existing job workflow. Do not add providers, credentials, automatic consent, or hidden remote calls. Source content is untrusted input to classification, never an instruction to tools or the application.

Initial engineering defaults: at most 8 passages per batch, 48,000 input characters including evidence, 16,000 response characters, and a timeout capped at the lower of 60 seconds and the configured runner step timeout. Excerpts are bounded before dispatch; incomplete or oversized output is unavailable. These are implementation defaults, not claims about a provider's context capacity.

Allow at most 4 automatic classification calls per preparation attempt. Explicit editing produces a new evaluation cycle for changed passages; one call per batch still applies. Every dispatched call, including failed calls, is recorded in job usage. Keep classification usage separate from generation's existing call allowance and include both in displayed totals. Exhaustion offers manual review or an explicit additional check; no silent automatic continuation beyond the cap. Existing overall budget or cancellation constraints take precedence.

No automatic retry on timeout, invalid output, or unavailable runner. Retry is an explicit action. Coalesce superseded editing requests rather than paying for every keystroke. Never launch model calls from ordinary read endpoints or polling. Reopening a review reads persisted state without reclassification unless the user edits or explicitly requests a check.

If classification is unavailable, retain the draft and any unchanged valid results. Offer Retry and Review facts manually. Surface the concrete execution reason without mislabeling the claim unsupported. Stop/cancellation fences late results; an old response cannot mark new content ready.

## Review experience

The resume remains the primary view. Pending factual decisions get a prominent Review facts action from the job status and worker review list. Existing proposal-review URLs continue to work and open the new fact-oriented review.

The main panel contains one unresolved factual question, the work it concerns, supporting/conflicting passages, and affected resume wording. Group related passages only when the same fact actually resolves them. Show the remaining fact-group count separately from the number of affected passages.

Offer context-appropriate actions: confirm/clarify a fact, use other captured evidence, revise wording, record a dated correction, and exclude a generated change. Exclusion keeps original wording, which remains subject to the same checks. Inherited claims do not receive an exclude-generated-change action. Edit starting wording appears only after the user chooses to revise an inherited claim.

Automatically supported claims are collapsed under Supported automatically, with citations, reasoning, and model provenance available for inspection. Human-supported claims identify the clarification used. Required privacy/metric/format corrections remain visible but separate from semantic questions.

Save outcomes appear beside the action and in an accessible live status:

- Saved · resolved: advance to and focus the next unresolved fact; preserve a short acknowledgment of the resolved group.
- Saved · still needs review: stay and state the remaining finding and its relevant evidence.
- Saved · checking unavailable: retain changes and offer Retry or manual factual review.
- Save failed: retain local changes and explain storage/network/revision failure. Do not imply persistence.

When all required findings are resolved, show Continue preparation prominently. Saving does not start generation. On successful PDF generation, return to the current resume preview; if the user has navigated away, present a ready action rather than hijacking navigation. Manual draft finalization retains its existing Finalize resume path and exact-revision checks.

Refresh inputs, diagnostics, history, and optional reusable-knowledge actions stay secondary. No reusable memory is created by confirming a fact in this flow. Keyboard focus, mobile layout, empty states, and status announcements are part of acceptance.

## Migration and integration

Introduce additive, versioned support and clarification records. Preserve old review/draft/artifact history and existing human groundings. Old reviews with no semantic record read as unchecked where semantic resolution is needed, not retroactively supported. Offer an explicit Check evidence action; opening historical records must not mutate them or incur inference.

Integrate the shared support resolver into candidate proposal checks, inherited-field checks, reactive draft checks, preparation continuation, and finalization/export freshness. Retain independent privacy scanning of published content and deterministic metric/citation checks. Citation IDs are metadata, not editable published wording.

Refactor only the touched review orchestration: separate fact grouping, save-result transitions, and presentation from the large JobProposalReview component. Keep runner transport, persistence, pure support policy, and UI state in distinct modules. Reuse existing optimistic revisions, idempotency, and worker cancellation patterns.

## Acceptance and evaluation

Create a checked-in synthetic evaluation set with expected support decisions and supporting spans, not private career data. Include positive, ambiguous, contradictory, and adversarial examples:

1. Implemented server-side handlers and database queries supports backend implementation; merely consuming an API does not.
2. Deployment used by real customers supports production; an internal prototype or planned launch does not.
3. Production in an unrelated context does not establish software deployment.
4. One technology or ownership qualifier cannot be inferred from generic backend support.
5. Relevant evidence outside current citations can supply a new valid citation, including for inherited summaries.
6. Same-work clarification resolves equivalent claims; different work, stronger qualifiers, or changed source status does not inherit it.
7. Dated correction preserves and explicitly resolves the identified older contradiction without erasing history.
8. Outage, timeout, cap exhaustion, invalid schema, invented source IDs, false quotes, partial results, and cancellation cannot produce a pass.
9. Human manual review works without a model; privacy, metric, and citation-validity failures remain enforced.
10. Changed claims invalidate support; unrelated edits and safe relocations retain it. Late A-B-A results cannot win.
11. Saving a resolved fact advances and focuses; still-blocked saves retain context and explain why; failures retain unsaved input.
12. Existing and new support are enforced consistently during generation, manual edits, continuation, and finalization. Internal citation IDs never appear as wording tasks.

Unit and service tests use deterministic fake runner responses. Separately run the synthetic evaluation through the configured candidate runner before enabling automatic support for that runner/model/prompt version. The release gate is zero false supported decisions on negative/contradictory cases, valid source quotations for every automatic pass, and correct support for all designated clear-positive cases. Report ambiguous cases separately. This finite gate does not establish universal accuracy; retain provenance and reviewability.

If the runner/prompt fails the gate or has not been evaluated, semantic suggestions require manual confirmation; do not silently downgrade the product's required behavior to dictionary matching. A configured runner change preserves availability of manual review and requires evaluation before granting that configuration automatic-clear authority. CLEF may be compared on the same fixtures later. JEV requires an identified integration before any provider-specific plan.

## Scope exclusions

No global career ontology, reusable-resume promotion, automatic workspace memory, new model provider integration, external evidence search, automatic rewriting of user claims, or broad UI redesign. Do not start a real preparation run or edit the user's career evidence as part of acceptance testing. Use disposable workspaces for mutation and PDF-flow tests.

## Delivery sequence

Write the implementation plan after written-spec approval. Sequence work as domain records and policy; bounded discovery/classification; persisted cache and clarifications; shared validation integration; fact-oriented UI; migration and end-to-end evaluation. Each stage must have independent tests, with one integrated rollout only after semantic authority and finalization bindings agree.
