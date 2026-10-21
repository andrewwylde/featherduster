> **Latest preview/evidence repair:** see **Desktop preview readiness and current engineering evidence** below. Current evidence is `preview-current-02/automatic-resume-browser.json`, including current source-bound build/test logs and visibly painted desktop PDFs. Prior reports remain intact; independent delivery re-review is still required.

> **Latest capture recovery:** the ECONNRESET investigation and three successful full repetitions are recorded in **Capture transport recovery** below. Current evidence is `capture-recovery-03/automatic-resume-browser.json`; the original running-server identity still matches. Independent delivery re-review remains required.

> **Repair update after independent review:** the original report below is retained in full as historical evidence. The independent reviewer rejected the prior narrow layout and evidence coverage. The current repair and new capture are recorded in **Independent-review repairs** at the end of this document. Independent re-review remains required; earlier pass/readiness statements do not override that gate.

# Automatic resume preparation: implementation verification

## Scope and acceptance boundary

The approved [design](../specs/2026-10-20-automatic-resume-preparation-design.md) and the complete retained delivery contract remain authoritative. This report records implementation and engineering observations, not independent delivery acceptance or a production rollout. The original handoff plan remains unchanged at `adws/adw_data/sessions/auto-resume-20261020/context_handoff/plan.md`; its complete requirements are retained in the [repository plan](../plans/2026-10-20-automatic-resume-preparation.md).

**Independent review is pending.** In particular, `actual-interface` is not independently verified by this builder. The subsequent outcome gate must inspect the actual screenshots, trace and persisted outcomes, rather than accepting these implementation notes as a review.

## Reproduction

From the repository root, after `npm run build`:

```sh
node scripts/capture-automatic-resume-delivery.mjs --manifest <absolute-evidence-directory>/manifest.json --evidence-dir <absolute-evidence-directory>
node scripts/capture-automatic-resume-delivery.mjs --identity --manifest <absolute-evidence-directory>/manifest.json
```

Use a fresh evidence directory. Capture creates its own marked OS-temporary workspace and ephemeral loopback server. Only model responses and deliberate outage/approval-response injections are fixtures. The application, HTTP routes, SQLite persistence, coordinator, semantic source bindings, LaTeX generation, Poppler inspection, PDF-derived page images and browser interactions are real. The identity probe does not initialize workers or write captured evidence.

Final builder capture:

- [Manifest and evidence directory](../../../adws/adw_data/sessions/auto-resume-20261020/browser-evidence/manifest.json).
- `fixture.json` identifies the disposable workspace and all seven jobs; retain that workspace for fresh identity probes.
- `observed-outcomes.json` contains current and historical artifacts, exact revisions, worker reservations, human records, approvals and mutation receipts.
- `model-dispatches.json` records actual fixture dispatches by operation and subject, not a global response sequence.
- `interaction-journal.json`, `trace.zip`, `trace-actions.jsonl`, `trace-network.jsonl` and `trace-api.jsonl` retain actual actions and API outcomes.
- Each published PDF has independent `*-coverage.json`, `*-text.txt` and `*-pages.txt` observations. The failed overflowing render remains bound in the repair record, not misrepresented as an accepted PDF.
- `delivery-metrics.json` records questions asked, grouped duplicates avoided, stale members rejected, bounded cycles and checked Undo.
- `retrieval-mismatch-probe.json` proves that a text-only query misses the captured orchestration record, while explicit citation/work context retrieves it for an exact-source-bound classification of release automation; retrieval hints alone do not grant support.

## Engineering checks

Logs are under [engineering-checks](../../../adws/adw_data/sessions/auto-resume-20261020/engineering-checks/).

| Command | Result |
| --- | --- |
| Focused core, coordinator, repository, questions, repair, queue, facts and Details Vitest runs | Exit 0 after the recorded repairs |
| `npm run build` | Exit 0; existing bundle-size/eval warnings remain |
| `npm test` | Exit 0: 139 files, 1636 passing tests, one existing Windows symlink-permission skip |
| `node --check scripts/capture-automatic-resume-delivery.mjs` | Exit 0 |
| Declared browser capture command, both retained scenarios | Exit 0, within its 600-second deadline |
| Fresh identity probe | Exit 0; identities match the captured manifest |
| Identity regression in disposable clones | Saved edit changes outcome identity; changed PDF bytes are rejected with exit 1; failed probe preserves evidence |
| `git diff --check -- packages scripts docs/superpowers` | Exit 0 |
| Unscoped `git diff --check` | Exit 2 from the pre-existing dirty `package-lock.json` CRLF whitespace; left untouched |

