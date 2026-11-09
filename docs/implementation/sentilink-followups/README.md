# SentiLink walkthrough implementation follow-ups

Created November 9, 2026, from the
[November 8 live walkthrough](../../sentilink-live-job-attempt-2026-11-08.md).
This packet contains eight bug reports and two feature specifications, with
synthetic reproductions, implementation boundaries, acceptance criteria, and
verification. It extends the
[NetBox backlog](../netbox-followups/README.md) without duplicating its existing
implementation tasks.

The updated app reached an unapproved, checked one-page PDF. This packet
addresses remaining correctness, recovery, review, and content-quality work.
It does not imply the entire attempt failed, or that improvements already
observed must be rebuilt. No application change is shipped by these documents.

## Reports, ownership, and dependencies

IDs use an SL prefix to distinguish them from the earlier packet. All local
Task Master references use tag `master`. Seven existing tasks receive follow-up
links; three new tasks cover distinct work. Task statuses remain pending.

| ID and document | Priority | Task Master | Ownership | Dependencies |
| --- | --- | --- | --- | --- |
| [SL-BUG-001: Exact semantic spans](bugs/sl-bug-001-semantic-spans.md) | P1 | 65 | New parsing defect; complements 52/54 | None |
| [SL-BUG-002: Skills-operation contract](bugs/sl-bug-002-skills-operation-contract.md) | P1 | 66 | New structured-operation guard | None |
| [SL-BUG-003: Inherited PDF changes](bugs/sl-bug-003-inherited-pdf-changes.md) | P1 | 57 | Remaining NetBox BUG-007 acceptance | Existing task 53 |
| [SL-BUG-004: Saved-draft recovery](bugs/sl-bug-004-saved-draft-recovery.md) | P1 | 63 | Existing mixed-save feature | SL-BUG-008; existing task 53 |
| [SL-BUG-005: Truthful progress](bugs/sl-bug-005-progress-truth.md) | P2 | 62 | Existing progress feature | SL-BUG-008 |
| [SL-BUG-006: Description compensation](bugs/sl-bug-006-description-compensation.md) | P2 | 61 | Existing posting-context feature | None |
| [SL-BUG-007: Refresh scope](bugs/sl-bug-007-refresh-scope.md) | P2 | 55 | Remaining NetBox BUG-005 acceptance | None |
| [SL-BUG-008: Unified review state](bugs/sl-bug-008-review-state.md) | P2 | 56 | Remaining NetBox BUG-006 acceptance | Existing tasks 52/53 |
| [SL-FEAT-001: Skills review/editing](features/sl-feat-001-skills-review.md) | P1 | 67 | New focused review capability | SL-BUG-002 and SL-BUG-004 |
| [SL-FEAT-002: Accomplishment quality](features/sl-feat-002-accomplishment-quality.md) | P2 | 64 | Existing selection/calibration feature | Existing task 54 and approved support policy |

Tasks 55 and 56 retain their earlier high tracker priority; their narrower
SentiLink observations are P2. Other priorities map P1 to high and P2 to medium.
No statuses, existing dependency edges, or prior implementation history are
replaced. The local tracker still reports pending even where implementation
commits exist; neither a commit nor a tracker label alone proves acceptance.

The [machine-readable manifest](backlog.json) records IDs, paths, task ownership,
priorities, and exact dependency mappings. Task Master data is gitignored, so
the versioned packet preserves this work independently of local tracker state.
No remote issues or external messages are created.

## Evidence and certainty

The tested server identity was
`167b05c925489ea5565f691bc86dc392707925bea497b5e94ad5c36d7f9ebbd6`,
using checkout `b96181e` plus retained uncommitted work. It identifies startup
CLI/core bytes; UI hashes were captured separately. This is historical evidence,
not a claim about whatever build is running during implementation.

Private receipts remain in `walkthrough-output/real-job-2026-11-08/`. Use the
synthetic cases in these documents for regressions; no task requires copying
career data into a public fixture or replaying the real job's mutations.

- Span whitespace failure and JSON-LD salary omission have deterministic
  synthetic reproductions. The live span diagnostic does not prove its exact
  raw-response cause was whitespace.
- Inverted skills pruning is a confirmed generated-operation mismatch; the
  application follows its documented remove-list semantics.
- Missing prominent correction cards and stale active progress have matching
  UI/payload/source evidence.
