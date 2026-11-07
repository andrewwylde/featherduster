# Draft-first resume tailoring

Date: 2026-11-06
Status: Experience and technical design approved in conversation; written specification awaiting user review.
Tracking: Task 50. This document defines the design; application implementation has not started.

## Outcome

A user selects a posting, chooses **Tailor resume**, and receives a complete, job-relevant PDF to review. The application performs generation, factual checking, supported repairs, layout, and export without asking the user to operate those stages. The user approves the displayed PDF once.

The default is to produce the strongest complete draft supported by the starting resume, compatible saved confirmations, and relevant evidence. Uncertain additions are excluded or narrowed. Questions that could improve an already usable draft are optional and come after the draft is ready.

The starting resume and previously confirmed answers are facts supplied by the user. They are not independently verified evidence, but do not require ledger quotations or repeated confirmation. New claims and genuine conflicts still require resolution.

## Problem and observed failure

The current experience exposes several internal systems separately: factual questions, evidence mappings, proposal validation, wording checks, saving, and PDF continuation. A user can resolve every displayed fact and still encounter another set of blockers, with no clear route to a finished resume. Recent local observation showed 20 resolved facts alongside seven blocking wording/evidence findings. Additional labels and progress indicators have made individual states clearer without reducing the work required.

Other observed failures include unrelated answers being presented as corrections, retained answers looking like unanswered questions, a missing omission control, and a newer UI sending fields that an older server rejects. This design addresses the workflow and its contracts rather than adding another feedback layer.

## Decisions and alternatives

Three approaches were considered:

| Approach | Benefit | Cost |
| --- | --- | --- |
| Draft first, optional improvements afterward | Delivers a usable result with minimal interruption | Initial wording may be more conservative until optional details are supplied |
| Short interview before generation | Can discover stronger accomplishments before drafting | Delays the result and risks repeating familiar questions |
| Interactive tailoring editor | Gives immediate control over individual changes | Requires continuous attention and decisions |

The user approved the first approach, treating the starting resume and saved confirmations as the factual baseline. They declined browser mockups. The experience and technical design below were approved before writing this specification.

## Scope

This is one end-to-end tailoring change, delivered in dependent increments. It includes the factual support contract, blocking decisions, automatic repair and continuation, automatic saving, the PDF-centered review surface, and compatibility with existing saved work.

It incorporates the human-confirmation support needed by the earlier employment-facts plan: a job title can be supplied by the user without a ledger quotation, and a compatible saved confirmation can be reused. It does not introduce a general employment-verification service, document-upload system, broad fuzzy matching, or predictive ATS scoring.

The existing evidence ledger, corpus persistence, input snapshots, preparation budgets, runner configuration and consent, export checks, and historical artifacts remain the underlying infrastructure. Existing unrelated layout and review changes must be reconciled and preserved during implementation.

## User experience

### Start and preparation

**Tailor resume** keeps a consistent name wherever the action appears. The selected posting, resume, page budget, and existing knowledge define the captured inputs. Starting preparation expresses consent to the configured tailoring workflow, within existing runner consent and spending limits; it does not approve the resulting PDF.

During preparation, show one primary status with a short description of the current phase. Avoid invented percentage progress and multiple competing fact/check counters. Details can expose the internal stages, diagnostic messages, and usage for troubleshooting. A stopped or paused operation stays stopped or paused until the user resumes it.

### Ready to review

The main surface contains the current PDF, a short summary of meaningful changes, and **Approve resume**. Editing remains available without entering a separate mandatory fact-review sequence. The detailed resume editor, before/after changes, evidence, omitted accomplishments with restore controls, and preparation history are secondary surfaces.

Optional improvement prompts are grouped under **Improve this version**. Each explains the benefit of the missing information in ordinary language. They never request internal evidence IDs. Ignoring or dismissing them leaves the current supported PDF ready for approval. Completed answers remain in history rather than returning to the active question list.

### Edits, omission, and restoration

Wording edits save automatically. The editor shows a small saving/saved indicator and an inline failure with retry when necessary. A typing burst is coalesced into a save; edits made while a request is in flight are retained as a newer local revision. Navigation and reload retain local recovery data until the exact revision is acknowledged by the server. Browser-held text is not represented as server-saved content.

Confirmed factual answers still require an explicit confirmation action. Automatically saving a typed answer does not confirm it or share it across jobs.