The tracked dirty TaskMaster file, guide and lockfile retain their initial hashes. The pre-existing SSSF database continued changing during this workflow; no feature command targeted it, and this report does not attribute those changes to an unproven cause. All feature databases were in disposable workspaces. Neither the live career workspace nor the live port 4173 server was used or restarted.

## Retained criterion observations

These are engineering observations for independent review, not independently issued pass verdicts.

| Retained criterion | Observed evidence and next user action |
| --- | --- |
| **automatic-preparation** | Seven jobs are selected in non-display-sort order through Saved jobs. Three reach current verified PDFs without any proposal/check/Continue navigation. Cited captured evidence supports the retained implementation after leadership removal; skills reorder retains only existing entries. A real overflowing PDF is repaired by deleting repeated complete sentences, then reclassified and re-rendered. Metric, missing citation, privacy, duplicate bullet, unsupported skill and missing-PDF-text probes remain blocking. See `desktop-ready-and-changes.png`, `desktop-technical-recovery.png`, PDF reports and repair records. |
| **focused-questions** | Two equivalent feature questions receive one scoped answer with separate human-provenance job-local records. A forged project binding is rejected. The next equivalent question demonstrates partial saving with a stale job excluded; its unresolved text remains editable. The displayed captured prototype sentence can be selected as narrower wording without confirming production deployment. The material omission is initially deferred while other jobs finish, then explicitly decided separately from final PDF approval. See question screenshots, API journals and clarification/decision rows. |
| **bounded-recovery** | A transient alignment failure succeeds on its one retry. Another job exhausts its one retry and exposes technical recovery, not factual attestation. Cycles reserve calls before dispatch and cap repairs at two and retries at one under the captured policy. Selection waits for the existing worker slot. Replaying selection/answer/approval requests and refreshing the browser do not dispatch duplicate model work. See cycle/operation records and model dispatches. |
| **editing-and-targets** | Reorder precedes the wording repair; the final release bullet and caching bullet remain correctly targeted and skills do not gain an invented capability. Undo forks and saves a checked draft edit; restored unsupported leadership needs a human answer before a new PDF is published. During a separate checker outage, the canvas still saves and returns to the same queue item. The old displayed PDF is labelled refreshing and cannot be approved. See `*-undo-checked-edit-refreshing.png`, `*-save-during-checker-outage.png`, `*-stale-pdf-during-outage.png` and the corresponding new PDF screenshots. The next question field is typed into while a preceding refresh is deliberately held open. |
| **final-review** | The existing real PDF preview and secondary Details component are reused. Queue items retain selection order, company/role, original posting links, before/after changes and explicit omission history. Newly ready work does not steal the current item. Review later reaches an all-deferred state; explicit revisit remains available. Technical work for other jobs is collapsed away from the central resume. See desktop/narrow ready, Details, all-deferred, completion and approved-omission screenshots. |
| **approval-separation** | An injected 409 keeps the displayed item selected. A successful exact-artifact approval advances; replay creates no additional approval. After Undo and after canvas editing, a new PDF requires fresh approval; previous approvals stay historical. Direct stale-artifact approval is rejected while a newer working draft exists, even without a job revision change. A separate unapproved download does not approve or submit anything. Every application lifecycle stays `not_started`, shared resume/evidence hashes remain unchanged, and shared corpus revision stays zero. |
| **actual-interface** | Builder inspected real desktop/narrow captures and exercised the UI, including keyboard Details. **Independent reviewer verdict still required.** Review full-resolution captures together with the actual trace and API/DB bindings against `JobResumeReview.tsx`, `JobFacts.tsx` and the approved design. |

The final fixture ends with two current approvals, three deferred current PDFs and two technical/input-recovery jobs. The material omission was demonstrably unanswered while the other jobs progressed; its later explicit content decision produces another unapproved PDF and a visible omission summary. No batch auto-approval, application submission, shared evidence learning or provider escalation was introduced.

