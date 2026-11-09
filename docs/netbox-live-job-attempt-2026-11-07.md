# Live job attempt: NetBox Labs, November 7, 2026

This is a real attempt in the Featherduster web app using Andrew's career workspace, an actual employer posting, the configured Codex runner, and the existing consent and preparation limits. It is not a synthetic browser fixture. Times below use America/Denver; the raw logs use UTC.

**Outcome:** the app produced a verified one-page resume after backend recovery, a classifier failure, and several factual wording reductions. The PDF was downloaded and survived reload. It remains unapproved, and the application has not been submitted. [Open the saved review](http://127.0.0.1:4174/jobs/1f68bca8-6d9e-4a22-a966-18b838433eff/resume) or [read the unapproved PDF](../walkthrough-output/real-job-2026-11-07/andrew-wylde-netbox-unapproved.pdf).

Implementation follow-ups are organized in the [bug reports and feature specifications](implementation/netbox-followups/README.md), with priorities, dependencies, acceptance criteria, and local Task Master mappings.

The [November 8 SentiLink walkthrough](sentilink-live-job-attempt-2026-11-08.md)
tests the updated app against a new role and compares the results with this
attempt's findings.

## Selected opportunity and fit

[Senior Frontend Engineer, Observability at NetBox Labs](https://jobs.ashbyhq.com/netboxlabs/0db9523a-da9a-43df-b62b-d02470910c06) was accessible in a browser with an application tab and application button. The posting includes US remote work and a US base range of $165,000–$195,000, plus equity and bonus. It was not among the workspace's 52 saved jobs. Its original publication date was not verified.

I selected it because its frontend and developer-platform responsibilities align with Andrew's work at Parable, Kong, and DFINITY. My assessment is a credible interview opportunity with specific gaps, rather than a guarantee of qualification.

| Area | Candidate evidence and assessment |
| --- | --- |
| React and TypeScript | Production UI delivery at Parable; Internet Identity frontend and identity-provider work at DFINITY. Strong match. |
| Build and release tooling | Kong Vite optimization, monorepo type-checking work, generated clients, reusable release actions, and npm publishing. Strong relevant evidence. |
| UI systems and accessibility | Parable shared components, ARIA/theme work and visual-regression baseline; Kong portal and Swagger UI accessibility fixes. Strong match. |
| API integration and identity | Generated SDKs, shared error handling, OIDC administration, login/session flows. Particularly differentiated fit. |
| AI-assisted engineering | Recorded agent-context tooling, guardrails, and skill distribution. Relevant experience; it does not establish every requested daily practice. |
| Telemetry visualization | Query inspection and data-product interfaces are adjacent. The record does not establish high-frequency dashboard rendering at fleet scale. |
| Exact tool versions and practices | Tailwind v4, specific state libraries, Module Federation 2.0, Lighthouse budgets, and network-discovery protocols need individual evidence or factual answers. They must not be copied into the resume to match the posting. |

The starting resume understates some relevant material: Kong's Vite and monorepo work and Parable's agent tooling appear in the ledger beyond the selected starting bullets. This makes the role useful for evaluating whether synthesis discovers relevant work absent from the resume.

A Mercury frontend developer-experience result initially looked promising in search, but opening its exact employer URL redirected to the general openings page with `error=true`. I excluded it. Search-index freshness alone did not establish an active vacancy.

## Method and receipts

- Browser: visible Chromium, Playwright, desktop viewport 1440 × 1000. Screenshots, browser event logs, and a finalized video record the session. Trace finalization failed, as described under automation limits.
- App: `http://127.0.0.1:4174`, workspace `C:/Users/drewk/career`.
- New saved job: `1f68bca8-6d9e-4a22-a966-18b838433eff`.
- [Open the saved job](http://127.0.0.1:4174/jobs/1f68bca8-6d9e-4a22-a966-18b838433eff/resume).
- Job creation, URL preview, navigation, and tailoring were performed through browser controls. Read-only database inspection and request profiling supplemented the investigation of failures.
- No employer application was submitted. No claim was confirmed on Andrew's behalf. No shared evidence ledger was edited by this attempt.
- Private receipts are under `walkthrough-output/real-job-2026-11-07/`. They contain career data and should remain local.

## Walkthrough

### 1. The existing app could not load jobs

The first Jobs page displayed **Host unavailable**, **The jobs host is taking longer than expected to respond**, and **0 jobs**. This workspace actually contained 52 jobs. The empty count was a loading/failure presentation, not an empty account.

The original backend process had been running since November 6. I saved a consistent SQLite backup using the database backup API, verified the process's workspace and port, and restarted it from the current build. Restarting alone did not resolve the failure.

Receipts:

- [Initial Jobs page](../walkthrough-output/real-job-2026-11-07/02-jobs-loaded.png)
- [Failure after the first restart](../walkthrough-output/real-job-2026-11-07/05-jobs-after-server-restart.png)
- `jobs-before.sqlite3`, `browser-events.jsonl`

### 2. Isolating the blocking request

With the browser temporarily away from the app, I measured requests individually and collected local CPU profiles. Health, job listing, evidence, corpus, and integrity checks returned successfully. Observed isolated timings were 3 ms for health, 4 ms for jobs, 90 ms for evidence, 89 ms for corpus, and 540 ms for integrity. A second sample measured worker control at 939 ms. These are individual observations, not benchmarks or service guarantees.

`GET /api/jobs/clarification-updates` exceeded a five-second diagnostic timeout. Its implementation inspected every job, including verification of historical PDFs and snapshots, before discovering whether there was anything to update. The workspace had four saved confirmations and no superseding corrections. The scan could never produce affected jobs in that state, yet the global Jobs page triggered it anyway. CPU samples showed substantial filesystem work.

I made one narrow recovery change: return the current corpus revision and an empty affected-job list immediately when the correction list is empty. An integration assertion verifies that this case does not enumerate jobs. The CLI build and all five shared-clarification workflow tests passed. After rebuilding and restarting, the Jobs page loaded its 52 jobs; the observed browser load took about 6.7 seconds.

This intervention is part of the attempt's history. The initial experience failed before that change. This fix does not establish that scanning a large workspace with real corrections is fast enough; that case remains a separate performance risk.

Receipts:

- `request-isolation.json`, `request-isolation-secondary.json`
- `server-stall.cpuprofile`, `server-secondary.cpuprofile`
- [Jobs after recovery](../walkthrough-output/real-job-2026-11-07/06-jobs-recovered.png)
- Implementation: `packages/cli/src/jobs/clarification-updates.ts`
- Regression: `packages/cli/tests/shared-clarification-workflow.test.ts`

### 3. URL intake and saving the position

I pasted the exact NetBox Labs URL into **Job URLs**, clicked **Preview**, waited for **Checking postings…** to finish, and inspected the preview. It correctly identified NetBox Labs and the role and showed **Ready to add**. Clicking **Add jobs** created the new position without starting model work. The new job link opened successfully.

The saved Posting page retained the original URL, final URL, capture time, and the substantive job description. Its displayed captured text started at the role description; the location and compensation blocks seen on the employer page were not displayed in that text. This loses useful screening context. The externally verified US-remote location and compensation remain recorded above.

Receipts:

- [Live employer posting](../walkthrough-output/real-job-2026-11-07/03-netbox-live-posting.png)
- [Successful URL preview](../walkthrough-output/real-job-2026-11-07/08-url-preview-result.png)
- [Saved Posting page](../walkthrough-output/real-job-2026-11-07/09-saved-job-posting.png)
- `netbox-posting.txt`, `job-link.txt`

### 4. Inputs and starting tailoring

I inspected **Inputs**, returned to **Posting**, and clicked **Tailor resume**. The button changed to **Starting tailoring…**, and the app navigated to the Resume page. It started preparation without a second start action.

The Inputs page initially displayed only the starting-resume placeholder. The options loaded later into a long native select, including duplicate `main` labels and duplicate option values. I did not make an explicit selection before clicking Tailor resume. The app used its implicit first-template fallback. Read-only inspection of the captured snapshot confirmed that it selected the intended `master` resume, with the current Parable/Kong/DFINITY history. Even during preparation, the Inputs page continued to show **Select a saved starting resume**, rather than the captured choice. The result was appropriate in this case, but the selection was not sufficiently visible or reviewable.

Captured configuration:

- Input snapshot: `313d0b97-d945-45bd-8f95-d3fa2f9b577f`.
- Runner: Codex, using the existing consent. The captured model field is empty, which delegates model choice to the runner's default rather than recording a named model.
- Page budget: one page.
- Preparation budget: four model calls, zero repair attempts, zero transport retries, and a 720,000 ms overall timeout. Semantic-check budgets are recorded separately by the application.
- Attempt: `2a4c3fe3-fc6a-4fc9-9ce9-2fc7d374d5fe`, started at 7:27:46 PM.

Receipts:

- [Inputs before preparation](../walkthrough-output/real-job-2026-11-07/10-inputs.png)
- [Tailor resume action](../walkthrough-output/real-job-2026-11-07/11-tailor-request.png)
- [Captured-input display during preparation](../walkthrough-output/real-job-2026-11-07/13-captured-inputs-during-preparation.png)
- [Retained history](../walkthrough-output/real-job-2026-11-07/14-history-during-preparation.png)

### 5. Progress visibility and background traffic

The main Resume page showed **Preparation claimed**, **Tailoring your resume**, and a general drafting/checking explanation. **Details** exposed categories such as Checks, Corrections, Comparison & evidence, and Version history, but the primary view did not name the current model stage or show elapsed time. Read-only persisted checkpoints showed preflight completed at 7:28:13 PM and analysis at 7:29:19 PM. The analysis interval is not a pure model-runtime measurement; it includes surrounding work and possible scheduling delay.

There was another interval of **Host unavailable** during preparation and one diagnostic read received a connection-refused error; a subsequent listener check showed the same backend process still running. This was transient availability evidence, not proof that the backend crashed. Reloading eventually recovered the job view and retained the active attempt.

In a 45-second observation window, the browser completed 80 API responses, including repeated evidence, rubric, corpus, integrity, and tailoring-index requests while the Resume page was open. Source inspection explains a plausible amplification path: the watcher includes operational workspace files, emits each change separately, and global live-sync callbacks refresh broad datasets. I did not disable the watcher or suppress requests to make the walkthrough look successful. The exact contribution of that traffic to preparation delays remains unmeasured.

The global audit badge also moved from **0 Issues** during initial loading to **561 Issues** after auditing. Those issues concern the wider career workspace and historical material, not 561 failures in this new resume. Their prominence makes the current job's health harder to interpret.

Receipts:

- [Preparation progress](../walkthrough-output/real-job-2026-11-07/12-preparation-progress.png)
- [Observation window](../walkthrough-output/real-job-2026-11-07/17-preparation-observation.png)
- `17-api-timings.json`, `browser-events.jsonl`
- [Expanded Details](../walkthrough-output/real-job-2026-11-07/18-preparation-details.png)

## Completion and review

### 6. Initial generated draft and failed classification

The first preparation reached review around 7:33 PM. It generated 13 operations: five rewrites including the summary, four additions, three omissions, and one skills reorder. No consolidation was generated. That branch was not exercised by this generation.

The additions were relevant discoveries beyond the starting bullets: Time Spend visualization and drill-down work, connector-management status interfaces, Kong Vite optimization, and Cypress API-mocking architecture. The omissions made reasonable relevance choices: some authentication, infrastructure-testing, and wallet content gave way to those frontend examples. Source mappings and before/after text were available under Evidence and Changes.

Writing quality was mixed but useful. The API error-contract and Vite bullets described recognizable engineering changes with technical detail. The Time Spend and connector-management additions identified coherent product capabilities, although their long feature lists could be tightened. The Kong architecture rewrite was careful to describe interface specifications rather than claiming they were implemented. The generator did not assert high-frequency fleet rendering, adopt unverified charting libraries, add Tailwind v4, or invent performance percentages.

The review also exposed a substantive synthesis error: the authoring rewrite connected independently documented editor components and scheduled-report controls to Plot authoring without evidence establishing that relationship. The classifier correctly asked about the relationship.

The initial fact result contained 19 claims: nine supported, two needing clarification, and eight unavailable. Classification stopped on **Classification returned invalid structured data. Retry or review facts manually.** The third semantic call failed; the previous two batches' supported results were retained. The unavailable passages included important Kong and DFINITY accomplishments and the two earlier-employer bullets. An unavailable result did not demonstrate that those accomplishments were false.

The page simultaneously showed **Review facts (14)**, **10 passages need attention**, and **9 of 19 resolved**. These counters appear to have different bases, but the page did not explain how they relate. The exception list usefully distinguished **Needs your answer** from **Needs retry**; the overall header and count made the situation harder to summarize.

The two answerable questions were:

1. Whether **Senior Software Engineer** was Andrew's formal title, and at which employer.
2. Whether the recorded editor components were parts of the particular authoring workflow named by the new bullet.

I did not use a confirmation button for either question. The title is already in the starting resume, but repeating it there is not a separate human confirmation. Existing shared-answer support did not resolve this generated summary claim.

Receipts:

- [Initial resume review](../walkthrough-output/real-job-2026-11-07/20-review-or-status.png)
- `generated-proposals.json`, `initial-facts-response.json`

### 7. Conservative wording edits, saving, and retry

Through **Edit wording or evidence instead**, I replaced the summary's formal-title assertion with a general frontend-engineering focus and shortened the authoring bullet to **Built Plot authoring interfaces with live query results.** Both changes were saved to the job-specific draft. The app clearly reported that the wording was saved while checks were still pending. Reloading retained both edits. At a 390-pixel viewport, the document width was 385 pixels, so there was no horizontal overflow in the observed review state. The resolution panel is long and requires substantial vertical scrolling.

The save initiated another evidence check without regenerating the proposal set. That check completed and left three factual questions across 20 claims, with 17 supported:

- Publishing a typed SDK did not by itself establish consuming typed APIs in an application.
- Performing accessibility remediation did not establish that a follow-up WCAG audit cleared all blockers across both surfaces.
- Session restoration was documented, but its relationship to the named identity application/package was not established.

I narrowed the summary toward the published SDK and used job-local starting-resume corrections for the two inherited bullets. These corrections retained the shared master resume and source ledger. This exposed a limitation of editing several passages: generated wording uses the main **Save draft** action, while each inherited passage has its own **Save starting resume for this job** action. There is no single visible commit for that mixed batch, so sequential saves can start or supersede checks while the user is still editing.

My first SDK edit introduced an unsupported plural, **published TypeScript SDKs**. The next classifier pass correctly asked which other SDK Andrew had helped publish. I corrected it to **a published TypeScript SDK**. My first accessibility revision still implied that all listed changes belonged to a WCAG audit; the checker asked about that relationship too. I removed the audit-wide association and retained the concrete semantic HTML, labels, and focus improvements. This is an agent writing failure caught by validation, not evidence that all conservatively intended edits are automatically supported.

Other useful failure evidence surfaced during editing:

- The original generated summary had claim bindings for its factual phrases, but not for connective words such as **Experience spans**. The deterministic validator requires coverage of every letter and number. It blocked the rewrite with **Map every generated claim and qualifier to supporting evidence**, even when most factual clauses had passed semantic checks. Ordinary wording edits clear those generated bindings and cause fresh checking, which provided a recovery path here.
- The displayed intended draft omitted the starting summary's **11 years**, but the selected exception still showed **Numbers not supported by cited verified evidence: 11**. This comes from the retained starting summary when the proposed rewrite is blocked. The preview and validation basis are difficult to distinguish.
- During a check, passage progress temporarily read **0 of 16 passages resolved** while fact progress retained supported claims. Some nested guidance still offered running/retrying a check while the page-level guidance said to wait. This can make persisted progress look lost or invite an unnecessary extra check.
- A transient **Needs retry** message changed back to **Checking** before an automation click reached it. I did not treat the resulting locator timeout as a separate backend failure.

Receipts:

- [Saved conservative edits](../walkthrough-output/real-job-2026-11-07/22-conservative-edits-saved.png)
- `23-mobile-and-reload.json`
- [Mobile resolution panel](../walkthrough-output/real-job-2026-11-07/24-mobile-exception-top.png)
- `after-edits-facts-response.json`, `26-facts-after-three-edits.json`
- [Further factual narrowing](../walkthrough-output/real-job-2026-11-07/27-final-factual-narrowing.png)

### 8. Actual PDF, download, and final disposition

The final wording passed with 16 of 16 passages supported. No human factual answer or shared confirmation was entered. Semantic checking dispatched eight calls over the attempt, with 240,202 ms of recorded semantic-call elapsed time; that total includes the malformed-response failure. The usage record did not provide token or monetary totals. Existing limits were retained throughout.

The app automatically continued from the saved review. It reused analysis and alignment checkpoints, retained the edited proposals, generated the interview brief, and rendered and verified the resume. The continuation began at 7:42:11 PM and reached **Validated candidate ready** at 7:45:50 PM. The UI retained a generic preparation message during much of that interval. The first Tailor resume action to PDF-ready interval was about 18 minutes, including manual edits, diagnostic work, and observation pauses; this is not an unattended performance benchmark.

The real renderer's report passed:

| Export check | Result |
| --- | --- |
| Page count / selected budget | 1 / 1 |
| Expected-text coverage | 100% |
| Missing fragments | None |
| Export diagnostics | None |
| Independent `pdfinfo` inspection | One US Letter page, 201,464 bytes |
| Text extraction | Readable output obtained with `pdftotext -layout` |

I inspected the actual rendered page. The resume fits one page, retains all five employment headings and education, and uses conventional headings and selectable text. The contact block wraps the LinkedIn URL to a second line, and the experience section is dense but readable. No large clipped region or missing text was apparent. Text extraction and truthful terminology provide evidence of basic machine readability; no predictive ATS score was calculated.

I clicked **Download PDF** in the web app. Download succeeded while **Approve Resume** remained available. There were zero approval events, and application lifecycle remained `not_started`. Downloading did not mark the position applied. The saved artifact ID is `66267036-4498-4ab1-b7f3-57e8d951edb4`.

The final page exposed additions and rewrites with before/after text and three omitted accomplishments with restore controls. I inspected those controls without restoring content into another version. It also exposed **Edit resume**, **Open PDF**, and the separate approval action.

One final-review gap remains: my job-local corrections to the inherited Kong accessibility and DFINITY identity bullets were not separately listed among the prominent generated changes. The full comparison's "before" is already the corrected job-local base, rather than the original captured master. Their earlier wording remains in correction history, but the visible final summary does not make those two substantive reductions easy to see. Approval review should include correction history or compare against the original snapshot as well.

Editorially, the result still has room to improve. For this role, I would elevate the Time Spend visualization/drill-down accomplishment within Parable and move Vite/testing strengths higher within Kong. They were discovered but placed relatively low. The connector-management and analytics bullets still read partly like feature inventories. Supported wording and export success are useful gates; they do not establish that the resume's ordering is optimal for a hiring manager.

The final artifact is an **unapproved resume draft**. Andrew can inspect it in the app and make the final approval decision. The position has not been submitted to the employer.

Receipts:

- [Final PDF and visible change summary](../walkthrough-output/real-job-2026-11-07/30-final-pdf-and-changes.png)
- [Unapproved PDF downloaded through the app](../walkthrough-output/real-job-2026-11-07/andrew-wylde-netbox-unapproved.pdf)
- [Rendered page](../walkthrough-output/real-job-2026-11-07/final-resume-page-1.png)
- `final-artifact-review.json`, `final-resume-extracted.txt`, `summary.json`
- [Final review after reload](../walkthrough-output/real-job-2026-11-07/32-final-after-reload.png)
- [Session video, about 27 minutes and 131 MB](../walkthrough-output/real-job-2026-11-07/video/page@132c9d8687c41fd73938dd11de6328c0.webm)

## Prioritized findings

| Priority | Finding | Practical implication and next improvement |
| --- | --- | --- |
| P0 | A global correction scan performs expensive historical verification when no corrections exist. | It blocked the entry screen in this workspace. The empty-correction fast path is fixed and regression-tested. Large scans with actual corrections still need bounded work and measurement. |
| P1 | A malformed classifier response stops later batches. | Important supported-looking work becomes unavailable. Preserve the successful batches, identify the failed batch plainly, and offer a focused retry. The current error gives no actionable detail about which structured field failed. |
| P1 | Intended preview and validation basis diverge when a rewrite is blocked. | Users can see an error about **11** while the displayed summary contains no number. Show the exact wording being validated and distinguish retained baseline failures from proposed wording failures. |
| P1 | Claim-binding coverage includes connective language. | A semantically supported summary can fail a token-coverage rule. Make the generation contract and validation error concrete enough to repair the uncovered span without a vague mapping exercise. |
| P1 | Broad refresh traffic occurs during local preparation. | A 45-second window completed 80 API responses; many browser-aborted requests also appeared during navigation and preparation. Coalesce filesystem notifications, filter operational artifacts, and avoid refreshing unrelated hidden screens. The abort count is not a count of independent server exceptions. |
| P1 | Final Changes does not prominently include inherited-wording corrections. | The comparison baseline has already adopted the job-local corrections. Expose those corrections alongside generated edits or compare against the original captured resume, so the final PDF approval has a complete visible summary. |
| P2 | The chosen default resume is absent from the Inputs display. | This run correctly captured master, but users cannot readily verify the fallback choice. Display the resolved file and distinguish current selections from captured inputs. |
| P2 | The resume picker is long and contains duplicate labels/values. | Choosing the wrong historical variant is easy. Use searchable entries with paths, modified dates, and unique identities. Wrong-file selection was not demonstrated in this run. |
| P2 | The saved posting view omits location and compensation metadata. | Users can lose essential eligibility and salary context after intake. Preserve the employer page's structured screening information. |
| P2 | Progress and next-action messages use different counting/state bases. | A header can request facts while the current activity is a check or export; passage progress can reset while saved factual support remains. Explain each count and derive nested guidance from the same current operation. |
| P2 | Mixed original/generated edits require several save controls. | Fixing related exceptions can initiate or supersede checks between saves. Offer a reviewable batch save or a clear distinction between saving and starting the next check. |
| P2 | Global audit findings dominate a single-job flow. | **561 Issues** requires context; it is not the current job's failure count. Label workspace-wide findings and give the job's blockers greater prominence. |

Positive controls also mattered: supported additions appeared without individual acknowledgment; source mappings and omission rationales were inspectable; saved local edits survived reload; technical failures stayed unresolved; no approval was inferred from machine support; and the checker caught relationship, outcome, and singular/plural overclaims.

## Automation pitfalls and limits

These are separated from product failures:

- The Playwright skill directory could not resolve Playwright initially. I reused the repository's installed dependency through `NODE_PATH`; I did not install or change dependencies.
- The default server detector omitted port 4174. Supplying that port and checking the owning process identified the career app. Another detected service on 8080 was not used.
- An exact `getByLabel('Passage to review')` locator timed out because the wrapped label's accessible text included its options. A combobox role with a name pattern worked.
- An early save observer waited for a POST URL ending in `/save`; the app actually saves proposal revisions with PUT. The observer printed an undefined status, but the visible saved-revision message and reload check proved that the edits were persisted. Later observers used the actual method and URL.
- A transient retry button disappeared as checking resumed. Its locator timeout is an automation timing issue, not another failed user action.
- Screenshots captured immediately after navigation can show loading state. The report uses later settled states for conclusions about saved data and job counts.
- Browser shutdown reported **tracing.stop: Target page, context or browser has been closed**. The resulting trace archive is incomplete and cannot be opened as a valid ZIP; it was retained as `trace-incomplete.zip` for diagnosis and is not offered as a usable trace. The WebM video finalized successfully; `ffprobe` reports 1,635.56 seconds and 130,622,373 bytes. Screenshots, saved UI text, JSON responses, and that video are the usable receipts.
- This single real job does not verify the shared-correction workflow with actual supersessions, every overflow-replacement path, or every historical resume. The narrow recovery patch passed the existing five-test shared-clarification suite; I did not rerun the whole repository suite for this one-line guard.
