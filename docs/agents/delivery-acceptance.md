# SSSF delivery acceptance

The Featherduster factory requires a delivery contract before agents run. Build
and tests are engineering evidence; independent outcome review also controls git
commit, TaskMaster completion, and `run.finish(accepted=...)`.
The orchestrator prepares this contract from the agreed request and relevant
product references; the user does not need to author the JSON schema.

```powershell
uv run adws/adw_plan_build_verify_fd.py requests/task.md --delivery-contract requests/outcomes.json
just task 123 requests/outcomes.json
```

The new option is intentionally required. An old invocation now explains which
input is missing rather than silently accepting tests as the entire outcome.
`--dry-run` produces planning output only and leaves delivery unaccepted (exit 1);
it does not certify delivery. Joined
runs must retain their original contract. Existing pre-contract runs are historical
records, not evidence certified under the new procedure.

`adws/contracts/factory-acceptance.json` is a runnable engineering-contract example
for the factory regression suite. It explicitly leaves product UI cleanup and
the live job outside that checkpoint. It must not be used to close a UI/live incident.

## Contract

See `adws/adw_modules/data_types.py` for the validated schema. Provide:

- ID/revision, scope (`engineering`, `interactive`, or `live_incident`), explicit
  `interactive` boolean, user checkpoint, and delivery extent. A `checkpoint`
  requires explicitly remaining scope and never marks the overall TaskMaster task
  done; `complete` requires no remaining scope.
- Required outcomes, each bound to named evidence commands.
- Scenarios with actual environment, state, data volume, and load. Every scenario
  must be covered. A live incident requires a live scenario and live evidence.
- Existing product reference paths plus the conventions being reused. Interactive
  contracts require browser evidence when `interactive` is true. Headless live
  incidents still require live evidence, without artificial browser requirements.
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
re-evaluate the current outcome and exit nonzero if it no longer holds, including
required concurrency/load probes for a live incident. Identify relevant state
revisions as well as served response bytes or an authoritative deployment ID.
Do not echo a saved identity, check only the build version, or use just a local
source hash. The reviewer evaluates whether this method establishes the tested
deployment and current outcome; changing either invalidates earlier approval.
There is no generic capture adapter that can infer every product's identity or
authorized interaction sequence: supply the actual runner for the declared scenario.
Missing adapters/manifests fail acceptance; do not fill them with saved screenshots.

The read-only reviewer receives the original request, full contract, and current
captures, with a fresh session and no builder report. It inspects default screens
before interaction traces, then reports one supported verdict per criterion.
Code validates coverage, hashes, unchanged source/evidence, current served identity,
and blocking findings. These checks establish provenance and consistency; the
reviewer still has to judge meaning. Neither file presence nor a self-reported
boolean proves that an interface is understandable.
Named reference files are also fingerprinted and rechecked, including effective
installed skills outside the repository. Verify the copy the worker actually
loads; updating a canonical source does not prove a generated wrapper refreshed.
Application builders cannot modify factory controllers, acceptance modules,
contract examples, or factory regression oracles under the default roster.

## Existing UI conventions and this incident

Use `packages/ui/src/views/desk/PrivateBriefing.tsx` and
`packages/ui/src/views/tailoring/steps/ProposalsStep.tsx` as bounded references.
Their useful patterns
include human labels, heading/helper/action hierarchy, local edit controls,
separate inspect/edit modes, formatted comparisons, and a collapsed full preview.
These are documented examples from existing screens, not a previously authoritative
style guide or a claim that every older screen is ideal.

For proposal recovery, additionally require the approved blockers-only design:
only blockers expand by default, optional diagnostics/history remain disclosed,
each blocker has an actual correction route, actions remain near the work, and
the current pipeline task becomes primary. Zero blockers must not open every
optional proposal. Use a realistic long resume, multiple proposals/sources,
generated and starting-resume blockers, and saved history; inspect blocked,
preparing, and ready-PDF states at desktop and narrow widths.

The live-incident contract must independently demonstrate normal-polling/concurrent
progression, durable review across timeout/navigation/reload, retained history and
feedback, and the requested document checkpoint. Preserve evidence validation,
consent, revision binding, page budget, and exact text checks. Preparation never
implies approval or submission. The existing postmortem identifies remaining UI
work; installing this workflow does not itself complete that cleanup.

## Failure and repair

Failed/missing captures stop without a blind model repair. Failed independent
reviews return findings with the same complete contract; the bounded repair must
pass engineering checks and obtain fresh evidence/review. Full build/repair
reports are retained in `delivery-build-history.json`, not only summary snippets.
On a repeated unexplained failure, collect focused causal evidence before broad
repair. Runtime records retain the contract, command logs, captures, reviewer
report, and per-check acceptance report. Do not edit historical session records.

Run factory regressions with:

```powershell
uv run --with 'sssf-core @ file:///C:/Users/drewk/sssf/core' python -m unittest discover -s adws/tests -v
```