## Repairs and focused reproductions

Earlier evidence is retained; it is not replaced by the final successful capture.

1. **`browser-01`:** structural repairs were initially applied to immutable generated output. The repository rejected the mismatch. Repairs now use fenced worker overlays and preserve raw generation bytes. The read-only corpus loader was also updated to recognize the additive version-6 migration.
2. **`browser-02` / `browser-03`:** repeated exact-label lookup failures prompted a focused Playwright reproduction, saved as `context_handoff/textarea-locator-reproduction.json`. A wrapping label containing initial textarea text yielded zero exact-label matches but one accessible textbox match. Explicit label/control association fixes that cause. Stable question identity and visibility during refresh also preserve the active editor; those changes are not presented as the proven cause of the label failure.
3. **`browser-05`:** a heading locator also matched a technical recovery heading. The capture now targets the exact company/role heading.
4. **`browser-06`:** a delayed route was removed before its handler finished. The capture now waits for owned handlers after releasing the gate.
5. **`browser-07`:** answering after checked Undo changed the semantic revision while reusing the old semantic-request key. The follow-up request now binds the new semantic head without resetting the cycle budget. A service regression covers Undo, answer, automatic new PDF and historical approval.
6. **`browser-08`:** the existing Candidate Profile editor was collapsed. Capture now opens that actual UI before editing; no fabricated field or alternate editor was substituted.

A later focused queue test/capture initially used `History` instead of the existing menu label `Version history`. Its locator was corrected; the product convention was not renamed. Saved-job and worker-review links now open the actual batch question route, and mechanical repair history is available under the existing Details → Version history view.

The prompt mentioned an earlier malformed edit/fetch failure, but no earlier build-history report was present to establish its cause. Current source was inspected instead of replaying that call.

## Independent-review repairs (2026-10-21)

The complete independent report is preserved at `adws/adw_data/sessions/auto-resume-20261020/delivery_reviewer/envelope.json`, and the previous builder report is preserved in `context_handoff/delivery-build-history.json`. The retained contract and original plan are unchanged. Passing criteria from that review remain in scope; this repair does not reduce the checkpoint to the four findings.

Current engineering capture: [repair-review-02/manifest.json](../../../adws/adw_data/sessions/auto-resume-20261020/repair-review-02/manifest.json). It retains both `batch` and `review`, including all previously demonstrated question, editing, targeting, deferral and approval flows.

| Independent finding | Source repair and observed proof |
| --- | --- |
| Details menu clipped offscreen | The existing menu remains keyboard accessible and uses its original labels and Back-to-resume focus behavior. Its narrow container is now full-width, left anchored and width bounded, rather than right anchored to a small left-side button. `narrow-details-menu.png` shows all five items. The journal independently measures all item rectangles and checks actual hit targets inside the viewport and above mobile navigation. |
| PDF displaced below controls | Queue progress/navigation are an explicit collapsed disclosure. Meaningful before/after wording remains visible, with reason and Undo in a local disclosure. Only Approve & next, Review later, version status and Details precede the PDF; edit, download and reload follow it. The real PDF begins at **541 px** in the 375×850 viewport (`narrow-pdf-position` in the journal), rather than below approximately 1,000 px. The actual screenshot remains required review evidence; the bound is a regression check, not an aesthetic verdict. |
| Publication guard proof missing | `publication-guards.json` records independent metric, missing-citation, privacy, duplicate-bullet and unsupported-skill probes through normal HTTP save/check/finalize routes. Each bad candidate saves, receives its specific blocking check, and is rejected by actual finalization with HTTP 409 and the checks explanation. Artifact membership remains unchanged. An explicitly prepared, unselected supplemental job isolates these destructive probes from the main seven-job queue. The missing-text verifier probe and real overflow repair remain present. |
| Configured ceiling not demonstrated | Newly captured automatic policies read optional lower limits from `.featherduster/config.yaml`. `configured-budget-exhaustion.json` proves a captured limit of one call: analysis dispatches once, alignment cannot dispatch, zero PDFs publish, replay does not reset the budget, and no factual question is created. Desktop/narrow screenshots show the actual technical recovery actions. The disposable configuration is restored afterward; captured policy remains immutable. |
| Worker contention not demonstrated | Before the first selected analysis completes, the fixture deliberately holds that actual runner request. `worker-contention.json` shows one active fenced worker, six pending selected members, no worker-busy factual question, and still exactly one dispatch after repeated reloads and duplicate batch delivery. Releasing that owned latency gate lets the normal coordinator complete the remaining jobs. No concurrency guard was removed. |
| Identity used a replacement deployment | Capture launches one detached, marked disposable host. Its origin, PID, start time and random instance ID are retained in `fixture.json`. The host continues serving for independent inspection; `--identity` only queries that original host and never constructs an application or replacement server. It re-verifies current PDFs, required queue/approval outcomes and supplemental non-publication outcomes, then compares freshly observed identities. Loss of the host, process/instance replacement, changed served assets or regressed outcomes fails the probe. |
| Outcome-regression rejection missing | `identity-regression.json` records exit 0 before a real checked Undo and exit 1 after Undo invalidates a current approved artifact. Both probes query the same original server PID and instance. Historical approval remains, but cannot satisfy the required current approval. The failed probe leaves the baseline evidence unchanged. The ordinary question/answer/new-PDF/fresh-approval flow then restores the user-facing outcome before the final capture. |