After a content change saves, the application reruns only affected checks and produces a new PDF automatically. While the PDF is being updated, the previous PDF is clearly identified as an earlier version and cannot be approved as though it contained unsaved or newly saved changes.

**Leave out of this draft** removes the entire selected accomplishment and its questions from this job's output, including the source bullets of a consolidation. It does not delete shared career evidence. Phrase-only removal remains an ordinary wording edit. Changes supports atomic restoration and preserves unrelated edits.

Restoration first attempts supported tightening within the existing page budget and readability rules. If content still does not fit, show a concrete replacement choice with the relevant accomplishments. Do not shrink text below the template's accepted readability limits, discard unique content without recording it, or silently increase the page budget.

### Necessary interruption

An interruption is justified only when the application cannot produce an accurate, usable result through supported repair, fallback, or selection, or when a technical failure prevents completion.

A necessary factual question names the precise conflicting or missing fact and why it matters. Present one active question at a time with appropriate choices, including omission when that can resolve the problem. Do not ask the user to investigate validator terminology or affirm an entire passage to resolve one qualifier.

A technical failure presents one recovery action and preserves the latest draft and answers. It must not become a factual question. Missing required input uses an input-correction action, not a generic claim-confirmation form.

## Factual support contract

Support must preserve its origin:

| Support basis | Meaning | Reuse boundary |
| --- | --- | --- |
| Starting-resume assertion | The user supplied this statement in the captured resume | The same underlying employment/work and compatible claim |
| Explicit human confirmation | The user confirmed an exact fact, with recorded scope and provenance | The confirmed fact and compatible qualifiers within the chosen scope |
| Captured documentary evidence | A claim is supported by a source-bound excerpt | Matching work, compatible claim, valid source revision |

These are distinct support types. The application must never relabel a user assertion as independent verification or create a fabricated ledger entry for it.

Preserving or faithfully paraphrasing a baseline statement preserves its support. Rearranging a bullet or changing its wording does not erase the fact's identity. Added ownership, seniority, scope, metrics, outcomes, causation, or relationships between activities require their own support. Consolidation must not invent a common workflow merely because activities occurred at the same employer.

A summary can restate compatible baseline facts. Combining metrics, calculating a new experience total, or broadening a title into a new leadership claim is a derived claim and must be supported separately. Reusing a title cannot establish the rest of a summary.

Support uses stable employment/work identity, claim identity, qualifiers, source revisions where relevant, and input provenance. Bullet positions, the whole summary hash, or mutable wording must not be the sole basis of reusable identity. Ambiguous cross-job identity is not merged automatically. A job-only answer remains job-only unless the user explicitly chooses broader reuse.

A missing ledger quotation is not a conflict with a user-supplied fact. A genuine conflict requires incompatible assertions about the same work, predicate, and effective scope. Show the competing assertions when a decision is necessary. A promotion or separate employment period must not overwrite a valid historical title. Corrections preserve exact answers, history, and correction relationships.

Known corrections flag affected drafts and historical artifacts. Reuse the existing selective-update workflow: rewrite affected claims only, preserve unrelated wording, expose changes and undo, and require new approval for any changed PDF. Ordinary writing preferences remain separate from factual support.

## Architecture and responsibilities

The implementation should extract focused units from the existing services and large review components as needed. It should not introduce a parallel preparation engine.

| Unit | Responsibility and interface | Dependencies |
| --- | --- | --- |
| Support resolver | Given captured inputs, current wording, and saved knowledge, return claim-level support, provenance, unresolved additions, and conflicts | Core support contracts, corpus records, source bindings |
| Completion policy | Given support results, structural/privacy/layout/export findings, and operation state, return one persisted completion decision and any required action | Versioned policy; no model calls or UI state |
| Preparation coordinator | Advance generation, repair, validation, and rendering; persist checkpoints and reserve work budgets | Existing job repository, runner, support resolver, completion policy, renderer |
| Draft persistence | Save revision-bound edits, exclusions, answers, and optional-question dispositions; recover retries without duplication | Existing repository, idempotency receipts, browser recovery storage |
| Review projection | Provide the current artifact, completion state, change summary, optional improvements, and contextual actions | Persisted results for the same draft revision |
| Review interface | Render that projection and submit user actions; retain unsaved edits | API client and focused editor/review components |

The main integration points are core proposal/semantic schemas and validators; CLI semantic, proposal, corpus, and preparation services; and the job detail, proposal review, fact editor, and artifact review UI. Existing generation policy, runner schemas, review responses, and checkpoint versions change together.

