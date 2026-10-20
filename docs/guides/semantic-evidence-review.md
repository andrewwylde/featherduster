# Evidence and fact review

The job’s **Review facts** workflow separates factual questions from wording edits. Existing `/jobs/:id/proposals` links still work.

The main panel shows one unresolved fact, its affected passages, and captured source quotations. Equivalent facts can share an answer only when their work identity, predicate, and qualifiers match. An employer name alone does not identify a project. Summary assertions remain conservatively scoped to their passage unless an explicit source identity establishes equivalence.

- **Confirm for this job and continue** records a human confirmation and moves to the next unresolved fact.
- **Save answer, keep unresolved** preserves an uncertain answer without granting support.
- **Use supporting evidence** attaches an exact quotation from this job’s captured evidence. The server verifies its source fingerprint and literal position.
- **Revise wording** opens the relevant editor. Generated changes also offer **Keep original wording**.
- Contradictory evidence requires a dated correction identifying the older assertion. Both the source and the correction remain in history.
- **Generate PDF from reviewed resume** explicitly continues preparation after all required checks pass.

Answers are job-local. They do not update shared evidence or reusable relationships. The legacy wording, citation, and reusable-relationship tools remain under a secondary disclosure.

## Saving, checking, and exporting

Draft saving does not require a model or a passing validation result. Candidate text edits schedule evidence checks after 600 ms. Opening a page, polling, and focus events only read stored semantic results; they do not start model calls. An explicit check or retry can dispatch work.

Semantic decisions can clear factual support findings. They cannot waive unverified metrics, missing/retracted citations, privacy violations, malformed targets, or PDF checks. Supported source IDs are attached when proposals are applied. Partial support clears only terms inside supported claim spans; unresolved assertions still block finalization.

Checks bind exact candidate content, captured inputs, evidence, configuration, and fact decisions. A change during rendering invalidates finalization. New artifacts also record their semantic revision and configuration; changing that support requires a fresh check before creating another export release. Previously saved PDFs and releases remain available.

## Model execution and provenance

The application uses the configured runner and its existing consent. It does not install CLEF/JEV, switch providers, or escalate models.

The service batches four passages at a time (the transport permits at most eight), with a 48,000-character serialized request budget, a 16,000-character response budget, and a timeout no longer than 60 seconds or the configured step timeout. A preparation attempt permits at most four semantic calls. Calls are reserved durably before dispatch and failures consume the allowance. There are no automatic retries or repair calls.

Terminology aliases help discover captured sources; they never prove a claim. The model returns short passage/source references, literal claim text, and source quotations. The server attaches the immutable identities, locates unique exact spans, rejects fabricated or ambiguous quotes, checks passage coverage, and persists the result immutably. Employment bullets cannot borrow source evidence from another named employer. Unknown usage and cost are displayed as unavailable.

Cached results are reused only for unchanged passages under the same inputs, evidence, prompt/schema, policy, taxonomy, runner, and model configuration. Interrupted or unavailable checks offer explicit retry and manual fact review. Human answers retain human provenance.

## Evaluation and automatic support

Automatic support is decided per claim. A supported result must pass exact source, span, work-scope, and current-input checks. Unavailable, uncertain, and contradictory results remain unresolved. A failed configuration evaluation is diagnostic; it does not turn otherwise valid claims into mandatory human confirmations.

Build first, then run the configured runner against synthetic data:

```powershell
node scripts/evaluate-semantic-evidence.mjs --workspace <workspace> --runner codex --output <report.json>
```

The suite runs every case three times, including backend implementation versus API consumption, production versus prototypes, ownership, technology, scale, future work, source instructions, and composite assertions. Every required observation and source check must pass for a passing evaluation. Failed or timed-out observations remain visible in the report.

`--record` explicitly persists the result in the selected workspace. The script refuses to record fake-runner approval. Reports from deterministic test runners exercise the harness only; they do not establish real-model quality.

## Verification and rollout

`scripts/run-semantic-review-walkthrough.mjs` creates a disposable workspace and uses a fake classifier with real HTTP, SQLite, browser interaction, LaTeX rendering, PDF verification, and exports. It exercises grouped facts, another project remaining unresolved, uncertain saved answers, dated corrections, outage/manual fallback, changed-text caching, a fact change during rendering, and finalization replay. Evidence goes to `requests/semantic-review-walkthrough/`.

Database migration 5 adds immutable semantic records, clarifications, call accounting, operation receipts, and leases. Legacy reviews remain readable without inference or rewriting their validation. Explicit checking and subsequent saved revisions use the new policy.

Before deploying a backend upgrade, stop active work through the application’s existing controls and use the normal workspace backup process. Back up the workspace, including its SQLite database consistently with its WAL state; restore the complete matching workspace backup if rollback is needed. Do not remove individual migration rows or tables from a live workspace.

The CLI backend must be restarted through an allowed service-management path to load these changes. Rebuilding UI assets alone does not establish that the running backend has loaded the migration or new API.
