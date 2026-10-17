#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic>=2.0", "python-dotenv>=1.0", "pyyaml>=6.0", "rich>=13.0",
#                 "sssf-core @ file:///C:/Users/drewk/sssf/core"]
# ///
"""ADW Plan Build Verify FD -- Featherduster SDLC chain.

Picks up a TaskMaster task or a prompt/PRD file and executes the full plan -> build -> test -> fix loop:

  engineer(request)
    -> planner       (reads task/prompt, writes plan.md)
    -> builder       (implements plan, runs npm test)
    -> code(vitest)  (npm test quality gate)
    [-> builder(fix) up to MAX_FIX_LOOPS times]
    -> code(outcome capture) -> independent delivery review -> outcome gate
    [-> builder(address findings) -> verify -> fresh outcome review, bounded]
    -> git(commit)   (only with green tests AND current accepted outcomes)
    [-> tm(done)]    (marks TaskMaster task as done if task-id given)

Usage:
    uv run adws/adw_plan_build_verify_fd.py requests/task.md --delivery-contract requests/outcomes.json
    uv run adws/adw_plan_build_verify_fd.py --task-id 1 --delivery-contract requests/outcomes.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# Bootstrap: ensure we run from the repo root regardless of cwd
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent

from sssf_core import agents, gates, git_helper, quality, session, utils
from sssf_core.data_types import (
    AgentCall, BuildOutput, PhaseParams, PlanOutput,
    QualityCheckResult, QualityCheckSpec, SSSFConfig,
)
from adw_modules import delivery
from adw_modules.data_types import DeliveryContract, WorkflowRequest

DEFAULT_CONFIG  = str(REPO_ROOT / "adws/adw_featherduster_config/sssf.config.yaml")
REQUIRED_AGENTS = ["planner", "builder", "delivery_reviewer"]
MAX_FIX_LOOPS   = 3
MAX_DELIVERY_ROUNDS = 2


# ---------------------------------------------------------------------------
# Quality specs
# ---------------------------------------------------------------------------

import shutil

def resolve_cmd(argv: list[str]) -> list[str]:
    """Resolve binary names (e.g. npx, npm) to full path or .CMD on Windows."""
    if not argv:
        return argv
    binary = shutil.which(argv[0])
    if binary:
        return [binary] + argv[1:]
    return argv


def vitest_spec(test_cmd: list[str] | None = None) -> QualityCheckSpec:
    """Return a QualityCheckSpec for the full Vitest suite (or a scoped run)."""
    argv = resolve_cmd(test_cmd or ["npm", "test"])
    return QualityCheckSpec(
        name="vitest",
        area="backend",
        operation="test",
        argv=argv,
        timeout_seconds=180,
    )


def typescript_check_spec() -> QualityCheckSpec:
    """Return a QualityCheckSpec for a fast TypeScript type-check."""
    argv = resolve_cmd(["npm", "run", "build", "--if-present"])
    return QualityCheckSpec(
        name="tsc",
        area="backend",
        operation="lint",
        argv=argv,
        timeout_seconds=120,
    )


sys.path.insert(0, str(REPO_ROOT / "scripts"))
from idea_pipeline.taskmaster_adapter import TaskMasterAdapter

# ---------------------------------------------------------------------------
# TaskMaster helpers (using local TaskMasterAdapter)
# ---------------------------------------------------------------------------

def get_task_json(task_id: int, tag: str = "master") -> dict | None:
    adapter = TaskMasterAdapter(REPO_ROOT)
    task = adapter.get_task(task_id, tag=tag)
    if not task:
        task = adapter.get_task(task_id, tag="proposals")
    return task.to_dict() if task else None


def mark_task_done(task_id: int, tag: str = "master") -> None:
    adapter = TaskMasterAdapter(REPO_ROOT)
    adapter.set_status(task_id, "done", tag=tag)


def mark_task_failed(task_id: int, reason: str, tag: str = "master") -> None:
    adapter = TaskMasterAdapter(REPO_ROOT)
    task = adapter.get_task(task_id, tag=tag)
    if task:
        task.status = "blocked"
        task.details = f"{task.details}\n\n[ADW Failure]: {reason}".strip()
        adapter.update_task(task, tag=tag)


# ---------------------------------------------------------------------------
# Task -> prompt string
# ---------------------------------------------------------------------------

def build_task_prompt(task: dict) -> str:
    """Render a TaskMaster task dict into a rich natural-language prompt."""
    parts = [
        f"# Task #{task.get('id')}: {task.get('title', '(no title)')}",
        "",
        "## Description",
        task.get("description", ""),
    ]

    if task.get("details"):
        parts += ["", "## Details", task["details"]]

    subtasks = task.get("subtasks", [])
    if subtasks:
        parts += ["", "## Subtasks"]
        for st in subtasks:
            status = st.get("status", "pending")
            marker = "[x]" if status == "done" else "[ ]"
            parts.append(f"  {marker} {st.get('id')}. {st.get('title', '')}")
            if st.get("description"):
                parts.append(f"     {st['description']}")

    if task.get("testStrategy"):
        parts += ["", "## Test Strategy", task["testStrategy"]]

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main ADW
# ---------------------------------------------------------------------------

def main(request: WorkflowRequest) -> int:
    contract = DeliveryContract.model_validate_json(Path(request.delivery_contract).read_text(encoding="utf-8"))
    cfg = agents.load_config(request.config)
    agents.validate(cfg, ["builder", "delivery_reviewer"] if request.skip_plan else REQUIRED_AGENTS)
    reviewer = agents.resolve(cfg, "delivery_reviewer")
    if reviewer.writes != [] or reviewer.capability_profile != "read_only":
        raise ValueError("delivery_reviewer must have writes: [] and capability_profile: read_only")
    run = session.ensure(cfg, request.adw_id)
    task_id, prompt_arg = request.task_id, request.prompt_arg
    skip_plan, dry_run = request.skip_plan, request.dry_run

    # ── Load task or prompt ───────────────────────────────────────────────
    task: dict | None = None
    test_strategy_cmd: list[str] | None = None
    title: str = "Request"

    if task_id is not None:
        task = get_task_json(task_id)
        if not task or task.get("error"):
            print(f"[ADW] ERROR: could not load task #{task_id}: {task}", file=sys.stderr)
            return 1
        prompt = build_task_prompt(task)
        title = task.get("title", f"Task #{task_id}")
        raw_strategy = task.get("testStrategy", "")
        if raw_strategy:
            import shlex
            try:
                test_strategy_cmd = shlex.split(raw_strategy)
            except ValueError:
                test_strategy_cmd = None
    elif prompt_arg:
        p_path = Path(prompt_arg)
        if p_path.exists() and p_path.is_file():
            prompt = p_path.read_text(encoding="utf-8")
            title = p_path.stem
        else:
            prompt = prompt_arg
            first_line = prompt.strip().splitlines()[0] if prompt.strip() else "Direct Prompt"
            title = first_line[:60]
    else:
        print("[ADW] ERROR: Either --task-id or a prompt must be provided.", file=sys.stderr)
        return 1

    retained_contract = run.context_handoff_dir / "delivery-contract.json"
    if retained_contract.exists() and retained_contract.read_text(encoding="utf-8") != contract.model_dump_json(indent=2):
        return run.finish(accepted=False, reason="Joined run has a different delivery contract; preserve its scope and evidence")
    retained_contract.write_text(contract.model_dump_json(indent=2), encoding="utf-8")
    user_request = prompt
    prompt = delivery.delivery_prompt(prompt, contract, run)

    # ── Phase: engineer request ───────────────────────────────────────────
    with run.phase(PhaseParams(
        name="request", kind="engineer", owner=run.engineer,
        description=f"Load request: {title}"
    )) as ph:
        ph.log(task_id=task_id, title=title, prompt_chars=len(prompt),
               delivery_scope=contract.scope, user_checkpoint=contract.user_checkpoint,
               delivery_extent=contract.delivery_extent,
               explicitly_remaining_scope=contract.explicitly_remaining_scope)

    # ── Phase: plan ───────────────────────────────────────────────────────
    plan_output: PlanOutput
    if skip_plan:
        plan_output = PlanOutput(
            status="success",
            summary=f"Skipped planning -- executing {title} directly.",
            artifacts=[],
            notes_for_next_agent="No plan phase; builder has full context from the prompt.",
        )
    else:
        with run.phase(PhaseParams(
            name="plan", kind="agent", owner="planner", retries=1,
            description=f"Plan implementation for {title}"
        )) as ph:
            plan_output = ph.call(AgentCall(
                output_type=PlanOutput,
                prompt=prompt,
                gates=[gates.artifacts_exist, gates.files_non_empty],
            ))

    if dry_run:
        print("[ADW] --dry-run: planning checkpoint only; delivery remains unverified.")
        return run.finish(accepted=False, reason="Planning output only: delivery is unverified (--dry-run)")

    # ── Phase: build ──────────────────────────────────────────────────────
    with run.phase(PhaseParams(
        name="build", kind="agent", owner="builder", retries=1,
        description=f"Implement {title}"
    )) as ph:
        previous = ph.call(AgentCall(
            output_type=BuildOutput,
            prompt=prompt,
            previous=plan_output,
            gates=[gates.diff_matches_claims, gates.no_op_success],
        ))

    # ── Verify + repair loop ──────────────────────────────────────────────
    def verify_suite(r) -> list:
        delivery.retain_history(r)
        checks: list[QualityCheckResult] = []
        with r.phase(PhaseParams(
            name="typescript_build", kind="code", owner="quality",
            description="Build core, UI, and CLI before tests that execute the compiled packages"
        )) as ph:
            result = quality.run_check(r, typescript_check_spec())
            ph.log(passed=result.passed, artifacts=result.output_artifact)
            checks.append(result)
        spec = vitest_spec(test_strategy_cmd)
        with r.phase(PhaseParams(
            name="vitest", kind="code", owner="quality",
            description="Run Vitest suite to confirm implementation"
        )) as ph:
            result = quality.run_check(r, spec)
            passed_n = 1 if result.passed else 0
            ph.log(passed=result.passed, checks=f"{passed_n}/1",
                   artifacts=result.output_artifact)
            checks.append(result)
        return checks

    test_passed, _final = run.repair_loop(
        verifier=verify_suite,
        builder_owner="builder",
        prompt=prompt,
        initial_envelope=previous,
        output_type=BuildOutput,
        gates=[gates.diff_matches_claims, gates.no_op_success],
        max_attempts=MAX_FIX_LOOPS,
    )

    outcome_report = None
    failure_reason = "Engineering checks did not pass; delivery remains unverified"
    if test_passed:
        for round_number in range(1, MAX_DELIVERY_ROUNDS + 1):
            bundle = delivery.capture_evidence(run, contract)
            review = (delivery.review_delivery(run, contract, bundle, user_request)
                      if bundle["source_unchanged_during_capture"] and not bundle["reference_errors"]
                      and all(r["passed"] for r in bundle["records"])
                      else None)
            outcome_report = delivery.validate_delivery(run, contract, bundle, review)
            if outcome_report.passed:
                break
            failure_reason = "Delivery outcomes unverified: " + "; ".join(outcome_report.violations)
            # Missing/failed capture is evidence of an unavailable outcome, not a reason
            # to send a blind repair to the builder or weaken the contract.
            if review is None or round_number == MAX_DELIVERY_ROUNDS:
                break
            delivery.retain_history(run)
            with run.phase(PhaseParams(name=f"address_delivery_{round_number}", kind="agent", owner="builder",
                    retries=1, description="Correct independent outcome findings while retaining the complete delivery contract")) as ph:
                fixed = ph.call(AgentCall(output_type=BuildOutput,
                    prompt=prompt + "\n\nIndependent outcome violations:\n" + failure_reason,
                    previous=review, gates=[gates.diff_matches_claims, gates.no_op_success]))
            test_passed, _final = run.repair_loop(verifier=verify_suite, builder_owner="builder", prompt=prompt,
                initial_envelope=fixed, output_type=BuildOutput, gates=[gates.diff_matches_claims, gates.no_op_success],
                max_attempts=MAX_FIX_LOOPS, phase_prefix=f"delivery_fix_{round_number}")
            if not test_passed:
                failure_reason = "Engineering checks failed after addressing delivery findings"
                break

    accepted = test_passed and outcome_report is not None and outcome_report.passed

    # ── Git commit (only on green) ────────────────────────────────────────
    commit_msg = (
        getattr(_final, "commit_message", None)
        or (f"feat(adw): complete task #{task_id} -- {title}" if task_id is not None else f"feat(adw): {title}")
    )
    if contract.delivery_extent == "checkpoint":
        commit_msg = f"chore(checkpoint): {title}"
    if accepted:
        with run.phase(PhaseParams(
            name="commit", kind="code", owner="git",
            description="Commit only after engineering checks and independently verified delivery outcomes"
        )) as ph:
            excludes = run.cfg.defaults.git_excludes or run.cfg.defaults.ephemeral_paths
            sha = git_helper.commit_all(commit_msg, excludes=excludes)
            ph.log(sha=sha, message=commit_msg)

        # ── Mark TaskMaster task done if task_id provided ─────────────────
        if task_id is not None and contract.delivery_extent == "complete":
            with run.phase(PhaseParams(
                name="tm_done", kind="code", owner="taskmaster",
                description=f"Mark task #{task_id} as done in TaskMaster"
            )) as ph:
                mark_task_done(task_id)
                ph.log(task_id=task_id, status="done")

        if contract.delivery_extent == "checkpoint":
            with run.phase(PhaseParams(name="checkpoint_remaining", kind="code", owner="quality",
                    description="Keep the broader task open after an explicitly scoped checkpoint")) as ph:
                ph.log(task_id=task_id, overall_task_completed=False,
                       remaining_scope=contract.explicitly_remaining_scope)

    else:
        if task_id is not None:
            mark_task_failed(task_id, failure_reason)

    return run.finish(
        accepted=accepted,
        reason="" if accepted else failure_reason,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", nargs="?", default=None,
                        help="Prompt string or path to a prompt/PRD markdown file")
    parser.add_argument("--prompt", dest="prompt_opt", default=None,
                        help="Alternative flag for prompt string or path")
    parser.add_argument("--task-id", type=int, default=None,
                        help="TaskMaster master-tag task ID to implement")
    parser.add_argument("--skip-plan", action="store_true",
                        help="Skip the planner phase and send the task directly to the builder")
    parser.add_argument("--dry-run", action="store_true",
                        help="Plan only; leave delivery unaccepted (exit 1), without building or committing")
    parser.add_argument("--delivery-contract", required=True,
                        help="JSON contract declaring required user outcomes and independent evidence commands")
    agents.add_config_args(parser)
    parser.add_argument("--adw-id", default=None,
                        help="Join or pin an existing ADW session")
    args = parser.parse_args()

    # Default config to featherduster's config if not overridden
    if args.config == "adws/adw_sssf_config/sssf.config.yaml":
        args.config = DEFAULT_CONFIG

    chosen_prompt = args.prompt_opt or args.prompt
    if args.task_id is None and not chosen_prompt:
        parser.error("Either a prompt (positional or --prompt) or --task-id must be provided.")

    cfg = agents.load_config_from_args(args)
    sys.exit(main(WorkflowRequest(
        task_id=args.task_id,
        prompt_arg=chosen_prompt,
        config=cfg,
        adw_id=args.adw_id,
        skip_plan=args.skip_plan,
        dry_run=args.dry_run,
        delivery_contract=args.delivery_contract,
    )))