### Current checks

- `npm run build`: exit 0.
- `npm test`: exit 0, **1,638 passing tests**, one existing Windows permission-related skip; no new acceptance tests skipped.
- Focused queue/Details, budget and observation tests: exit 0.
- Declared browser capture: exit 0; **90 captured artifacts** in the current manifest.
- Declared identity probe: exit 0 against the original still-running captured host; fresh identities match.
- Task-scoped diff check: exit 0. The excluded, previously dirty lockfile remains untouched; the unscoped check still reports its existing whitespace.
- Logs and the fresh identity response are in `adws/adw_data/sessions/auto-resume-20261020/repair-engineering/`.

The first repair capture (`repair-review-01`) also remains available. Its narrow layout assertions passed, but an old capture loop mistook a transient loading state for queue exhaustion after moving the host to a separate process. The saved failure trace shows the next resume loaded normally. The capture now waits for the previous heading to leave and the next actionable item or all-deferred completion; it no longer relies on a 100 ms sleep or silently exits on a temporarily absent button. This was a capture synchronization repair, not a change to queue deferral policy.

### Host lifetime and cleanup

The current capture's host is intentionally **not closed on successful capture**, because a subsequent identity check must inspect the actual captured deployment. It uses an OS-temporary marked workspace and an ephemeral loopback port, never port 4173. It expires after two hours. Once the independent gate is finished, the owner may stop only that host by POSTing `{ "shutdown": true }` to the `host.origin + '/__automatic-resume/control'` endpoint with the `x-fixture-token` from that capture's `fixture.json`. A later identity check must fail after shutdown; restarting a substitute is not supported. On capture failure, the capture closes its own host.

Optional automatic ceilings for new input snapshots:

```yaml
automatic_preparation:
  max_model_calls: 12       # integer 1..12; may only lower the default ceiling
  max_repair_attempts: 2   # integer 0..2
```

These limits include generation and semantic dispatch reservations and do not raise older captured policies, grant consent, switch providers, approve resumes or submit applications.

**Remaining independent gate:** a reviewer must re-inspect the new actual narrow/desktop screenshots and interaction/API/outcome records against every retained criterion. These engineering repairs do not self-issue a passing `actual-interface` verdict. No live career-workspace rollout was attempted.

## Capture transport recovery (2026-10-21)

The later independent capture failed with `TypeError: fetch failed`, cause `read ECONNRESET`, after 100.516 seconds. Its complete original log and failure artifacts remain unchanged at `context_handoff/delivery-evidence-5e47107f22ac40b3894f8ab4f46f7b1f/`. The original plan, full build history, independent findings and all earlier reports above remain in scope.

### Focused investigation

Before changing transport behavior, a diagnostic-only full reproduction failed at the same boundary. `capture-reset-profile/full-repro-01/failure.json` locates the error at **GET `/__automatic-resume/identity` immediately after the expected failing identity subprocess**, not at preparation, rendering or approval. That child correctly rejected the lost current approval with exit 1 after 5,506 ms. The parent's next GET started one millisecond after child completion and failed with ECONNRESET three milliseconds later.

