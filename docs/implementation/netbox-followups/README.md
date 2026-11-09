# NetBox walkthrough implementation backlog

Created November 8, 2026, from the
[November 7 live job attempt](../../netbox-live-job-attempt-2026-11-07.md).
This packet contains ten bug reports and five feature specifications. Each names
its evidence, implementation boundaries, acceptance criteria, and verification.
It prepares work for implementation; it does not claim those changes have
shipped.

For subsequent real-workflow verification, see the
[November 8 SentiLink walkthrough](../../sentilink-live-job-attempt-2026-11-08.md).
It distinguishes observed improvements, remaining failures, and paths not
exercised by that attempt. Status descriptions below record the original
backlog; use that follow-up when assessing implementation acceptance.
Its remaining implementation work is specified in the
[SentiLink follow-up packet](../sentilink-followups/README.md), which reuses
seven existing tasks and adds three distinct tasks.

The real attempt ultimately produced a one-page unapproved PDF. The problems are
about reliability, factual review, selection, and transparency, rather than a
claim that export never succeeded. Private screenshots, responses, database
backup, and video remain under the ignored walkthrough-output directory. The
reports include enough synthetic reproduction detail to work without that data.

## Status and existing decisions

- **BUG-001 is partially mitigated.** The no-correction fast path and
  regression assertion already exist in the dirty working tree. Preserve them.
  Remaining work concerns bounded discovery and measurement with actual
  corrections.
- **FEAT-005 reuses Task 45.** It links the existing employment-facts plan; it
  is not another independent implementation of human support.
- **Task 50 completed design work.** The approved
  [draft-first specification](../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md)
  and
  [implementation plan](../../superpowers/plans/2026-11-06-draft-first-tailoring.md)
  explicitly describe application implementation still to do. Their support,
  automatic saving, fallback, and single final approval decisions control the
  overlapping features in this packet. Do not build a competing review pipeline.
- Other reports remain open or proposed. Historical observations are
  distinguished from confirmed source defects and hypotheses requiring
  reproduction.

## Reports and tracker mapping

| Report | Priority | Status | Task Master | Depends on |
| --- | --- | --- | --- | --- |
| [BUG-001: Bound shared-correction discovery for saved jobs](bugs/bug-001-correction-discovery.md) | P1 | Mitigated; follow-up open | 51 | None |
| [BUG-002: Recover failed classification batches with actionable diagnostics](bugs/bug-002-classification-recovery.md) | P1 | Open | 52 | None |
| [BUG-003: Bind review findings to exact displayed wording and revision](bugs/bug-003-validation-wording.md) | P1 | Open | 53 | None |
| [BUG-004: Generate complete claim bindings and identify uncovered spans](bugs/bug-004-claim-binding-coverage.md) | P1 | Open | 54 | None |
| [BUG-005: Coalesce and scope workspace live refreshes](bugs/bug-005-live-refresh-storm.md) | P1 | Open | 55 | None |
| [BUG-006: Unify review counts and next actions under current persisted state](bugs/bug-006-review-state.md) | P1 | Open | 56 | BUG-002, BUG-003 |
| [BUG-007: Include inherited wording corrections in final PDF change summaries](bugs/bug-007-final-correction-history.md) | P1 | Open | 57 | BUG-003 |
| [BUG-008: Display resolved and captured starting resume selections](bugs/bug-008-captured-resume-selection.md) | P2 | Open | 59 | BUG-009 |
| [BUG-009: Give resume variants unique identities and searchable choices](bugs/bug-009-resume-identities.md) | P2 | Open | 58 | None |
| [BUG-010: Distinguish unknown workspace audit state and job-local blockers](bugs/bug-010-workspace-audit-state.md) | P2 | Open | 60 | None |
| [FEAT-001: Retain structured posting context and provenance](features/feat-001-posting-context.md) | P2 | Proposed | 61 | None |
| [FEAT-002: Expose preparation phase elapsed time and recorded usage](features/feat-002-preparation-progress.md) | P2 | Proposed | 62 | BUG-006 |
| [FEAT-003: Save mixed wording edits atomically before checking](features/feat-003-mixed-edit-saving.md) | P1 | Proposed | 63 | BUG-003, BUG-006 |
| [FEAT-004: Prioritize supported accomplishments and narrow unsupported scope](features/feat-004-accomplishment-selection.md) | P2 | Proposed | 64 | BUG-004 |
| [FEAT-005: Reuse scoped human employment facts](features/feat-005-employment-facts.md) | P1 | Existing; pending | 45 | None |

The [machine-readable backlog](backlog.json) contains the same IDs, local Task
Master mapping, priorities, statuses, and dependency edges. Canonical triage is
`ready-for-agent`; application implementation and independent acceptance remain
pending. Local Task Master files are gitignored, so the versioned docs/manifest
also preserve the portable work description. No remote issues were published.

Use `task-master show <id>` to inspect a task. Task Master priorities map P1 to
high and P2 to medium. BUG-001 records its historical P0 outage separately from
the mitigated follow-up's current P1 priority. No task is marked done merely
because this packet or a design document exists.

## Suggested implementation order

