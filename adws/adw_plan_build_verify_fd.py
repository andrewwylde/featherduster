#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic>=2.0", "python-dotenv>=1.0", "pyyaml>=6.0", "rich>=13.0",
#                 "sssf-core @ file:///C:/Users/drewk/sssf/core"]
# ///
"""ADW Plan Build Verify FD — Featherduster SDLC chain.

Picks up a TaskMaster task and executes the full plan→build→test→fix loop:

  engineer(request)
    → planner       (reads task, writes plan.md)
    → builder       (implements plan, runs npm test)
    → code(vitest)  (npm test quality gate)
    [→ builder(fix) up to MAX_FIX_LOOPS times]
    → git(commit)   (only on green)
    → tm(done)      (marks TaskMaster task as done)

Usage:
    uv run adws/adw_plan_build_verify_fd.py \\
        --task-id 1 \\
        [--config adws/adw_featherduster_config/sssf.config.yaml] \\
        [--adw-id a1b2c3d4] \\
        [--skip-plan]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap: ensure we run from the repo root regardless of cwd
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent

from sssf_core import agents, gates, git_helper, quality, session, utils
from sssf_core.data_types import (
    AgentCall, BuildOutput, PhaseParams, PlanOutput,
    QualityCheckResult, QualityCheckSpec, SSSFConfig,
)

DEFAULT_CONFIG  = str(REPO_ROOT / "adws/adw_featherduster_config/sssf.config.yaml")
REQUIRED_AGENTS = ["planner", "builder"]
MAX_FIX_LOOPS   = 3


# ---------------------------------------------------------------------------
# Quality specs
# ---------------------------------------------------------------------------

def vitest_spec(test_cmd: list[str] | None = None) -> QualityCheckSpec:
    """Return a QualityCheckSpec for the full Vitest suite (or a scoped run)."""
    argv = test_cmd or ["npm", "test"]
    return QualityCheckSpec(
        name="vitest",
        area="frontend+backend",
        operation="test",
        argv=argv,
        timeout_seconds=120,
    )


def typescript_check_spec() -> QualityCheckSpec:
    """Return a QualityCheckSpec for a fast TypeScript type-check."""
    return QualityCheckSpec(
        name="tsc",
        area="frontend+backend",
        operation="lint",
        argv=["npm", "run", "build", "--if-present"],
        timeout_seconds=60,
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
# Task → prompt string
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
            marker = "✓" if status == "done" else "○"
            parts.append(f"  {marker} {st.get('id')}. {st.get('title', '')}")
            if st.get("description"):
                parts.append(f"     {st['description']}")

    if task.get("testStrategy"):
        parts += ["", "## Test Strategy", task["testStrategy"]]

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main ADW
# ---------------------------------------------------------------------------

def main(
    task_id: int,
    config: str | SSSFConfig = DEFAULT_CONFIG,
    adw_id: str | None = None,
    skip_plan: bool = False,
    dry_run: bool = False,
) -> int:
    cfg = agents.load_config(config)
    agents.validate(cfg, ["builder"] if skip_plan else REQUIRED_AGENTS)
    run = session.ensure(cfg, adw_id)

    # ── Load TaskMaster task ──────────────────────────────────────────────
    task = get_task_json(task_id)
    if not task or task.get("error"):
        print(f"[ADW] ERROR: could not load task #{task_id}: {task}", file=sys.stderr)
        return 1

    prompt = build_task_prompt(task)
    test_strategy_cmd: list[str] | None = None
    raw_strategy = task.get("testStrategy", "")
    if raw_strategy:
        # e.g. "npx vitest run packages/cli/tests/evidence-files.test.ts"
        import shlex
        try:
            test_strategy_cmd = shlex.split(raw_strategy)
        except ValueError:
            test_strategy_cmd = None

    # ── Phase: engineer request ───────────────────────────────────────────
    with run.phase(PhaseParams(
        name="request", kind="engineer", owner=run.engineer,
        description=f"Load TaskMaster task #{task_id}: {task.get('title', '')}"
    )) as ph:
        ph.log(task_id=task_id, title=task.get("title"), prompt_chars=len(prompt))

    # ── Phase: plan ───────────────────────────────────────────────────────
    plan_output: PlanOutput
    if skip_plan:
        plan_output = PlanOutput(
            status="success",
            summary=f"Skipped planning — executing task #{task_id} directly.",
            artifacts=[],
            notes_for_next_agent="No plan phase; builder has full context from the prompt.",
        )
    else:
        with run.phase(PhaseParams(
            name="plan", kind="agent", owner="planner", retries=1,
            description=f"Plan implementation for task #{task_id}"
        )) as ph:
            plan_output = ph.call(AgentCall(
                output_type=PlanOutput,
                prompt=prompt,
                gates=[gates.artifacts_exist, gates.files_non_empty],
            ))

    if dry_run:
        print("[ADW] --dry-run: stopping after plan phase.")
        return run.finish(accepted=True)

    # ── Phase: build ──────────────────────────────────────────────────────
    with run.phase(PhaseParams(
        name="build", kind="agent", owner="builder", retries=1,
        description=f"Implement task #{task_id}"
    )) as ph:
        previous = ph.call(AgentCall(
            output_type=BuildOutput,
            prompt=prompt,
            previous=plan_output,
            gates=[gates.diff_matches_claims, gates.no_op_success],
        ))

    # ── Verify + repair loop ──────────────────────────────────────────────
    def verify_suite(r) -> list:
        checks: list[QualityCheckResult] = []
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

    # ── Git commit (only on green) ────────────────────────────────────────
    commit_msg = (
        getattr(_final, "commit_message", None)
        or f"feat(adw): complete task #{task_id} — {task.get('title', '')}"
    )
    if test_passed:
        with run.phase(PhaseParams(
            name="commit", kind="code", owner="git",
            description="Commit changes after green test suite"
        )) as ph:
            excludes = run.cfg.defaults.git_excludes or run.cfg.defaults.ephemeral_paths
            sha = git_helper.commit_all(commit_msg, excludes=excludes)
            ph.log(sha=sha, message=commit_msg)

        # ── Mark TaskMaster task done ─────────────────────────────────────
        with run.phase(PhaseParams(
            name="tm_done", kind="code", owner="taskmaster",
            description=f"Mark task #{task_id} as done in TaskMaster"
        )) as ph:
            mark_task_done(task_id)
            ph.log(task_id=task_id, status="done")

    else:
        mark_task_failed(task_id, f"vitest still red after {MAX_FIX_LOOPS} fix loops")

    return run.finish(
        accepted=test_passed,
        reason=f"vitest still failed after {MAX_FIX_LOOPS} fix attempt(s)",
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", type=int, required=True,
                        help="TaskMaster master-tag task ID to implement")
    parser.add_argument("--skip-plan", action="store_true",
                        help="Skip the planner phase and send the task directly to the builder")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run the planner phase only; do not build or commit")
    agents.add_config_args(parser)
    parser.add_argument("--adw-id", default=None,
                        help="Join or pin an existing ADW session")
    args = parser.parse_args()

    # Default config to featherduster's config if not overridden
    if args.config == "adws/adw_sssf_config/sssf.config.yaml":
        args.config = DEFAULT_CONFIG

    cfg = agents.load_config_from_args(args)
    sys.exit(main(
        task_id=args.task_id,
        config=cfg,
        adw_id=args.adw_id,
        skip_plan=args.skip_plan,
        dry_run=args.dry_run,
    ))
