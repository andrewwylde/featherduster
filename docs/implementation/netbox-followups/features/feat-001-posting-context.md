# FEAT-001: Retain structured posting context and provenance

Priority: P2. Status: proposed implementation. Triage: ready-for-agent. Task
Master: 61.

## User outcome and observed need

After saving a posting, users can still assess location, remote eligibility,
employment type, and advertised compensation without reopening the employer
site. The NetBox employer page showed location and country-specific pay blocks,
while the saved description omitted those blocks. See the
[walkthrough](../../../netbox-live-job-attempt-2026-11-07.md).

This adds to the current description-text contract. It does not claim the
existing extractor was designed to persist all employer metadata.

## Experience and data contract

Show a compact **Position details** section on preview, Posting, and Inputs.
Represent unknown fields explicitly. Retain the advertised source text beside
normalized values and label user corrections separately from extracted facts.

Capture, when explicitly available:

- Location/region entries, remote/hybrid/on-site language, and employment type.
- Compensation ranges with currency, period, applicable location, and source
  text.
- Equity/bonus statements without converting them into guaranteed compensation.
- Employer URL, final URL, capture time, external job identity, and a
  publication or closing date only if the source actually supplies one.

Keep multiple regional ranges separate. Do not infer US eligibility from a
generic remote label, annualize an unspecified pay period, guess publication
freshness, or treat a search result as proof that a role remains open. A role
URL redirecting to an openings index must remain a discovery result or require
confirmation.

## Implementation boundaries

Extend
[posting-extractor.ts](../../../../packages/cli/src/jobs/posting-extractor.ts),
[intake.ts](../../../../packages/cli/src/jobs/intake.ts),
[job schemas](../../../../packages/core/src/jobs/schemas.ts), and the
posting/input views. Prefer structured JobPosting fields; use explicit supported
vendor markup or APIs where necessary. Preserve conflicting source values with
provenance.

Version new snapshot fields compatibly. Old text-only postings remain readable
with metadata unknown. Refresh creates a new snapshot; it must not overwrite an
old approved artifact's inputs or automatically regenerate a resume. Keep SSRF,
redirect, privacy, and untrusted-content protections intact.

## Acceptance and verification

- A synthetic NetBox-shaped posting preserves distinct US, UK, and LATAM
  ranges, location qualifiers, employment type, and the existing description.
- Text-only and malformed/missing metadata inputs save successfully as unknown.
- Conflicting metadata is shown with source context, not silently reconciled.
- Preview and saved views retain the same captured metadata after reload.
- Legacy snapshots load without invented historical metadata or schema
  rewrites.
- Tests cover structured HTML, vendor capture, text fallback, redirects to an
  index, dates, multiple currencies, and user corrections. Browser verification
  proves screening context survives intake without external submission.

Dependencies: none. Coordinate captured-input presentation with
[BUG-008](../bugs/bug-008-captured-resume-selection.md).