`full-repro-01/host-connections.jsonl` shows connection resets around that child exit, while the original host stayed running until the capture's subsequent explicit cleanup. There was no observed host exception or replacement. The simpler idle-only and synthetic-reset mini-profiles in `capture-reset-profile/observation.json`, `controlled-observation.json` and `controlled-post-observation.json` returned successful probes; they did **not** establish a timeout-only explanation. The precise Windows/TCP reason for the reset is not claimed. The full reproduction establishes the vulnerable pooled-connection/subprocess boundary, and `capture-reset-profile/comparison.json` preserves the before/after observations.

### Small transport repair

- All capture-owned Node HTTP requests now use a shared loopback-origin-bound helper with `Connection: close`. Completed responses do not leave pooled idle sockets to reuse across long child-process probes. The original host, origin, PID and random instance checks are unchanged.
- No capture-level HTTP retries were added, especially for ambiguous saves or approvals. An actual reset still fails with method, URL and causal code, rather than replaying an operation or starting another server.
- HTTP request starts/errors, identity-child timing and owned-host connection/exit diagnostics are retained. The successful capture includes a snapshot of `host-connections.jsonl`; diagnostic logs do not alter job state or captured identity.
- The third complete repetition additionally blocks the capture process for **7,051 ms**, beyond the host's default five-second HTTP idle timeout, immediately after the expected regression rejection. The next original-server identity GET succeeds. Its journal records the pause and zero capture-level retries.

Regression tests use a real loopback server to verify the close header, unchanged token/body delivery, one delivery only after a deliberately reset mutation response, and rejection of a substituted origin before any request. These are transport tests, not replacements for the full browser scenarios.

### Verification and retained delivery outcomes

| Evidence | Result |
| --- | --- |
| Full `capture-recovery-01` | Exit 0; fresh original-server identity matches; no unexpected HTTP error in the journal |
| Full `capture-recovery-02` using native Windows argument paths and the declared manifest filename | Exit 0; fresh original-server identity matches; no unexpected HTTP error |
| Full `capture-recovery-03` with the added idle-boundary pause | Exit 0; expected outcome-regression probe remains exit 1; following original-host GET is 200; fresh final identity matches; no unexpected HTTP error |
| `npm run build` | Exit 0 |
| `npm test` | Exit 0: 140 files, **1,641 passing tests**, one pre-existing Windows permission skip |
| Task-scoped diff and script syntax checks | Exit 0 |

Current capture: [capture-recovery-03/automatic-resume-browser.json](../../../adws/adw_data/sessions/auto-resume-20261020/capture-recovery-03/automatic-resume-browser.json), containing **91 nonempty artifacts**. Engineering logs and all three fresh identity responses are in `capture-recovery-engineering/`.

Every complete repetition retains the seven selected jobs and all earlier review repairs: the real narrow PDF begins at 541 px, all five Details menu items have in-viewport hit targets, reordered content and checked Undo remain correct, publication guards reject through real finalization, the configured one-call ceiling stops the next dispatch, contention preserves one active worker and six pending members, and current-version approval remains separate from deferral/download/submission. The supplemental guard and budget jobs do not replace the seven-job scenarios. Shared corpus/source invariants and unchanged application lifecycles are still asserted.

The current original host remains available for the independent gate under the same two-hour lifetime and owned cleanup protocol described above. The live career workspace and port 4173 were not used or restarted. This record establishes implementation/engineering readiness after capture recovery, not a new independent `actual-interface` pass.

## Desktop preview readiness and current engineering evidence (2026-10-21)

The subsequent independent review passed automatic preparation, focused questions, bounded recovery, editing/targets and approval separation. It rejected desktop review because two ready-state screenshots showed only an image border while approval was enabled, and because the supplied capture pack did not contain current build/test logs. Its report and the full earlier build history remain preserved; the entire retained contract, including all previously passing outcomes, remains in scope.

### Focused reproduction and cause

`preview-profile/observation.json` and its before/after screenshots use the same bound artifact and real HTTP 200 `image/png` response from the original disposable host. Delaying delivery reproduces an image element with `complete=false`, natural dimensions **0×0**, rendered height **2 px**, and an enabled approval button. Releasing that same response and awaiting decode produces **850×1100** natural pixels and a **1270 px** desktop image without changing the artifact. This establishes a browser image-loading/capture-timing race, not a missing or corrupt generated PDF. The old locator visibility check accepted the two-pixel border; the application also lacked a preview-readiness approval guard.