1. **Make failures understandable and safely recoverable.** BUG-002, BUG-003,
   and BUG-004 can start independently. Then implement BUG-006's common review
   projection and BUG-007's complete final change summary.
2. **Remove avoidable runtime and selection cost.** BUG-001, BUG-005, BUG-009,
   and BUG-010 are independent entry points. BUG-008 follows BUG-009 so capture
   metadata is based on unique file identities.
3. **Build on those contracts.** FEAT-003 adds mixed-edit saving after BUG-003
   and BUG-006. FEAT-002 exposes phases/usage using BUG-006's state projection.
   FEAT-001 adds posting context independently. FEAT-004 follows BUG-004 and
   integrates with the approved support/fallback policy. FEAT-005 remains the
   existing employment-support workstream under Task 45.
4. **Verify the integrated experience.** Run the scenarios below using the
   completed slices and the approved draft-first integration gate. Do not
   activate a partially implemented new policy merely because an isolated ticket
   passes.

Hard dependency edges are listed in the manifest and tracker. Coordination links
in individual documents are not additional blocking dependencies. In particular,
batch saving and final correction display coordinate without creating a cycle.
The broader approved draft-first foundation is an integration prerequisite, not
silently declared complete by these dependency edges.

## Shared implementation requirements

Preserve the evidence ledger, shared master resume, existing uncommitted work,
runner configuration/consent, preparation budgets, and privacy protections.
Implementation tests write to disposable workspaces. Never submit real factual
answers, promote wording edits to human confirmation, approve real PDFs, or
submit applications as test shortcuts.

Existing saved jobs, proposals, input snapshots, and approved historical
artifacts must stay readable. Version changed generation/semantic/capture
contracts together and keep migration behavior explicit. Opening old work must
not regenerate it. Corrections and edits retain provenance and revision fencing.
A changed PDF requires fresh approval; downloading and application tracking stay
separate.

Keep observed failure categories distinct: unsupported factual scope,
unavailable technical checks, stale responses, missing input, and export
failure. A technical failure must not be converted into a request for factual
confirmation. The approved baseline-support policy does not grant independent
verification or support new ownership, metrics, outcomes, or relationships.

Use the configured runner and existing budgets for authorized calibration. Do
not relax exact source/span checks, remove unique content silently, reduce
accepted readability, or invent an ATS score to make acceptance pass.

## Verification and delivery gate

For each ticket, first demonstrate its specific regression, implement its
bounded scope, run relevant focused checks, and record what remains untested.
Suggested source files in these docs are starting points; future filenames or
new contracts are proposals, not claims that code already exists.

For coordinated delivery, use the repository's
[delivery acceptance contract](../../agents/delivery-acceptance.md). Supply the
required contract before factory execution; engineering checks alone do not
authorize Task Master completion, acceptance, or a release. Follow the existing
approved implementation plan where it governs a slice.

Cover these integrated scenarios:

| Scenario | Required outcome |
| --- | --- |
| 52 saved jobs, 37 PDFs, four confirmations, no corrections | Jobs loads; no historical correction scan; no false empty-account state. |
| One real correction among unrelated jobs | Matching drafts are discovered with bounded work; unaffected PDF bytes are not eagerly scanned; stale discovery is rejected. |
| Malformed third classification batch | Earlier support remains; affected passages get a technical retry; no fabricated answers or automatic budget reset. |
| Numeric baseline with blocked number-free rewrite | Each finding names its exact wording and candidate scope. |
| Generated bindings omit connective text | Generation/diagnostics satisfy the strict contract without dropping factual qualifiers. |
| Worker leases and snapshot bursts | No broad workspace refresh storm; relevant evidence changes still invalidate support. |
| Mixed inherited/generated edits while a check runs | One coherent save retains edits across reload; stale results cannot publish older content. |
| Source-free employment confirmation in two synthetic jobs | Exact human provenance is preserved and reused only for compatible employment facts. |
| Final PDF after inherited corrections | All substantive changes and omissions are visible against original capture; approval binds that current artifact. |
| Same-named resume files and implicit defaults | Unique selection values resolve exact bytes; the captured choice is visible and legacy ambiguity is explicit. |
| Multi-region posting metadata | Screening context, source provenance, and unknown fields survive intake and reload. |
| Job-specific accomplishment selection | Strong relevant supported work leads each role; unsupported scope is narrowed; actual page budget and readability pass. |
| Desktop and 390-pixel review | Keyboard/accessibility, current next action, persisted state, and final PDF inspection work without horizontal overflow. |

Capture the served build and relevant current job/review/artifact identity.
Recheck those identities at acceptance; old screenshots alone do not prove a new
build. Use fresh, valid screenshot/video/trace files and state missing evidence
plainly. The November 7 trace was incomplete; it must not be reused as valid
verification.

Run the appropriate core/service/UI tests and all builds for code changes.
Broaden to the full suite at integration, or earlier when changes/failures
justify it. Real renderer/PDF verification must check page budget and expected
text, alongside an independent review of accomplishment quality and the default
user experience. The final approval decision still belongs to the user viewing
the current PDF.
