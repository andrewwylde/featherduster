# Live job attempt: SentiLink, November 8, 2026

This follow-up uses the real career workspace, a new employer posting, the
configured Codex runner, and the current application build. It follows the
[NetBox attempt](netbox-live-job-attempt-2026-11-07.md) and its
[implementation backlog](implementation/netbox-followups/README.md). Local
times are America/Denver; receipt timestamps use UTC and cross into November 9.

**Outcome:** the app produced a checked one-page PDF after a failed classifier
batch, one failed focused retry, conservative wording edits, and recovery from
a stale browser draft. Mixed saving, captured-input visibility, and original
comparison improved. Span parsing, progress accuracy, skills pruning, and final
change-summary coverage still need work. The resume remains unapproved and no
application was submitted.

[Open the saved review](http://127.0.0.1:4174/jobs/2a91962e-faf6-41b8-b989-71681258c343/resume)
or inspect the
[unapproved browser-downloaded PDF](../walkthrough-output/real-job-2026-11-08/andrew-wylde-sentilink-browser-download.pdf).

The [SentiLink implementation packet](implementation/sentilink-followups/README.md)
turns these findings into eight bug reports and two feature specifications,
with acceptance criteria and Task Master ownership.

## Selected opportunity and fit

[Senior Software Engineer, Frontend at SentiLink](https://jobs.ashbyhq.com/sentilink/a6e68750-7a2e-4296-baab-2e08ca95dac7)
was accessible with a working application form. It specifies US remote work,
full-time employment, and $180,000–$220,000 per year plus equity and benefits.
The body calls the position Full Stack and describes a 60–70% frontend focus.
Those are the employer's differing labels, not an intake-generated title change.
The publication date was not verified.

This is a credible opportunity for a frontend engineer with API and identity
depth. The fit assessment is an engineering judgment, not an eligibility
determination or a promise of an interview.

| Requirement | Evidence and remaining limits |
| --- | --- |
| React and frontend delivery | Parable's production React cutover, shared components, and product interfaces; DFINITY's initial React/TypeScript identity frontend. |
| APIs consumed by product interfaces | Parable's shared error contracts and impersonation across schema, API, generated SDK, and UI; Kong's public TypeScript SDK and portal administration. |
| Automated quality and production support | Accessibility and visual regression work, Cypress/release automation, deployment safety, and Kong on-call experience. |
| Analytical product interfaces | Parable's query and analytics interfaces are relevant to investigative workflows. They do not establish fraud-analysis domain expertise. |
| Backend and infrastructure specifics | Assess Go/Python, PostgreSQL query optimization, AWS Lambda/Cognito, and Docker individually against the evidence. Do not copy the employer's stack into skills without support. |
| Financial services and eligibility | Financial-services experience is a bonus, not established by generic identity work. US residence and work authorization are separate factual questions; authorization was not inferred or entered. |

The posting was absent from the 53 saved jobs at the start. A search result for
Affirm Auth Experiences redirected to the general openings page with
`error=true`; Scribe's result returned 404 through web retrieval. Grafana Cloud
Integrations was live but described an Eastern-time constraint and asked about
two years of Go in its application. I selected SentiLink instead of assuming
those conditions were satisfied. Search results alone were not treated as proof
of an active opening.

Receipts:

- [Live posting](../walkthrough-output/real-job-2026-11-08/03-sentilink-posting.png)
- [Application form](../walkthrough-output/real-job-2026-11-08/04-sentilink-application.png)

## Environment and method

The existing process on port 4174 started on November 7, before the follow-up
fixes. I backed up the jobs database with SQLite's backup API, checked there
were no active attempts, ran `npm run build`, and restarted that process from
the current checkout. All three package builds passed. Vite reported its
existing large-chunk warning. No application source was changed for this
walkthrough; pre-existing uncommitted changes were retained.

| Item | Recorded value |
| --- | --- |
| Checkout commit | `b96181e`, plus the retained working-tree changes |
| Backend identity | `167b05c925489ea5565f691bc86dc392707925bea497b5e94ad5c36d7f9ebbd6` |
| Identity scope | Startup CLI/core module-byte inventory; UI assets have a separate saved hash inventory. This is not a clean Git-commit claim. |
| App and workspace | `http://127.0.0.1:4174`; `C:/Users/drewk/career` |
| New saved job | `2a91962e-faf6-41b8-b989-71681258c343` |
| Input snapshot | `62d1f464-077e-4282-81e1-304656c63261` |
| Initial attempt | `b01b6eba-bf33-492a-b6dd-c69a89d042f8` |
| Browser | Visible Chromium; desktop 1440 × 1000 and mobile 390 × 844 |
| Runner | Codex, existing consent dated September 29; empty configured model means runner default |
| Preparation limits | Four model calls, zero repair attempts, zero transport retries, 720,000 ms overall timeout |
| Output budget | One page |

Job intake, selection, preparation, and review actions use the web controls.
Read-only requests, database inspection, and a small extractor reproduction
supplement the browser evidence. Private receipts are under
`walkthrough-output/real-job-2026-11-08/`, which remains ignored by Git.

## Walkthrough

### 1. Entry and saving the posting

The Jobs page loaded the existing workspace without the earlier entry-screen
outage. It showed 53 saved jobs and explicitly labeled the global badge
**561 Workspace issues**. Loading states used **Workspace audit: Checking…**
rather than falsely reporting zero issues. This improves the scope distinction;
the badge remains visually prominent during a job-specific flow.

Pasting the exact employer URL, choosing **Preview**, and choosing **Add jobs**
worked. The preview identified the correct employer and heading. Saving did not
start model work. The saved Posting retained the source URL, capture time, and
description, including the salary paragraph.

The structured **Position details** showed United States, Full-time, and Remote.
It omitted compensation. Read-only inspection confirmed an empty compensation
array rather than a display-only omission. Fetching the public HTML and running
the current extractor reproduced the omission. A small synthetic JobPosting
JSON-LD example, with the salary in `description` and no `baseSalary`, also
returned no compensation.

The description importer reads JSON-LD `description`, while metadata fallback
uses visible HTML after removing scripts. Salary present only in that
description therefore misses the fallback. This differs from failing to retain
the posting text: the user can still find the amount in the full saved posting.

Receipts:

- [URL preview](../walkthrough-output/real-job-2026-11-08/05-url-preview.png)
- [Saved posting](../walkthrough-output/real-job-2026-11-08/06-saved-posting.png)
- `compensation-reproduction.json`, `posting-source.html`
- Implementation: `packages/cli/src/jobs/posting-extractor.ts`

### 2. Selecting and capturing the starting resume

The Inputs page initially showed its placeholder while the resume request was
pending. After loading, it identified the default file. I opened the new
searchable picker, searched for `resumes/templates/master.yaml`, and selected
the matching source. Results showed the path, template/tailored type, extension,
and modification date. A diagnostic read returned 179 resumes with 179 unique
IDs. Duplicate display names remained distinguishable by their paths.

Choosing **Prepare with current inputs** captured the selected resume and
started preparation. A brief initial render still showed the saved-job state;
the settled page showed the active attempt. On Inputs, **Captured inputs for
active draft/PDF** displayed the exact path, fingerprint, and capture time.
The next-selection placeholder could reappear while its independent options
request loaded, but it no longer obscured the captured source.

Receipts:

- [Picker with paths](../walkthrough-output/real-job-2026-11-08/08-resume-picker.png)
- [Exact search](../walkthrough-output/real-job-2026-11-08/09-picker-search.png)
- [Selected input](../walkthrough-output/real-job-2026-11-08/10-selected-input.png)
- [Captured source](../walkthrough-output/real-job-2026-11-08/13-captured-inputs.png)

### 3. Preparation, progress, and navigation

The new progress card showed a running elapsed clock, runner-default model,
call count, and **Tokens: Not recorded**. The missing-token wording is honest.
The operation and call count were stale: a saved response recorded the attempt
in alignment with two dispatched calls while `preparation.usage.api_calls`
remained zero and its current operation remained `preparing_resume`.

The runtime initializes an in-memory progress entry at zero and prefers that
entry over its more current attempt-derived fallback. It updates the tracked
entry on completion/failure rather than on each active stage. This explains
the observed mismatch. The elapsed clock is still useful, but the card does
not yet provide reliable live phase/call information.

A 45-second observation completed 35 API responses: four job-detail reads,
four control reads, three integrity reads, five citation reads, two tailoring
reads, five evidence reads, three rubric-list reads, four gap-analysis reads,
three corpus reads, and two health reads. Broad refreshes remain observable.
The earlier attempt counted 80 in a different window; these are not matched
benchmarks and do not establish a particular speedup or cause of latency.

Individual diagnostic requests during preparation returned health in 3,861 ms,
clarification updates in 391 ms, and resumes in 1,076 ms. Correction discovery
returned no affected jobs at corpus revision four. These are single samples
under load, not service guarantees or verification of actual-correction scans.

Fit and History navigation worked. History retained the queue/start events.
Reloading Resume retained the active attempt without another preparation
request. At 390px, the preparing page measured 385px wide and had no horizontal
page overflow. This check precedes the full review surface.

Receipts:

- [Progress](../walkthrough-output/real-job-2026-11-08/14-preparation-progress.png)
- `14-api-observation.json`, `15-job-progress.json`
- [History](../walkthrough-output/real-job-2026-11-08/17-history.png)
- [Reload](../walkthrough-output/real-job-2026-11-08/18-reload-active.png)
- [Mobile preparation](../walkthrough-output/real-job-2026-11-08/19-mobile-preparation.png)
- `20-read-only-diagnostics.json`
- Implementation: `packages/cli/src/jobs/runtime.ts`,
  `packages/ui/src/views/jobs/JobDetail.tsx`

### 4. Generated accomplishments and initial checks

The first attempt stopped for review after 325 seconds. It retained analysis
and alignment checkpoints and produced 14 operations: seven text rewrites
including the summary, three additions, two omissions, and two skills
operations. No consolidation was generated.

The new material was useful. It found the staff/customer lifecycle work across
UI, Go backend models, and database entities, plus Time Spend analytics across
API and UI, and Cypress API mocking. Those details were absent from the selected
starting bullets. The lifecycle addition relies on an existing candidate
description captured before this attempt; I did not enter a confirmation to
create that support during the walkthrough.

The impersonation and shared error-contract bullets describe recognizable
cross-stack delivery. The wallet rewrite narrows an overbroad starting claim to
the existing transaction wizard and fee-aware validation. The Kong rewrite
distinguishes interface specifications from implementation. These are useful
changes with meaningful technical scope, rather than a raw commit inventory.

The first summary still introduced avoidable questions: a senior-title claim,
plural analytics products where the mapped evidence established one product,
and an enterprise qualifier absent from the selected portal mapping. The
classifier identified these distinctions rather than silently approving them.
Some useful additions were still feature lists and appeared after three other
Parable bullets. Discovery improved the content; ordering and concision remain
editorial work.

The initial fact result had 20 claims: 13 supported, three needing
clarification, and four unavailable. Batch 3 failed on invalid claim spans.
Unlike the earlier
generic diagnostic, the page identified batch and field paths and offered
**Retry failed checks**. Successful batches, including the later completed
batch, remained available.

One focused retry dispatched one additional call rather than regenerating the
resume. It also failed, naming an invalid span in retry batch 1. Support from
the successful calls remained saved. This verifies diagnostic and retry
improvements, not reliable completion of the underlying classifier contract.

I reproduced a parser defect separately with a fake runner and a two-clause
synthetic passage. Claim strings with edge whitespace fail **Invalid claim
span**; the same strings without that whitespace pass. The classifier locates
the original substring and calculates offsets, then the domain schema trims
the claim text before comparing its length with those offsets. Exact offsets
and normalized text no longer agree. The live failure has the same diagnostic,
but the stored failure does not establish that edge whitespace caused its raw
response; the synthetic reproduction demonstrates a defect, not that causal
claim.

The baseline-number finding is clearer now. It explicitly says **Retained
baseline finding (resolved by your pending edit)** beside the old 11-year
assertion, instead of making it look like the new number-free summary contains
11. It still contributes to the initial wording count while that replacement
is unresolved. The header separately reports facts, wording, technical checks,
and supported claims, but some nested guidance continues to disagree about
whether the next action is answering, waiting, or retrying.

Receipts:

- [First review](../walkthrough-output/real-job-2026-11-08/23-review-or-failure.png)
- `24-initial-facts.json`, `25-initial-proposals.json`
- [Focused retry](../walkthrough-output/real-job-2026-11-08/24-focused-retry.png)
- `27-after-focused-retry-facts.json`, `claim-span-reproduction.json`
- Implementation: `packages/cli/src/jobs/semantic-classifier.ts`,
  `packages/core/src/jobs/semantic-evidence.ts`

### 5. Mixed saving, recovery, and conservative corrections

I rewrote the summary to **Frontend engineer**, named the singular Time Spend
product, and removed the enterprise qualifier. I also narrowed the inherited
Kong accessibility bullet to semantic HTML, labeling, and keyboard focus,
removing the broader audit-blocker outcome. The browser saved both kinds of
change automatically in review revision two, without two independent save
actions. It retained unrelated wording and support and began affected checks.
Saving did not create a human factual confirmation.

After reload, both saved texts were present. The browser also restored a local
proposal draft and displayed **Save your changes to continue**, then **The saved
review changed**. Editing and undo controls were disabled until I chose
**Reconcile current review and keep edits**. This was recoverable, but already
saved work looked unsaved and created an extra reconciliation step. The mixed
save path advances the storage key's revision without clearing every older
recovery entry; investigate recovery-key cleanup and comparison with the
acknowledged server content before assuming that every restored entry is new.

Subsequent checks completed without another generation. The revised summary
and Kong passages gained support. The remaining DFINITY question concerned
whether its identity-provider package belonged to the SDK. I removed **SDK**
from that inherited passage while retaining its supported frontend, routing,
and session-restoration wording. This resolves the qualifier conservatively
without answering the factual question on Andrew's behalf.

The review surface at 390px measured 385px wide without horizontal page
overflow. Its exception editor moves below the resume. Long requirement chips
and original/proposed panels still make that mobile flow tall; absence of page
overflow is not evidence that the interaction is concise.

Receipts:

- [Mixed edits](../walkthrough-output/real-job-2026-11-08/29-mixed-edits-entered.png)
- [Saved revision](../walkthrough-output/real-job-2026-11-08/31-mixed-save-settled.png)
- `31-mixed-save-proposals.json`
- [Reloaded edits](../walkthrough-output/real-job-2026-11-08/32-after-reload-mixed.png)
- [Stale recovery state](../walkthrough-output/real-job-2026-11-08/37-current-review.png)
- [Reconciliation](../walkthrough-output/real-job-2026-11-08/38-reconciled.png)
- `38-facts-completed.json`
- [Mobile review](../walkthrough-output/real-job-2026-11-08/33-mobile-review.png)
- [Second mixed correction](../walkthrough-output/real-job-2026-11-08/39-mixed-skill-and-fact-correction.png)

### 6. Reversed skills pruning and incomplete change descriptions

The generated skills action says **Removes Docker because its supplied evidence
remains provisional**. Its `skills.prune` array contains GitHub Actions,
Kubernetes/Helm, OpenTelemetry, Datadog, and Cypress. The application contract
defines that array as skills to remove. Applying it therefore leaves **Delivery:
Docker**, the opposite of the rationale, and drops useful supported skills.
The whole draft makes the mistake visible; the Changes entry says
**Before: (new content)** and shows an empty After, which does not explain the
actual removal.

This is a generated-operation mistake that the current validation and review
presentation do not catch. The generator was instructed that prune means
remove; the application applied its current contract. A fix needs stronger
operation validation and concrete before/after lists, with a practical way to
edit skills. A prose rationale is not a reliable description of a structured
mutation.

I undid that action through **Undo change**, retaining the captured Delivery
group, and saved it with the DFINITY correction in revision three. No new skill
was added. Undo retains Docker as a pre-existing resume assertion; it does not
independently establish its evidence status. The incorrect deletion was stopped,
but the original Docker-support question still deserves review before approval.

The stopped preparation card also kept ticking after the first attempt ended
and continued to say **Needs retry** after the technical check completed. The
semantic check counter and preparation model-call counter are different
quantities, and that distinction needs clearer labels and live state binding.

Receipts:

- `25-initial-proposals.json`: `delivery-skills` operation and rationale
- [Initial Delivery group](../walkthrough-output/real-job-2026-11-08/23-review-or-failure.png)
- `40-proposals-after-second-save.json`: rejected skills action, revision three
- Implementation: `packages/core/src/tailoring/apply.ts`,
  `packages/core/src/tailoring/validators.ts`,
  `packages/ui/src/views/jobs/ResumeDraftSurface.tsx`

### 7. Automatic PDF continuation and final review

After the last changed passage passed, all 16 passages had saved support. The
app automatically resumed without another generation request from me. The
continuation reused analysis and alignment, kept the edited proposals, wrote
the interview brief, and rendered and verified the PDF. It ran from 9:09:24 PM
to 9:10:52 PM, about 88 seconds. First preparation to PDF ready was about
13 minutes 37 seconds, including edits, diagnostics, and observation pauses.
This is an observed workflow interval, not an unattended benchmark.

The first attempt dispatched three preparation model calls; continuation
dispatched one. The separate semantic history records eight dispatched calls
and 234,132 ms aggregate elapsed time, including failures. Token and monetary
usage were not recorded. Existing budgets were retained throughout; retrying a
technical check did not trigger another analysis/proposal generation.

The actual export checks passed:

| Check | Result |
| --- | --- |
| Export validation | Passed |
| Page count / selected budget | 1 / 1 |
| Expected-text coverage | 100% |
| Missing fragments / diagnostics | None / none |
| Independent `pdfinfo` inspection | One US Letter page; 201,999 bytes |
| Independent text extraction | Readable `pdftotext -layout` output |
| Artifact and browser download hashes | Identical SHA-256 |
| Artifact ID | `abf3e7de-48d2-4496-99e5-8ae442dbdfe4` |

I rendered and inspected the page. It retains the requested serif presentation,
all five employers, education before technical skills, and readable section
headings. The LinkedIn address wraps to its own line. Content is dense and some
bullets remain long, but no clipped or overlapping region was apparent. Text
extraction and ordinary headings support basic machine readability; no
predictive ATS score was produced.

The final change-history payload contains the original capture and both
inherited corrections. The complete before/after comparison now uses the raw
original, which fixes the earlier misleading comparison baseline. The summary
rewrite also exposes its two-stage correction history.

However, the prominent **Changes in this PDF** list still renders active
generated proposals, not inherited-only corrections. The Kong accessibility
and DFINITY qualifier changes are absent from that list despite being in the
payload and full comparison. A correction trace attached to an active generated
proposal is visible; a correction to an otherwise inherited passage is still
easy to miss. Skills reordering is also absent from this final list. This is a
partial improvement to BUG-007, not its complete acceptance.

Two omitted accomplishments appear together with restore controls and
rationales. I inspected the controls without changing the finished candidate.
Actual restoration, overflow replacement, and a new artifact after restoration
were not exercised in this run.

The private generated interview brief usefully separates nine backed
requirements, eight transferable areas, and two gaps. It explicitly
distinguishes authentication from fraud/entity-resolution expertise, limits
Python scope to the documented work, and leaves PostgreSQL/AWS specifics and
eligibility unconfirmed. Quantitative proof that is absent remains marked as
missing in the private brief; fabricated metrics were not inserted into the
resume. This is useful preparation advice, not evidence that every original
skill assertion has been independently established.

### 8. Download, reload, and final disposition

The main recording browser used one Playwright connection to own recording and
another to drive actions. **Download PDF** returned HTTP 200, but its first
`download.saveAs` failed because the expected temporary file did not exist.
Attempts to set download behavior over CDP also failed to produce a stable
local file. Those failures do not by themselves prove an application defect.

A fresh visible browser with one Playwright owner downloaded `resume.pdf`
successfully through the same app button, with no download failure. Its saved
bytes matched the immutable artifact fetched read-only over HTTP:
`a38773b18830423873224fe65461c44341b9e58ee01b5530963a9c8964ffe1ba`.
This isolates the earlier file-path failures to the shared-browser harness for
this attempt. Both copies are retained as receipts.

Reloading retained the current PDF, the Changes panel, and the separate
**Approve Resume** control. The final mobile page measured 390px at a 390px
viewport. I did not click approval, mark the job applied, submit an employer
application, or enter a new human factual confirmation.

Final checks found zero approval events for this job, application lifecycle
`not_started`, zero new human clarification records, unchanged total human
record count of 28, and unchanged corpus revision four. The five fingerprinted
source files, covering the starting resume, configuration, and evidence ledgers,
were unchanged. There was no application-source patch during this walkthrough.
The rebuilt server remains available on port 4174; the browser was closed after
recording finalized.

Receipts:

- [Final PDF and changes](../walkthrough-output/real-job-2026-11-08/43-final-pdf-and-changes.png)
- [Complete original/current comparison](../walkthrough-output/real-job-2026-11-08/45-original-and-current-comparison.png)
- [Final after reload](../walkthrough-output/real-job-2026-11-08/46-final-after-reload.png)
- [Fresh-browser download](../walkthrough-output/real-job-2026-11-08/47-fresh-browser-download.png)
- [Export checks](../walkthrough-output/real-job-2026-11-08/48-final-checks.png)
- [Rendered page](../walkthrough-output/real-job-2026-11-08/final-resume-page-1.png)
- [Downloaded PDF](../walkthrough-output/real-job-2026-11-08/andrew-wylde-sentilink-browser-download.pdf)
- `final-facts.json`, `final-artifact-review.json`, `final-job-detail.json`,
  `final-resume-extracted.txt`, `fresh-browser-download.json`, `summary.json`

## Comparison with the earlier implementation backlog

These are real-workflow observations, not a replacement for the full regression
suite. "Not exercised" must not be read as passed.

| Earlier item | Result in this attempt |
| --- | --- |
| BUG-001: Correction discovery | Entry outage did not recur. Empty discovery returned successfully. Discovery with actual superseding corrections remains untested. |
| BUG-002: Classification recovery | Better batch/field diagnostics and a focused retry; prior successful results retained and later batches processed. Retry still failed on invalid spans. |
| BUG-003: Findings and exact wording | Baseline findings explicitly identify retained original wording. This removes the earlier misleading attribution of 11 to a number-free replacement. Delayed-response race variants were not comprehensively tested. |
| BUG-004: Generated claim bindings | Initial sentence bindings covered the generated text without the earlier connective-coverage error. The separate semantic whitespace/span defect remains. |
| BUG-005: Live refresh storm | Broad unrelated refreshes still occurred: 35 responses in the sampled 45 seconds. Different windows do not establish a comparative performance result. |
| BUG-006: Review state | Counts now name facts, wording, technical checks, and support. Nested next-action guidance, stopped progress, and stale review projections can still disagree. |
| BUG-007: Final correction history | Original baseline and persisted correction traces improved. Prominent final Changes still omits inherited-only edits. |
| BUG-008: Captured selection | Captured path, fingerprint, and time visible. Temporary next-selection placeholders still occur while options load. |
| BUG-009: Resume identities/picker | Searchable paths/extensions/dates worked; all 179 IDs were unique. Ambiguous legacy aliases were not exercised. |
| BUG-010: Workspace audit state | Explicit Checking state and Workspace issues scope observed. Network-error/retry transitions were not forced. |
| FEAT-001: Posting context | Location, employment type, and remote status retained. Salary embedded only in JSON-LD description was omitted from structured compensation. |
| FEAT-002: Preparation progress | Elapsed clock and missing-token state visible. Tracked live phase/call count stale; terminal clock keeps advancing. |
| FEAT-003: Mixed saving | Combined generated/inherited edits saved automatically in one revision and survived reload. Stale local recovery introduced an extra reconciliation step. |
| FEAT-004: Accomplishment selection | Useful cross-stack additions and reasonable omissions; additions still low within Parable and sometimes inventory-like. No consolidation was generated. |
| FEAT-005: Employment facts | Source-free/project/job confirmation controls visible. No personal confirmation, cross-job reuse, or correction propagation performed. A senior-title question remained until wording was narrowed. |

## Prioritized implementation findings

| Priority | Finding | Concrete next work and verification |
| --- | --- | --- |
| P1 | Semantic span construction conflicts with text normalization. | Make quotation normalization and offset calculation consistent. Cover leading/trailing whitespace, repeated substrings, Unicode, and exact source offsets. Preserve claim coverage and factual-support gates. Reuse `claim-span-reproduction.json`. |
| P1 | Skills pruning contradicts its rationale and silently removes the wrong list. | Validate prune/reorder targets, reject unknown removals, render actual list diffs, and provide skill editing. Verify Docker-removal and keep/remove inversion examples against the applied candidate. |
| P1 | Prominent final Changes omits inherited-only corrections. | Render correction traces that have no active generated proposal; bind them to the current artifact and give them undo. Verify the two real paths in `final-artifact-review.json` without depending on the full comparison drawer. |
| P1 | Successful mixed saves can return as stale browser drafts. | Clear or reconcile all superseded recovery keys after acknowledgment. Reload during and after mixed save, compare local text with server revision, and retain only genuinely newer edits. Preserve conflict protection. |
| P2 | Progress phase/call count and terminal elapsed time are inaccurate. | Derive active progress from persisted dispatch/stage state or update the tracked entry at every transition; freeze terminal timing and label preparation versus semantic counts. Verify against `15-job-progress.json`. |
| P2 | Structured compensation skips JSON-LD description text. | Parse the extracted job description as well as visible HTML, with source binding and explicit period/currency handling. Test this posting's repeated `/year` range without inventing structured base salary or unrelated amounts. |
| P2 | Broad refreshes remain during local preparation. | Measure and reduce unrelated evidence, rubric, corpus, citation, and integrity refreshes triggered by operational writes. Verify current user edits still refresh and reconnect still recovers. |
| P2 | Review counts and guidance still project different states. | Derive heading, exception rows, pending/retry labels, and terminal card from the same current persisted results. Keep successful passage support visible while only changed/failed passages are checked. |
| P2 | Accomplishment ordering and density remain mixed. | Compare ranking against the frontend-focused fullstack posting. Evaluate whether lifecycle/API and analytics proof belongs higher, tighten feature inventories, and retain supported scope and page readability. |

No new implementation was made or declared complete by this report. The earlier
backlog items should be evaluated against these observations before closing
their real-workflow acceptance.

## Recording and automation limits

The session recording finalized successfully: 1,228.8 seconds, 27,958,232 bytes.
The trace ZIP also finalized and passed an archive CRC check: 2,643 entries,
96,127,408 bytes. Both contain private career data and remain ignored.

- [Session video](../walkthrough-output/real-job-2026-11-08/session.webm)
- [Playwright trace](../walkthrough-output/real-job-2026-11-08/trace.zip)

The server detector again omitted port 4174 and reported an unrelated service on
8080. Process inspection identified the actual app. The skill's missing local
Playwright dependency was resolved through the repository's `NODE_PATH`, without
installing anything. Ashby's overview/application navigation did not expose the
tab/link roles initially assumed by automation; its visible **Apply for this
Job** link worked. CDP page order also changed between connections, so later
scripts selected pages by URL. These locator failures are harness errors, not
failed product actions.

Screenshots taken immediately after navigation sometimes show loading text.
Conclusions about saved data use settled screens and persisted responses. A
disabled Undo action during the stale-review state was not forced; the normal
reconciliation control restored editing. Browser-aborted requests during
navigation are not counted as independent backend exceptions.

This run did not exercise human confirmation/reuse, conflicting corrections
across jobs, legacy alias resolution, actual-correction discovery at scale,
consolidation undo, or restoration that overflows. It did exercise URL intake,
source selection, real generation, failure/retry, mixed saving, reload recovery,
desktop/mobile review, automatic continuation, artifact verification, and an
actual browser download. Builds passed; no full test suite was rerun for this
documentation and walkthrough task.