- Reload recovery is observed and source-supported, but the exact recovery-key
  race needs a captured timeline before selecting a final fix.
- Broad refresh traffic is measured. Its exact initiating paths and latency
  contribution require attribution; the 35-response window is not a benchmark.

The following paths were not exercised and are not reopened as proven failures:
shared fact confirmations/corrections, actual-correction discovery at scale,
ambiguous legacy aliases, consolidation undo, and restoration with overflow.
Their existing acceptance remains necessary where implementation touches them.

## Suggested implementation sequence

1. Fix SL-BUG-001 and SL-BUG-002 independently. Keep factual support, exact
   substring checks, and remove-list semantics intact.
2. Complete the existing shared-state work in Task 56 and recovery in Task 63.
   SL-BUG-003, SL-BUG-006, and attributed refresh investigation can proceed
   independently under their existing dependencies.
3. Finish progress projection after the review-state contract. Add skills review
   after validated operations and save/recovery work are ready.
4. Calibrate ranking and writing through Task 64's approved support policy.
   Content quality is judged separately from mechanical export success.
5. Run integrated browser/export scenarios and independent outcome acceptance.
   Do not activate a half-implemented generation contract or mark a task done
   solely because its unit tests or this packet exists.

## Shared implementation constraints

Reuse the approved
[draft-first design](../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md),
[implementation plan](../../superpowers/plans/2026-11-06-draft-first-tailoring.md),
and [human-facts plan](../../superpowers/specs/2026-11-06-human-confirmed-employment-facts-plan.md).
Task 45 owns employment-fact support. Ordinary wording changes neither create
human support nor save a writing preference. A user-supplied baseline fact and
an independently verified assertion must remain distinguishable.

Preserve immutable input snapshots, evidence ledgers, source bindings, original
targets, revisions, consent, configured runner, preparation/check budgets, and
historical PDFs/approvals. Affected claims are checked again; unrelated wording
and compatible support survive. New wording or list content requires fresh
artifact checks and final approval. Downloads and application tracking remain
separate. Never synthesize personal answers or real approval events in tests.

Version fresh runner schemas, prompts, proposal application, review transport,
and checkpoint/cache policy together where their contracts change. Read old
jobs without automatic regeneration or reinterpretation. Reconcile current
uncommitted work before modifying shared application files.

Follow [delivery acceptance](../../agents/delivery-acceptance.md) when executing
implementation through the factory. Prepare the concrete contract with named
outcomes and scenario commands before that work; obtain fresh browser receipts
and independent outcome review before implementation completion. These are
requirements for future delivery, not an approval request for writing docs.

## Integrated acceptance scenarios

| Scenario | Required evidence |
| --- | --- |
| Edge whitespace in claim and source quote | Exact spans parse consistently; support remains unresolved when evidence is absent; ambiguous/invalid spans still fail safely. |
| Skills remove/retain inversion | Inconsistent structured intent rejects; valid remove lists apply correctly; the visible diff matches the candidate, not the rationale. |
| One skills edit plus generated/inherited wording | One atomic revision, exact original targets, preserved unrelated wording, lost-response/idempotent retry safety. |
| Reload after acknowledgment while checking | Saved edits remain saved; newer typing survives; genuine second-tab conflicts still require reconciliation. |
| Two inherited corrections plus one generated rewrite | Default final Changes shows three distinct passages, original-before text, history, artifact-bound undo, and fresh approval after changes. |
| Active alignment then review failure/checking/ready | Persisted dispatch counts and operation identity match all surfaces; current retry excludes active checks; terminal time freezes. |
| Salary only in JSON-LD description | Explicit endpoints/period and safe currency provenance retained; no unrelated numbers, office cities, or second-job salaries adopted. |
| Operational writes versus genuine evidence edits | Attributed events avoid unrelated fetches, preserve current job progress, refresh relevant user inputs, and recover on reconnect. |
| Frontend-focused fullstack selection | Strong relevant proof is prominent and coherent; singular/qualifier boundaries preserved; omissions remain reviewable. |
| Current and legacy artifact review at desktop/390px | Usable controls, readable list diffs, no horizontal page overflow, actual one-page PDF and correct text; old artifacts stay historical. |

Regression tests use disposable workspaces and fake runners. For a final live
calibration, use existing consent and spending limits and record actual usage
or label it unknown. Validate the rendered page and extracted text; no
predictive ATS score is required or claimed. This packet does not claim future
checks have already passed.