### Source and capture repair

- `JobResumeReview` tracks decoded page readiness by job, artifact fingerprint and retry identity. All current page images must load before image-backed approval is enabled; the action handler enforces the same condition. Loading is explained visibly. Image failure shows technical preview recovery and keeps approval disabled. An older artifact's late decode cannot enable a newer artifact. Edit/save and separate download behavior remain available.
- Capture waits for decode and application acknowledgement, samples actual bound page pixels, waits for paint frames, and checks the **actual desktop screenshot's PDF region**, excluding its border. `preview-render-readiness.json` binds the source URI, artifact ID, natural/rendered dimensions, source and screenshot ink/paper counts, and full screenshot hash. Blank decoded images and blank screenshot regions are rejected in a real-browser regression test. Pixel checks supplement actual screenshot inspection; they do not award a design verdict.
- A deliberately delayed first preview now demonstrates backend readiness while the browser image is pending and **approval disabled** (`desktop-preview-loading.png`, `preview-loading-proof.json`). The normal ready screenshot is taken only after that real response has decoded and painted. The loading capture is explicitly negative evidence, not a ready-state substitute.

Both complete repetitions, `preview-current-01` and [preview-current-02](../../../adws/adw_data/sessions/auto-resume-20261020/preview-current-02/automatic-resume-browser.json), pass. The two previously failing named desktop states visibly contain readable resume pages. In repetition 02, the actual screenshot regions contain **1,536** and **1,610** ink pixels respectively (84,992 sampled pixels each), with the expected white paper background and the correct current artifact. Builder inspected both full-resolution desktop captures in both repetitions. The narrow layout, usable Details navigation, all guard/budget/contention probes, and original-server outcome-regression rejection remain in the same complete runs.

### Current build and test records inside every evidence pack

Run the engineering prerequisite before the unchanged declared browser command:

```sh
node scripts/automatic-resume-engineering.mjs
node scripts/capture-automatic-resume-delivery.mjs --manifest <absolute-dir>/automatic-resume-browser.json --evidence-dir <absolute-dir>
node scripts/capture-automatic-resume-delivery.mjs --identity --manifest <same-absolute-manifest>
```

The prerequisite executes the exact `npm run build` and `npm test` commands, records real exit statuses, durations, platform argv and raw stdout/stderr, and fingerprints package/script/config inputs plus produced core/CLI/UI build files. It publishes a receipt only after both exit zero and inputs remain unchanged. A failed/incomplete latest run cannot fall back to an older success. Capture rejects stale inputs, changed build outputs, altered/missing logs or nonzero/incorrect commands before starting its disposable host. The served HTML/JS/CSS must also match the verified build bytes. This adds no build time to the browser command's 600-second budget.

Each capture now includes `engineering/receipt.json`, `engineering/build.log` and `engineering/tests.log` as declared manifest artifacts. The current receipt binds input fingerprint `ca6df9478866c99bda4ed5278d0cbdbe291ff4be2ecf21db4937aba4eebe6413` and records:

- `npm run build`: **exit 0** (20,527 ms).
- `npm test`: **exit 0** (180,916 ms), **142 files and 1,646 passing tests**, one existing platform-permission skip; no new acceptance tests skipped.

The current pack contains **97 nonempty artifacts**, including those logs, actual desktop/narrow screenshots, trace/API journals, verified PDFs, publication rejections, budget/contention records and strict identity regression evidence. The final identity probe against the original `preview-current-02` host exits zero and matches its captured identities. Source-scoped diff checks pass; the excluded dirty lockfile remains untouched.

Regression coverage includes preview loading/error/retry, stale decode isolation, delayed and blank real-browser images, blank composited screenshots, and rejection of stale/failed/tampered engineering receipts. The original plan and full prior reports are preserved. No live career-workspace use, port 4173 restart, provider escalation, shared updates, automatic approval or submission was introduced.

**Remaining gate:** independent re-review must inspect the new loaded desktop surfaces and current engineering artifacts against every retained outcome. These repairs establish implementation readiness, not an independent `actual-interface` acceptance verdict.
