# Semantic evidence review execution record

The user selected inline execution. Implementation remains on the existing `main` checkout; unrelated dirty files are preserved.

## Implemented

- Tasks 1–5: strict facts and clarifications, captured-source discovery, immutable SQLite history and leases, bounded classification, explicit API and configuration gate.
- Tasks 6–7: shared support projection, independent validation retained, preparation/save/finalization integration, semantic binding on published artifacts and export freshness.
- Tasks 8–10: grouped factual review, manual uncertainty and corrections, source quotation attachment, retained browser answers, secondary wording editor, explicit PDF continuation, reactive draft checks with read-only polling.
- Task 11: 12 synthetic cases, three observations each, exact configuration/suite gate, real configured-runner evaluation, and legacy migration coverage.
- Task 12: disposable real-renderer browser walkthrough, desktop/mobile evidence, documentation, and full regression verification.

## Implementation refinements

The UI uses a shared `JobFacts.tsx` component instead of three separate presentation components. Its rendered tests exercise the same state transitions.

Source selection is part of the clarification operation, with literal quotations verified by the server, rather than a second citation-only mutation.

The initial model contract required the model to count quotation offsets and echo long identity hashes. Real-runner testing exposed poor reliability. The final contract uses short references and unique literal quotations; the server attaches immutable identities and computes positions. Fabricated or ambiguous quotations still fail; supplied invalid offsets are not silently repaired. The prompt/schema fingerprint invalidates earlier evaluations.

Once factual wording has been reviewed under version 2, preparation preserves that exact wording through the editorial stage. It does not silently run a cleanup that would invalidate the factual approval.

Work identity is conservative: identical source bindings within an employer/role can group equivalent predicates and qualifiers; the employer alone cannot. Unsupported cross-project equivalence remains a manual review.

## Evidence and remaining release gates

The first browser acceptance run passed with exactly two semantic dispatches: initial preparation and one changed summary. It produced a real PDF, confirmed two same-work passages together while leaving another project unresolved, retained an uncertain answer, recorded a dated correction, and rejected stale finalization after a concurrent fact change.

Real Codex evaluation v2 produced 8 valid expected observations out of 36; v3 produced 13. Evaluation v4, using short references and server-computed quotation positions, produced 34 of 36 valid expected observations. Two composite-assertion repetitions returned invalid structured data. The strict gate failed; automatic acceptance remains disabled, and no production evaluation approval was recorded. Manual factual review remains available. Earlier reports remain separate.

The full regression run passed 127 test files and 1,600 tests, with one skipped test. Subsequent focused runs passed all 29 classifier/service/evaluation and core/preparation tests after the final short-reference and employer-scope changes. Core, CLI, and UI builds passed. The final disposable browser walkthrough passed again after those changes, including real PDF rendering and stale-finalization rejection.

Final results are recorded in:

- `requests/semantic-full-tests-final.log`
- `requests/semantic-walkthrough-final.log`
- `requests/semantic-review-walkthrough/report.json`
- `requests/semantic-evaluation-codex-v4.json`

Local backend rollout remains pending. An earlier automatic approval review rejected stopping/restarting the live server; this execution does not retry that blocked process-control action. Built assets and disposable acceptance are not proof that the server on port 4173 has loaded the new backend.

The live job facts endpoint most recently returned HTTP 404. Task 31 remains blocked on backend rollout and the failed automatic-acceptance evaluation gate; implementation and verification evidence are retained for continuation.
