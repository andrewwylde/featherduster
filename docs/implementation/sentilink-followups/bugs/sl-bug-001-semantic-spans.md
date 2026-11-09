# SL-BUG-001: Preserve exact text when computing semantic spans

Priority: P1. Status: open. Triage: ready-for-agent. Task Master: 65.

## Problem and evidence

The [SentiLink check](../../../sentilink-live-job-attempt-2026-11-08.md#4-generated-accomplishments-and-initial-checks)
failed on invalid claim spans in batch three. One focused retry failed with the
same diagnostic. Successful batches remained saved. A separate fake-runner
reproduction shows that edge whitespace alone can cause this failure.

The live diagnostic does not prove that whitespace caused that particular raw
response. The deterministic reproduction and inspected code establish the
normalization defect independently. Private receipt:
`claim-span-reproduction.json` under `walkthrough-output/real-job-2026-11-08/`.

## Synthetic reproduction

Submit `Built a UI; shipped an API.` with no evidence sources. Have a fake
runner return two needs-clarification claims with otherwise valid fact
and question fields:

```json
{
  "subject_ref": "p1",
  "claim_texts": ["Built a UI; ", " shipped an API."]
}
```

This is a compact fixture description, not the complete runner wire response.
Embed the strings in the existing fake-runner claim shape. The current result
is unavailable with `Invalid claim span`. Removing the edge spaces produces a
complete result, still needing factual support. No human confirmation is needed
to reproduce the technical failure.

## Implementation scope

Inspect [semantic-classifier.ts](../../../../packages/cli/src/jobs/semantic-classifier.ts)
and [semantic-evidence.ts](../../../../packages/core/src/jobs/semantic-evidence.ts).
The classifier locates the raw quotation and computes offsets, then a shared
`trim()` schema changes its text before span-length validation.

Use a verbatim, non-whitespace-only string contract for span-bearing claim and
source-quote text. Preserve exact captured text and calculate offsets against
that same representation. Leave identifier/metadata normalization separate.
Do not broadly trim, collapse whitespace, normalize Unicode, or strip
punctuation without a reversible position map. Do not relax source matching,
unique quotation, claim coverage, or factual-support checks.

Retain strict validation of provider-supplied coordinates. Reject ambiguous or
missing quotations. Keep successful batch results and focused retry behavior
from [NetBox BUG-002](../../netbox-followups/bugs/bug-002-classification-recovery.md).
Review semantic parser/cache identity when changing behavior. Preserve readable
legacy records and historical approvals; do not regenerate saved jobs on read.

## Acceptance and verification

- Both fixture variants complete technical parsing and yield equivalent
  unresolved facts. Whitespace does not create factual support.
- Claims and source quotes satisfy exact substring/offset checks, including
  nonzero source offsets, tabs, newlines, nonbreaking spaces, and UTF-16 text.
- Repeated substrings, empty/whitespace-only quotations, wrong numeric spans,
  changed subjects, and uncovered substantive text remain rejected.
- Failed batches retain safe field diagnostics; retry checks only failed or
  unchecked current passages within existing budgets.
- Extend [classifier tests](../../../../packages/cli/tests/job-semantic-classifier.test.ts),
  [semantic evidence tests](../../../../packages/core/tests/semantic-evidence.test.ts),
  and the affected service integration test. Use fake runners for regressions.

Dependencies: none. This extends classification reliability; it does not
replace Task 52's already implemented diagnostic/retry behavior.