## Unified completion policy

The policy returns one result bound to the current input, draft revision, support revision, and policy version. It must distinguish unresolved factual content, repairable content, optional enrichment, structural/export failures, and technical failures. Internal validators can keep detailed findings, but cannot independently demand redundant user confirmation after the resolver has supplied compatible support.

| Main state | Required meaning | Primary action |
| --- | --- | --- |
| Preparing | A bounded operation is actually running or queued for the current revision | Wait; stop remains available |
| Ready to review | The current draft passed required checks and has a matching verified PDF | Approve resume |
| Needs your answer | A specific factual, required-input, or content-fit decision prevents a usable supported result | Resolve the displayed decision |
| Needs retry | Technical failure or exhausted automatic recovery prevents completion | Retry or correct the identified technical/input problem |
| Approved | Explicit approval binds the current PDF and visible change summary | Existing download/application actions remain separate |

Before preparation, show **Tailor resume**. User-requested pause/stop is represented as a suspension with **Resume preparation**, not as a factual blocker or an operation still progressing. Local unsaved edits are an editor status that disables current-version approval, not a second completion system.

Absence of errors does not prove readiness. Persisted success and artifact/revision matching are required. Conversely, optional unanswered questions and the absence of ledger quotations for supported baseline facts cannot block readiness.

Privacy, required fields, factual contradictions, malformed references, render failures, and page-budget/readability failures are not waived by the baseline policy. Missing factual coverage in newly generated content is not treated as successful validation merely because all extracted questions were answered.

## Preparation and automatic repair

1. Capture the posting, starting resume, knowledge, policy, page budget, and configured runner consent.
2. Generate a coherent job-specific draft. Select related evidence into accomplishments with contribution, meaningful scope, and supported outcome or purpose. Keep useful technical detail and avoid commit-log phrasing.
3. Resolve support for retained and generated claims. Validate only genuinely new semantics as new factual assertions; keep structural, privacy, and export checks for the whole artifact.
4. Repair unsupported generated content within the captured budget: narrow the unsupported addition, use a supported paraphrase, revert to the supported original, or exclude an uncertain addition. Revalidate each affected result.
5. Record material rewrites and omissions for review. Relevance/page-budget omissions remain restorable. User exclusions are not silently reintroduced. Protect explicit user edits from automatic replacement; when an edit creates a real conflict, present a supported alternative and a clear decision instead of overwriting it.
6. Run layout and verified PDF export, then publish Ready to review with the exact artifact binding.
7. Generate only relevant optional enrichment prompts for the supported draft. This step cannot delay readiness or approval, and must remain within budget. If its budget is unavailable or prompt generation fails, skip the suggestions and retain Ready to review. Omitted or dismissed work must not keep producing prompts.

Repair is semantic and source-bound; it is not limited to a few string substitutions. The model can propose a narrower rewrite but cannot declare it supported, confirm facts for the user, or approve the PDF. Repeated equivalent repair attempts stop. Falling back to the supported original retains a useful accomplishment when possible, rather than unnecessarily removing it.

Use captured `max_model_calls`, `max_repair_attempts`, `model_retry_count`, and `timeout_ms`. Every dispatch reserves work through the existing operation receipts. Do not increase limits or renew budgets silently. Distinguish an unsupported addition, which may be removed, from an unavailable checker, which cannot be interpreted as proof that the addition is false or supported. A fallback can proceed only when its required support and export checks can actually complete.

## Persistence, recovery, and compatibility

All accepted edits, exclusions, question dispositions, completion decisions, and artifact bindings are job-specific persisted records. The evidence ledger remains unchanged. Shared answers and preferences continue to use the corpus persistence infrastructure with distinct types and explicit scope.

Writes retain optimistic revision checks, original-target bindings, and idempotency. A late response cannot replace newer local text. On a lost response, reread the persisted result before deciding whether to retry. On a real revision conflict, preserve both versions and request a focused reconciliation; do not discard local changes or label them saved.

Reloading a page does not restart generation, spend another model call, reconfirm a fact, or reinstate an excluded accomplishment. Resume interrupted operations from durable checkpoints. An explicit retry can dispatch new work only within the governing budget and ownership rules.

Old jobs and proposals remain readable without automatic regeneration. Opening a saved job projects existing results but does not silently apply a new policy or approve anything. An explicit tailoring/resume action can create a new policy-bound revision while retaining saved answers, edits, exclusions, and prior artifacts. If a legacy result cannot safely map to the new support model, preserve it as history and re-evaluate the affected current content through that action.

