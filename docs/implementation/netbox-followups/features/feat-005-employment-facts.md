# FEAT-005: Reuse scoped human employment facts

Priority: P1. Status: existing implementation work, not a duplicate proposal.
Triage: ready-for-agent. Task Master: 45, already pending.

## Existing authority and scope

Implement the existing
[human-confirmed employment-facts plan](../../../superpowers/specs/2026-11-06-human-confirmed-employment-facts-plan.md)
within the approved
[draft-first support design](../../../superpowers/specs/2026-11-06-draft-first-tailoring-design.md). Task 50 completed the latter design work; its completed tracker status is not
evidence that the application implementation has shipped. Task 45 already tracks
employment confirmation. Do not create another competing implementation task or
replace those plans with a weaker source-optional shortcut.

## New walkthrough evidence

The [NetBox summary](../../../netbox-live-job-attempt-2026-11-07.md) asked
whether Senior Software Engineer was a formal title even though that title
appeared in the supplied resume. The agent avoided confirming it on the user's
behalf and narrowed the summary. This illustrates the friction but does not
establish a new human confirmation, an independently verified title, or a known
matching shared record that the resolver incorrectly ignored.

## Required implementation slice

Maintain distinct support bases: user-supplied starting assertion, explicit
human confirmation, and captured documentary evidence. A compatible baseline
fact can be faithfully restated under the approved policy without a mandatory
repeat interview. A new title or broader leadership claim still needs support.

Give employment/work a stable identity independent of mutable summary text,
bullet index, or job title. Confirmed title support includes the exact question,
answer, actor, time, employment scope, revisions, and correction relationship.
Documentary quotations are optional for valid human support, not fabricated.

Reuse only the same compatible employment fact. Repeated tenures, overlapping
roles, changed titles, promotions, and ambiguous summaries require explicit
scope handling. A title confirmation cannot support unrelated contributions or
the rest of the summary. Preserve job-only and deferred-answer choices.

## Acceptance and verification

- In disposable jobs, explicitly confirm a title with no ledger quotation,
  retain its provenance after reload, and reuse it in another compatible job.
- A changed summary does not erase the same employment identity. Another
  employer, tenure, title qualifier, or contribution cannot inherit the support.
- Baseline restatement follows the approved policy while preserving its origin;
  it is never relabeled independently verified.
- Conflicts require an explicit correction decision. Corrections flag affected
  drafts/artifacts, preserve history, and require fresh PDF approval after
  change.
- Existing source-bound records remain readable and keep exact quotation
  checks.
- Test retries, stale revisions, source-free corrections, and recovery without
  submitting real answers, editing the career ledger, or approving real PDFs.

Implementation files and the fuller verification matrix are in the existing
plan. Coordinate presentation with [BUG-006](../bugs/bug-006-review-state.md)
and final correction visibility with
[BUG-007](../bugs/bug-007-final-correction-history.md).
