# SSSF delivery acceptance

The Featherduster factory requires a delivery contract before agents run. Build
and tests are engineering evidence; independent outcome review also controls git
commit, TaskMaster completion, and `run.finish(accepted=...)`.
The orchestrator prepares this contract from the agreed request and relevant
product references; the user does not need to author the JSON schema.

```sh
uv run adws/adw_plan_build_verify_fd.py requests/task.md --delivery-contract requests/outcomes.json
just task 123 requests/outcomes.json
```

`--delivery-contract` is required. `--dry-run` produces planning output only and leaves delivery unaccepted (exit 1). Joined runs must retain their original contract.

`adws/contracts/factory-acceptance.json` provides an example engineering contract for the factory regression suite.

## Contract

See `adws/adw_modules/data_types.py` for the validated schema:

- ID/revision, scope (`engineering`, `interactive`, or `live_incident`), explicit
  `interactive` boolean, user checkpoint, and delivery extent. A `checkpoint`
  requires explicitly remaining scope and never marks the overall TaskMaster task
  done; `complete` requires no remaining scope.
- Required outcomes, each bound to named evidence commands.
- Scenarios with actual environment, state, data volume, and load. Every scenario
  must be covered.
- Existing product reference paths plus the conventions being reused. Interactive
  contracts require browser evidence when `interactive` is true.
- Commands as argv arrays, not shell command strings; bounded timeouts apply.

Supported argument substitutions are `{python}`, `{repo_root}`, `{evidence_dir}`,
and `{manifest}`. Code phases run the commands using the current script's Python
environment and collect their actual logs. Declare only commands authorized by
the requested task; the contract is operator input, not an untrusted job posting.

Browser/live commands write a JSON manifest at `{manifest}`:

```json
{
  "served_build_identity": "identity observed from the served application/assets",
  "outcome_identity": "identity of the relevant current job/state revision and outcome",
  "identity_method": "Describe both running-build identification and live outcome re-evaluation",
  "observation": "Describe the actual observed state and progression",
  "scenario_ids": ["blocked-desktop"],
  "artifacts": [
    {"path": "default-screen.png", "kind": "screenshot"},
    {"path": "observed-actions.json", "kind": "trace"}
  ]
}
```

Artifacts must be nonempty files within the fresh evidence directory. Browser
captures require a screenshot. `identity_argv` is a separate bounded command
that prints JSON with `served_build_identity` and `outcome_identity`. It runs at
capture and again at acceptance; both must match the manifest. The command must
re-evaluate the current outcome and exit nonzero if it no longer holds. Identify
relevant state revisions as well as served response bytes or an authoritative
deployment ID. Do not echo a saved identity, check only the build version, or use
just a local source hash. The reviewer evaluates whether this method establishes
the tested deployment and current outcome; changing either invalidates earlier approval.
Supply the actual runner for the declared scenario. Missing adapters/manifests fail
acceptance; do not fill them with saved screenshots.

The read-only reviewer receives the original request, full contract, and current
captures, with a fresh session and no builder report. It inspects default screens
before interaction traces, then reports one supported verdict per criterion.
Code validates coverage, hashes, unchanged source/evidence, current served identity,
and blocking findings. These checks establish provenance and consistency; the
reviewer still has to judge meaning.

Named reference files are also fingerprinted and rechecked. Application builders
cannot modify factory controllers, acceptance modules, contract examples, or
factory regression oracles under the default roster.

## UI conventions and verification

Use `packages/ui/src/views/desk/PrivateBriefing.tsx` and
`packages/ui/src/views/tailoring/steps/ProposalsStep.tsx` as reference implementations.
Key patterns:
- Human-readable labels, clear heading/helper/action hierarchy, and local edit controls.
- Separate inspect and edit modes, formatted diff comparisons, and a collapsed full preview.
- Blockers-only expansion: only blockers expand by default; optional diagnostics and history remain collapsed.
- Clear action routes: actions stay close to the relevant item, and the primary pipeline action is highlighted.

For interactive and live contracts, independently demonstrate progression under normal polling, durable review across reloads, retained history and feedback, and valid document generation. All contracts must respect evidence validation, consent, revision binding, page budget, and exact text checks.

## Failure and repair

Failed or missing captures stop without model repair. Failed independent reviews
return findings with the same complete contract; repairs must pass engineering
checks and obtain fresh evidence/review. Full build and repair reports are retained
in `delivery-build-history.json`. On a repeated unexplained failure, collect focused
causal evidence before broad repair. Runtime records retain the contract, command
logs, captures, reviewer report, and per-check acceptance report.

Run factory regressions with:

```powershell
uv run --with sssf-core python -m unittest discover -s adws/tests -v
# Or with a local checkout:
# uv run --with "sssf-core @ file:///path/to/sssf/core" python -m unittest discover -s adws/tests -v
```
