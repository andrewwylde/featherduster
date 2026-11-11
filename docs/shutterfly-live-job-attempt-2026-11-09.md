# Live job attempt: Shutterfly / Spoonflower, November 9, 2026

This run uses the user-supplied posting, the real career workspace, existing
Codex consent, and the updated Featherduster app. It follows the
[SentiLink walkthrough](sentilink-live-job-attempt-2026-11-08.md) and
[implementation packet](implementation/sentilink-followups/README.md).
Local times use America/Denver; receipt timestamps use UTC.

The run reached a checked, downloaded, one-page PDF after conservative wording
edits and undoing an inverted skills operation. It remains **unapproved**; no
application was submitted. Several previous fixes held up, but the skills
contract/editor integration and some broader refresh behavior still fail in
the real workflow. New findings concern filtered evidence, multiple regional
pay bands, and inconsistent use of captured resume context.

Open the [saved resume review](http://127.0.0.1:4174/jobs/97d1ff1a-4a29-4ec5-ab3a-14c48579d697/resume)
or inspect the [unapproved PDF](../walkthrough-output/shutterfly-live-2026-11-09/andrew-wylde-shutterfly-unapproved.pdf).
The local app is left running. These local artifacts contain personal data.

## Posting and fit

The supplied
[Senior Software Engineer II posting](https://shutterflycareers.ttcportals.com/jobs/18278323-senior-software-engineer-ii?tm_job=2026-2561&tm_event=view&tm_company=13020&bid=56)
was accessible in a visible browser. It names Spoonflower as part of Shutterfly,
shows requisition 2026-2561, and gives October 22, 2026 as the posted date. The
role is US remote subject to the employer's listed state restrictions. The
Colorado pay band is $117,750–$140,750, lower than the previous walkthrough's
posting; other regional bands differ. These are employer statements, not a
work-authorization confirmation or a compensation recommendation.

This is a backend/platform role rather than a primarily frontend position.
Its Node.js/TypeScript, cloud operation, API, data-integration, and distributed
service requirements make it a useful test of honest transferable positioning.
Andrew's API contracts, identity integrations, Go lifecycle delivery, SDKs,
Helm/deployment work, and production support are relevant foundations. Evidence
for the exact AWS, GraphQL, database, search, and commerce requirements must be
assessed individually. The app must not imply long-term ownership of those
systems merely because they appear in the posting.

The live description and regional restrictions were retained in private
`posting-live.txt`, `posting-pasted.txt`, and the employer screenshots. No
application form was completed or submitted.

## Environment and method

The checkout was clean at `57b31ff`, which includes the SentiLink follow-up
implementation. The app process still running on port 4174 started before that
commit. I made a consistent SQLite backup, verified there were no active
attempts, ran `npm run build`, and restarted the app from this checkout.
Core, UI, and CLI builds passed; Vite retained its large-chunk warning.

| Item | Recorded value |
| --- | --- |
| Server | `http://127.0.0.1:4174`; process 79276 |
| Startup CLI/core byte identity | `e3328b07778e24bb45d56da173643200b9d585f715ce4fc233c8e931b8cfa522` |
| UI build | Separate asset hashes saved in `ui-build-files.json` |
| Workspace | `C:/Users/drewk/career` |
| Jobs before this attempt | 57; no existing Shutterfly job |
| New saved job | `97d1ff1a-4a29-4ec5-ab3a-14c48579d697` |
| Captured input | `686084a2-54bd-428b-8d09-d0f2a5872c43` |
| Initial attempt | `2d5eeb37-176c-4204-96f1-e7c85ff1a5fb` |
| Starting resume | `resumes/templates/master.yaml`, explicitly selected |
| Runner | Codex; existing consent; empty model delegates to runner default |
| Preparation limits | Four calls, zero repairs, zero transport retries, 720,000 ms overall |
| Page budget | One page |

Visible Chromium runs at 1440 × 1000, with 390 × 844 mobile checks. Browser
controls perform intake and resume actions. Read-only requests, SQLite reads,
and isolated parser reproductions supplement the UI evidence. Private receipts
are under `walkthrough-output/shutterfly-live-2026-11-09/`, ignored by Git.
The browser and recorder share one Playwright owner, avoiding the prior
two-connection download issue.

## Walkthrough

### 1. URL capture fails; paste recovery works

The employer page loaded in Chromium, but both web retrieval and application
capture failed. The app's preview showed **Ready to add** alongside **Unable to
capture posting. Paste posting text instead.** Saving created one job labeled
Unknown company / Untitled role, with the original URL retained. No model work
started. A separate read-only standard HTTP request returned 403; browser
accessibility did not establish that the backend fetcher could retrieve it.

Opening that saved job exposed the explicit **Paste posting text** fallback.
I copied the live role text, including pay bands and remote restrictions, into
that field and chose **Save job**. The same job recovered to the saved state
and exposed tailoring. I then entered Shutterfly, the exact role heading, and
a note identifying Spoonflower and the requisition through **Save job details**.
There was no duplicate job or manual database edit.

This recovery is useful. The simultaneous Ready to add and capture-failure
messages, followed by an anonymous saved card, still require users to
distinguish
saving a link from successfully capturing a posting. The fallback also needs a
separate details save to supply the missing employer/title.

Receipts:

- [Employer page](../walkthrough-output/shutterfly-live-2026-11-09/03-employer-settled.png)
- [URL preview failure](../walkthrough-output/shutterfly-live-2026-11-09/04-url-preview.png)
- [Fallback screen](../walkthrough-output/shutterfly-live-2026-11-09/06-capture-fallback.png)
- [Recovered posting](../walkthrough-output/shutterfly-live-2026-11-09/07-pasted-posting-recovered.png)
- [Saved details](../walkthrough-output/shutterfly-live-2026-11-09/08-saved-details.png)
- `public-fetch-diagnostic.json`

### 2. Structured pay loses all but the first regional band

Inputs retained remote status and a location reading Remote, United States.
It showed only **California: 117,750–166,000 USD (annual)**. The complete saved
posting contained six regional bands, including the lower Colorado band.
Read-only job data confirmed that only California entered the compensation
array. The displayed location array also contains Remote as a separate location
alongside the remote-policy field.

A small reproduction with California, a combined Colorado/Illinois/Minnesota/
Washington line, and Nevada likewise returns only California. The text fallback
breaks after its first salary-bearing line. Its short region-label regex also
needs examination for combined labels. The annual period is inferred from the
amount; the copied bands themselves did not explicitly state a pay period.
Retaining the full posting mitigates data loss, but a user relying on the
structured details can see the wrong applicable range.

This differs from SentiLink's missing salary in a JSON-LD-only description.
The updated extractor handles more sources, but preserving multiple regional
bands remains a separate gap. No salary or eligibility data was inferred into
the resume to compensate for it.

Receipts:

- [Inputs](../walkthrough-output/shutterfly-live-2026-11-09/09-inputs.png)
- `11-start-detail.json`, `compensation-reproduction.json`
- Implementation: `packages/cli/src/jobs/posting-extractor.ts`

### 3. Selection, preparation progress, and background traffic

The searchable picker found the explicit starting file. After **Prepare with
current inputs**, the captured-input panel showed its path, fingerprint, and
capture time. Its independent next-selection list still briefly displayed a
placeholder while loading; the captured source remained visible.

The progress card now agreed with persisted work: alignment with two dispatched
calls, then proposals with three. It retained the honest runner-default and
Tokens: Not recorded labels. Reloading preserved the active attempt without
another preparation request. History retained queue/start events.

In a 45-second window, 18 responses completed: nine current-job detail reads
and nine worker-control reads. No evidence, rubric, corpus, citation, or
integrity
refresh appeared in that window. This is a useful improvement over the broad
traffic observed previously. The windows are not matched performance benchmarks,
so the count does not establish a particular speedup or guarantee all watcher
paths are fixed.

The preparing page at 390px measured 385px wide without horizontal page
overflow.
This check does not yet evaluate the later question/editor surface.

Receipts:

- [Preparation progress](../walkthrough-output/shutterfly-live-2026-11-09/12-progress.png)
- `12-progress-detail.json`, `12-api-observation.json`
- [Captured input](../walkthrough-output/shutterfly-live-2026-11-09/13-captured-inputs.png)
- [History](../walkthrough-output/shutterfly-live-2026-11-09/14-history.png)
- [Reload](../walkthrough-output/shutterfly-live-2026-11-09/15-reload-active.png)
- [Mobile preparation](../walkthrough-output/shutterfly-live-2026-11-09/16-mobile-preparation.png)

### 4. Initial draft and technically successful checking

The initial attempt reached review after 297,976 ms, about five minutes. It
generated 18 operations: one summary rewrite, seven bullet rewrites, four
additions, five omissions, and one skills prune. Two bullet rewrites preserved
the exact earlier wording while attaching support. No consolidation or explicit
reorder operation was generated.

The draft found relevant work absent from the starting bullets: connector
configuration across APIs and UI, a Flight SQL/DataFusion client, Go user
lifecycles, and portal rollout/on-call scope. It kept frontend and developer
tooling as the career center rather than inventing a long Node/AWS backend
history. The rollout figures describe documented platform population, not
customers acquired personally or a measured reliability improvement.

Selection was useful, but the newly found Parable platform work still appeared
fourth through sixth. Two unchanged before/after cards added review noise.
The query bullet included low-level type names that were not necessary to
communicate its platform contribution. The app did not manufacture commerce,
GraphQL, AWS, DynamoDB, or search expertise to satisfy the posting.

All four initial semantic calls completed. The result had 16 claims: 14
supported and two needing clarification in one query-service passage. There
were no unavailable passages, failed batches, or technical retry requirement.
The claim strings include leading whitespace, which the current parser accepts.
Re-running the earlier fake-runner whitespace reproduction also completed for
both variants while leaving their unsupported facts unresolved.

The page distinguished two facts, one wording issue, and zero technical retries;
the passage panel correctly counted one affected passage. The initial attempt's
elapsed time stayed frozen at 4:57 after it ended for review, rather than
continuing to grow. This is meaningful progress on the earlier span, counter,
and timing problems, without establishing every delayed-response case.

Receipts:

- [First review](../walkthrough-output/shutterfly-live-2026-11-09/19-first-review.png)
- `20-initial-facts.json`, `20-initial-proposals.json`
- `claim-span-regression.json`

### 5. The checker misses details present in captured evidence

The two questions asked whether Andrew personally wired the client into the
analytics preview and implemented the named IPC downcasts. The explanation
said the truncated title did not establish those details. However, the full
captured summary and narrative contain them. The record was present in the
job's evidence; it was not simply missing from the workspace.

A read-only diagnostic explains a concrete filtering problem. The title is
80 characters and survives privacy processing unchanged. The summary changes
from 155 to 141 characters when a private ticket reference is removed; the
narrative similarly changes. The cloud-check source builder excludes an entire
field whenever privacy processing changes any byte. It therefore discards
those useful fields instead of supplying their safe content with valid source
offsets. The retained title and maintenance context do not establish the omitted
details, producing questions that look like gaps in the underlying evidence.

The exact raw model request was not separately captured. The saved source,
diagnostic, checker explanation, and inspected filtering branch establish the
selection problem; they do not justify weakening privacy protection or accepting
a fact without its supporting excerpt.

I narrowed the bullet to **Integrated a Flight SQL client over DataFusion into
the web-app query layer.** That retains a clear supported contribution, removes
unnecessary type-level detail, and permits conservative completion. The removed
details must not be described as false. A product fix needs safe excerpt/source
position mapping so privacy transformations do not hide relevant support or
remove negation and ownership qualifiers. It must not send the unredacted fields
or replace checking with a personal confirmation.

Receipts:

- [Query editor](../walkthrough-output/shutterfly-live-2026-11-09/21-query-editor.png)
- `query-source-filter-diagnostic.json`, captured evidence in
  `20-initial-proposals.json`, sources in `20-initial-facts.json`
- Implementation: `packages/cli/src/jobs/semantic-service.ts`

### 6. Skills inversion survives the implementation; its editor is unreachable

The new skills proposal states that it keeps verified delivery tools while
removing Docker. Its human-readable After lists five non-Docker skills. Its
`skills.prune.skills` array contains those five same values, which the contract
defines as removals. The actual complete draft consequently reads **Delivery:
Docker**. Changes now looks more convincing than before, but still contradicts
the applied candidate.

The current domain schema and validator support `before_skills` and
`result_skills`, but those optional fields were absent from this generated
operation. The actual `PROPOSALS_JSON_SCHEMA` supplied to the runner does not
include them. Optional domain checks cannot validate result intent that the
runner contract does not carry. The generation policy still reads
`accomplishments-1`; the observation does not establish a migration of all saved
proposal contracts.

Clicking the skills card's **Edit wording or evidence** did not expose skills
controls. The new editor component exists, but the unified surface constructs
its selectable rows from summary and employment passages. Selecting a skills
proposal ID has no corresponding row and falls back to the unresolved query
passage. This is a production integration gap that an isolated editor test can
miss.

I used the accessible **Undo change** action, which restored the captured
Delivery group. No skill was added. Docker remains an inherited resume
assertion;
undoing the faulty operation does not independently verify it. The final draft
still needs Andrew's approval and review of that inherited skill status.

The stronger fix must connect structured intent through the actual runner wire
schema, validate the applied result, render the actual list diff, and make the
skills editor reachable from the default review. It must preserve old
remove-list
semantics and avoid silently regenerating historical jobs.

Receipts:

- [Attempt to open skills editor](../walkthrough-output/shutterfly-live-2026-11-09/20-skills-editor-attempt.png)
- `20-initial-proposals.json`: `skills-delivery`
- Implementation: `packages/core/src/tailoring/schemas.ts`,
  `packages/core/src/tailoring/validators.ts`,
  `packages/ui/src/views/jobs/ResumeDraftSurface.tsx`, and
  `packages/ui/src/views/jobs/JobProposalEditor.tsx`

### 7. Mixed saving and reload recovery improve

I saved three changes together: the narrowed query bullet, rejection of the
incorrect skills prune, and a shorter inherited DFINITY release/testing bullet.
The inherited edit removed low-value migration-origin detail while preserving
the supported SDK/tooling contribution. The mixed autosave committed revision
two atomically and kept unrelated wording.

After reload, both wording changes and the skills decision were present. There
were no retained proposal recovery keys, false unsaved message, stale-review
alert, or reconciliation requirement. The earlier acknowledged-draft recovery
failure did not recur in this exercised path.

Rechecking the inherited edit introduced a question about calling LinkedUp a
reference application. I removed that qualifier rather than asserting a
personal answer. An inherited-only edit still required **Save draft**; the
automatic-save condition applies when both generated and inherited edits are
pending. All 14 passages then had saved support. No confirmation form or
project-fact save was used.

The ordinary correction record uses the app's `local-human` editor-actor label
even though these wording changes were made by the agent. That label must not
be confused with a human factual confirmation. The semantic clarification count
is checked separately at the end of this attempt.

The app automatically started continuation using saved review revision four.
It reused prior analysis/alignment instead of launching another generation
cycle from scratch. The final count of semantic calls before rendering was six,
with no technical failures or manual evidence retry.

Receipts:

- [Mixed edits](../walkthrough-output/shutterfly-live-2026-11-09/22-mixed-edits.png)
- `24-after-mixed-save.json`
- [Settled reload](../walkthrough-output/shutterfly-live-2026-11-09/26-settled-after-reload.png)
- [Qualifier removed](../walkthrough-output/shutterfly-live-2026-11-09/27-reference-qualifier-removed.png)
- `25-facts-after-reload.json`, `28-current-facts.json`

### 8. Automatic rendering succeeds; final Changes includes inherited edits

Continuation completed in 65 seconds, using one additional preparation model
call. The two attempts used four preparation calls in total: analysis,
alignment, proposals, and brief. Semantic checking is a separate six-call
ledger, with 130,677 ms recorded checker time. Tokens and cost were not
recorded.
From first preparation start to artifact creation was 11 minutes 17 seconds,
including agent inspection and editing pauses; this is not unattended latency.

The app created artifact `d0ac3a73-ef4d-4d4e-833a-e46079cb0699`. Validation
reported one page against a one-page budget, full fragment coverage, no missing
fragments, and no diagnostics. **Download PDF** completed through the browser
download event. The 202,083-byte downloaded file's SHA-256 matches the persisted
artifact PDF, rather than a newly rendered or substituted document.

Poppler independently reported one US Letter page. I extracted its text,
rendered it to PNG, and inspected the complete page. The serif layout is dense
but legible, with intact section rules, dates, bullets, and bottom skills rows.
The contact line wraps onto a second line without clipping. This establishes
basic readable structure and text preservation, not a predictive ATS score or
an accessibility certification; the PDF is untagged.

The final Delivery group contains all six inherited skills, consistent with
undoing the prune. The narrowed query and DFINITY release bullets appear in
the PDF. The default **Changes in this PDF** list prominently shows the
inherited DFINITY correction, its original Before and current After, and an
**Undo change** control. This addresses the previously missing inherited edit
in this exercised case. Five omissions appear together with rationale and
**Restore accomplishment** controls. I did not restore or undo content after
rendering, so this run does not verify overflow recovery or artifact-bound undo.

Reload retained the same artifact and correction card. Approval was initially
disabled while the preview was loading, then enabled once the actual page image
had loaded. The settled screenshot confirms that readiness transition; an early
visible image element alone did not establish a completed preview. The mobile
review shell measured 385px at a 390px viewport without horizontal page
overflow.
Its screenshot was taken before preview completion, so it does not establish
mobile PDF legibility or the mobile question editor's behavior.

The Checks panel plainly states **Validation: passed. Human approval: Not
approved for this version.** I did not click **Approve Resume**, change
application tracking, or create a saved release bundle.

Receipts:

- [Settled PDF review](../walkthrough-output/shutterfly-live-2026-11-09/36-final-settled.png)
- [Checks and approval status](../walkthrough-output/shutterfly-live-2026-11-09/31-final-checks.png)
- [Rendered PDF page](../walkthrough-output/shutterfly-live-2026-11-09/final-resume-page-1.png)
- `30-final-review.json`, `38-final-job-detail.json`
- `final-resume-extracted.txt`, `summary.json`

### 9. Alignment and interview preparation disagree with available context

The saved alignment classifies 23 requirements as nine backed, eight
transferable, and six gaps. It correctly distinguishes related API/SDK and Go
work from sustained Node.js backend, GraphQL, AWS, event-driven, database,
search, and commerce ownership. These distinctions are more useful than a
single fit score and should survive content polishing.

Two purported gaps need better input handling. The alignment says the digest
starts in 2017 and cannot establish ten years of experience, although the
selected resume contains dated employment beginning in October 2015. It also
has no candidate residence, although the captured contact block says Erie,
Colorado. The generated summary consequently removes the inherited eleven-year
claim, while the interview brief asks for tenure and residence confirmation.

The code explains the mismatch: `buildAlignmentPrompt` includes the evidence
digest and candidate-declared base skills, but omits the resume's employment
dates and contact location. The later proposal prompt receives the full base
resume and treats the earlier alignment as approved. This can turn unavailable
prompt context into a seemingly substantive gap.

A baseline date or address is not independent verification or a current
eligibility confirmation. The product should distinguish a declared fact,
an absent fact, a conflicting fact, and a fact requiring current confirmation.
It should reconcile captured chronology before calculating tenure, handle
gaps/overlaps explicitly, and ask a focused question when necessary. This run
does not establish a final total tenure or current eligibility for Andrew.

The automatic brief is persisted and visible deep inside **Details →
Comparison & evidence**. Yet the main **Interview brief** tab says **No saved
interview brief yet** and **First prepare a current resume**, despite the
current
validated PDF. Its selected source count settles at 131. There are two distinct
artifacts: the preparation brief and the separately generated optional job
material. The UI does not explain that distinction or direct the user to the
brief already generated. I did not spend another model call to generate a
second brief merely to make the tab look complete.

The hidden preparation brief contains useful anchor stories and honest gaps,
but also leaves metric-needed placeholders. Those remain private preparation
prompts, not invented metrics or text in the resume. The Comparison & evidence
view mixes long diff, structured evidence/alignment data, and rendered brief;
its body text is about 47,700 characters. Finding the useful brief there is
unnecessarily difficult.

Receipts:

- [Interview brief tab](../walkthrough-output/shutterfly-live-2026-11-09/35-settled-interview-brief.png)
- [Comparison and evidence viewport](../walkthrough-output/shutterfly-live-2026-11-09/37-comparison-evidence-viewport.png)
- `30-final-review.json`: alignment and `brief_markdown`
- `interview-brief.md`, `37-comparison-evidence.txt`
- Implementation: `packages/core/src/tailoring/context.ts`,
  `packages/ui/src/views/jobs/JobResumeReview.tsx`,
  `packages/ui/src/views/jobs/JobMaterialReview.tsx`

### 10. The full trace still shows broad terminal refreshes

The quiet active-preparation sample in section 3 does not describe the entire
run. Between 22:33:06 and 22:33:24 UTC, as preparation ended and review loaded,
38 responses completed. They included four reads each of evidence, rubric
list, gap analysis, and corpus, plus two integrity reads. No evidence, rubric,
or shared corpus fact was edited. Several broad groups recur about four
seconds apart. A subsequent reload aborted 11 in-flight requests.

Initial navigation, explicit reloads, inspector reads, normal polling, and
operational invalidation must be distinguished before assigning every request
to a watcher defect. The current log records endpoints and timestamps, not
independent initiating callbacks. Still, the repeated terminal refresh pattern
prevents closing the earlier refresh-scope acceptance based on the improved
45-second sample. There were no completed API responses with error status and
no recorded browser page errors; aborted navigation requests are a separate
category.

Receipt: `terminal-refresh-observation.json` and `browser-events.jsonl`.

## Regression assessment and remaining implementation work

These are observed acceptance results, not task-status changes. The previous
implementation packet remains historical; this run does not mark every item
complete because code or unit tests exist.

| Previous item | Result in this run |
| --- | --- |
| SL-BUG-001: Exact semantic spans | Passed the repeated whitespace reproduction and live checking; no technical semantic failure. |
| SL-BUG-002: Skills contract | Still fails on fresh generation; runner wire schema omits optional list intent and actual candidate contradicts After. |
| SL-BUG-003: Inherited PDF changes | Passed the exercised single inherited correction case, including prominent Before/After and undo control. Multiple corrections and undo were not exercised. |
| SL-BUG-004: Saved-draft recovery | Mixed save and acknowledged reload passed; no false recovery prompt. Lost-response and second-tab races were not exercised. |
| SL-BUG-005: Progress | Stage, call counts, and terminal timer agreed in observed preparation; continuation correctly shows its own one call and 1:05. |
| SL-BUG-006: Compensation | The prior JSON-LD-only branch was not exercised live. This posting exposes a separate multiple-regional-band text limitation. |
| SL-BUG-007: Refresh scope | Active sample improved; terminal broad refreshes remain. Initiators still need attribution. |
| SL-BUG-008: Review states | Saved claim and passage counts agree in observed states; delayed/out-of-order responses were not fully exercised. |
| SL-FEAT-001: Skills editor | Component exists but is unreachable through this live passage selector. Undo is the available recovery. |
| SL-FEAT-002: Accomplishment quality | Relevant absent work is found; role-specific ordering, no-op changes, and some low-level phrasing still need work. |

Prioritize the skills intent and editor integration together: a correct domain
validator cannot protect a fresh model operation when its required intent is
absent from the wire contract. Next, retain privacy-safe supporting excerpts
with valid provenance, reconcile candidate-declared chronology/location in fit,
and preserve every applicable regional salary band. Connect the preparation
brief to the job's primary navigation and explain its relationship to optional
materials. Attribute the terminal refresh groups before altering invalidation.

For future regression fixtures, use synthetic dates, locations, skill groups,
redacted ticket references, and multiple salary bands. Do not copy this career
workspace into public tests. Preserve exact source bindings, conservative
support decisions, old saved proposal semantics, and fresh approval after any
new PDF. This report supplies findings for implementation planning; no app fix,
tracker status, or remote issue is created by this run.

## Final state, receipts, and limits

The job is `resume_ready`, application lifecycle `not_started`, with one
unapproved artifact and no active attempt. There are 58 jobs after this run.
All 14 checked passages have persisted `captured_evidence` support. The
summary/employment checks do not independently verify every inherited skill,
date, or contact fact. Some captured evidence is itself candidate-reported.
There are
zero new job clarifications and zero resume-approval events. The global
clarification count remains 28 and the shared corpus remains revision four.
Hashes of the selected resume, runner configuration, and all three evidence
ledgers match the pre-run values. No source code was changed for this
walkthrough.

The semantic service reports `configuration_evaluated: false`. This denotes
absence of a passing saved configuration-suite evaluation, distinct from the
completed checks and exact evidence support for these passages. Export success
must not be presented as proof of general checker accuracy. The artifact has
no known shared fact conflicts; broader correction/reuse workflows were not
exercised.

Private receipts include:

- [Recorded walkthrough](../walkthrough-output/shutterfly-live-2026-11-09/session.webm):
  18 minutes 46.56 seconds, VP8, 800 × 554, 26,527,492 bytes.
- [Playwright trace](../walkthrough-output/shutterfly-live-2026-11-09/trace.zip):
  132,931,718 bytes, 3,686 entries; ZIP CRC verification passed.
- [Final state summary](../walkthrough-output/shutterfly-live-2026-11-09/summary.json),
  source fingerprints, consistent database backup, and build identities.
- Full-resolution screenshots, saved responses, live posting capture, isolated
  parser diagnostics, extracted PDF text, and a rendered page image.

The recording covers the app page; the employer page has separate screenshots
and text capture. It includes waits and investigative pauses, not a polished
demo. One full-page screenshot of the long Comparison & evidence panel failed
in Chromium; its text and viewport screenshot were captured successfully.
Temporary inspection scripts also required encoding/selector corrections;
those tooling errors are not app failures. The browser and trace were closed
cleanly after the final resume view was captured; the server remains running.

This run did not test real human confirmation, shared correction propagation,
cross-job updates, style reuse, legacy migration, consolidation undo, omitted
content restoration with overflow, or final approval invalidation after a new
edit. The employer application was not submitted. The PDF still requires
Andrew's review and approval, including inherited skills and declared facts.
