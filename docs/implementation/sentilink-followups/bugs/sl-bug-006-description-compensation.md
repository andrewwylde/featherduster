# SL-BUG-006: Extract compensation present only in a job description

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 61 (existing).

## Problem and evidence

The [SentiLink posting capture](../../../sentilink-live-job-attempt-2026-11-08.md#1-entry-and-saving-the-posting)
retained its salary paragraph but stored an empty compensation array. The
structured location, employment type, and remote policy worked. Actual HTML and
a synthetic JSON-LD reproduction both demonstrate the omission.

Description intake reads JSON-LD `description`; metadata fallback scans visible
HTML after removing scripts. A salary inside description but absent from
`baseSalary` therefore misses that fallback. Private receipt:
`compensation-reproduction.json`.

## Synthetic reproduction

Use an HTML document with an otherwise empty body and this JSON-LD object:

```json
{
  "@type": "JobPosting",
  "title": "Frontend Engineer",
  "description": "<p>Compensation:</p><p>$180,000/year - $220,000/year + equity + benefits</p>",
  "employmentType": "FULL_TIME",
  "jobLocationType": "TELECOMMUTE",
  "jobLocation": { "address": { "addressCountry": "US" } }
}
```

Current result: no compensation. Expected: a range from 180,000 to 220,000,
explicit annual period, exact source text, and preserved source attribution.
Dollar-symbol currency ambiguity must be handled explicitly; this USD example
has US posting context. Do not universally equate an unqualified `$` with USD.

## Implementation scope

Extend [posting-extractor.ts](../../../../packages/cli/src/jobs/posting-extractor.ts)
and its intake integration. Parse the same selected JobPosting description used
for the saved role. Prefer explicit structured salary when present; safely
supplement it from that description or visible salary blocks. Do not merge
unrelated jobs in a multi-JobPosting document.

Handle repeated `/year` units between range endpoints; the current range regex
does not handle that form merely by making description text visible. Bind the
range to the matching source excerpt, capture time, and URL/field. Keep regional
bands, currencies, and explicit periods separate. Avoid duplicate identical
ranges and preserve meaningful contradictions for review.

Do not treat company revenue, product volumes, years of experience, generic
benefits, or office-city lists as compensation or eligibility. Do not fabricate
bonus amounts or a base-versus-total interpretation. Older posting snapshots
remain immutable; new extraction or recapture must be explicit and compatible.

## Acceptance and verification

- The fixture extracts both correct endpoints and explicit annual period;
  location/remote/employment results remain intact.
- Test JSON-LD-only descriptions, baseSalary precedence, repeated units,
  regional/multicurrency ranges, encoded HTML, malformed JSON-LD, ambiguous
  dollars, and pages with multiple jobs.
- Non-salary numbers never become pay; no inferred amount, period, or currency
  is labeled as explicitly supplied.
- Inputs and saved job details show the captured range with provenance and
  survive reload. Legacy snapshots remain readable without silent rewriting.
- Add deterministic fixtures to [intake tests](../../../../packages/cli/tests/job-intake.test.ts)
  and the affected UI test; no live network dependency is needed for regression.

Dependencies: none. Completes the description fallback in existing FEAT-001,
without introducing a new posting ingestion pipeline.