The API must expose review-contract/policy compatibility. If the browser has a newer action than the running server supports, retain local edits and explain that the application needs an update/restart. Do not expose only **Invalid request** or accept an unsupported write shape. Deployment verification includes both UI assets and the live backend contract.

## Delivery sequence

Each increment must preserve the existing runnable workflow. This sequence defines dependencies; the subsequent implementation plan will specify concrete changes and checks.

1. **Support and completion contracts:** introduce explicit baseline/human/documentary support; compatible stable identities; one persisted completion decision; versioned transport and policy. Incorporate the needed source-free human-confirmation work from the employment-facts plan.
2. **Automatic preparation:** integrate support resolution and bounded repair into the existing coordinator; implement supported fallback and automatic PDF continuation; retain material change records and exclusions.
3. **Review and saving:** build the PDF-centered projection and UI; automatic wording saves; optional improvements; one interruption/recovery surface; remove redundant mandatory per-fact/check controls from the normal flow.
4. **Compatibility and acceptance:** verify saved-job adaptation, current browser/backend compatibility, crash/reload recovery, historical approval, and the real posting-to-PDF workflow. Update the walkthrough with the shorter expected path.

## Verification and acceptance

The primary acceptance scenario is a supported starting resume plus a posting producing a complete tailored PDF with **zero mandatory factual questions, zero manual save/check/continue steps, and one final approval**. This applies when no essential factual contradiction or technical failure prevents completion. The app must not manufacture certainty to satisfy that target.

Required checks:

- An existing formal title, accomplishment, technology, or baseline metric survives faithful tailoring without requiring a ledger citation or confirmation.
- A paraphrase preserves support; added ownership, inflated impact, a derived metric, and an invented relationship do not inherit support from nearby facts.
- Supported additions absent from the starting resume can be included. Unsupported enrichment is narrowed, reverted, or omitted while the supported draft completes.
- Confirmed answers are not repeated after reload, compatible rewrites, or compatible cross-job reuse. Different employment, periods, qualifiers, or unrelated claims do not inherit them.
- Human confirmation works without a ledger quotation; project scope is explicit; corrections display the actual prior fact and preserve history.
- All factual answers resolved plus an internally repairable wording check leads to automatic repair or supported fallback, not a new user-operated validation phase.
- Zero extracted questions, missing checker output, or a technical timeout cannot masquerade as successful factual validation.
- Optional improvements can be ignored or dismissed without blocking approval. Answering one updates only relevant content and produces a new reviewable PDF.
- Original bullets, rewrites, additions, and consolidations can be omitted and atomically restored. Their questions disappear when omitted, and exclusions survive retry/regeneration.
- Automatic saves survive typing during in-flight requests, navigation, reload, lost responses, duplicate retries, and revision conflicts without losing newer edits or falsely reporting success.
- A stopped process remains stopped. Interrupted preparation recovers durable work and respects existing budgets and consent. Budget exhaustion and rendering failure expose one appropriate recovery action.
- Page overflow attempts supported tightening, then presents a specific replacement decision if required. PDF text extraction, page count, formatting, and readability checks still pass.
- An edited or regenerated artifact cannot reuse an earlier approval. Historical PDFs remain intact and known factual conflicts are flagged before reuse.
- Legacy jobs load without silent regeneration. An explicit new-policy preparation retains applicable answers, exclusions, and unrelated wording.
- A UI/backend version mismatch explains recovery and retains edits before attempting incompatible saves.
- Keyboard and mobile users can reach the primary action, editor, optional improvements, and necessary question without navigating several independent status panels.

Use focused core, service, UI, and browser tests in disposable workspaces for writes. Use the configured runner and existing consent for the real-evidence acceptance run, within captured budgets. Inspect real user data read-only unless the user explicitly starts tailoring or editing. Do not approve a real artifact on the user's behalf.

Assess the actual resume for relevance to the posting, coherent accomplishments, meaningful scope, technical specificity, factual fidelity, and readable layout. Passing schemas and internal checks alone is insufficient. ATS suitability means truthful terminology and readable structure, not a predicted score.

## Review boundary

The user has approved the conversational experience and technical design. The next checkpoint is review of this written specification. After approval, create the detailed implementation plan using the writing-plans skill. Do not begin application implementation as part of this design task.
