#!/usr/bin/env python
"""Task Executor Loop for Featherduster.

Pulls the next ready task from the TaskMaster 'master' tag and executes
the full ADW (Plan → Build → Vitest → Fix Loop → Git Commit → TM Done)
for each task in turn.

Usage:
    python scripts/loop_task_executor.py [--max-tasks N] [--task-id ID]
                                         [--skip-plan] [--dry-run]
                                         [--tag TAG] [--config PATH]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ADW_SCRIPT = REPO_ROOT / "adws" / "adw_plan_build_verify_fd.py"
DEFAULT_CONFIG = str(REPO_ROOT / "adws/adw_featherduster_config/sssf.config.yaml")

sys.path.insert(0, str(REPO_ROOT / "scripts"))

from idea_pipeline.taskmaster_adapter import TaskMasterAdapter


def next_ready_task(adapter: TaskMasterAdapter, tag: str = "master") -> dict | None:
    """Return the highest-priority pending task with no unmet dependencies."""
    tasks = adapter.get_tasks(tag=tag, status="pending")
    if not tasks:
        return None
    # Sort by priority (high > medium > low) then by id
    priority_order = {"high": 0, "medium": 1, "low": 2}
    tasks.sort(key=lambda t: (priority_order.get(t.priority, 9), t.id))
    return tasks[0].__dict__ if tasks else None


def run_adw(task_id: int, config: str, skip_plan: bool, dry_run: bool, tier: str | None = None) -> int:
    """Invoke the ADW script via uv run and return its exit code."""
    cmd = [
        "uv", "run",
        str(ADW_SCRIPT),
        f"--task-id={task_id}",
        f"--config={config}",
    ]
    if tier:
        cmd.append(f"--tier={tier}")
    if skip_plan:
        cmd.append("--skip-plan")
    if dry_run:
        cmd.append("--dry-run")

    print(f"\n[Executor] Launching ADW for task #{task_id}")
    print(f"[Executor] Command: {' '.join(cmd)}")

    result = subprocess.run(cmd, cwd=REPO_ROOT)
    return result.returncode


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Featherduster Task Executor Loop")
    parser.add_argument("--max-tasks", type=int, default=1,
                        help="Maximum number of tasks to execute before stopping (default: 1)")
    parser.add_argument("--task-id", type=int, default=None,
                        help="Execute a specific task ID instead of auto-selecting from queue")
    parser.add_argument("--tag", type=str, default="master",
                        help="TaskMaster tag to pull tasks from (default: master)")
    parser.add_argument("--tier", type=str, default=None,
                        help="Preset model tier profile (e.g. codex, fast, free, frontier)")
    parser.add_argument("--skip-plan", action="store_true",
                        help="Pass --skip-plan to the ADW (skip planner, go straight to builder)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Pass --dry-run to the ADW (plan only, no build or commit)")
    parser.add_argument("--config", type=str, default=DEFAULT_CONFIG,
                        help="Path to sssf.config.yaml for the ADW")
    args = parser.parse_args()

    adapter = TaskMasterAdapter(REPO_ROOT)
    executed = 0
    failed = 0

    print(f"\n=== Featherduster Task Executor ===")
    print(f"  tag={args.tag!r}  max_tasks={args.max_tasks}  tier={args.tier}  skip_plan={args.skip_plan}")

    while executed < args.max_tasks:
        # Determine which task to run
        if args.task_id is not None:
            task_raw = adapter.get_tasks(tag=args.tag)
            task_obj = next((t for t in task_raw if t.id == args.task_id), None)
            if task_obj is None:
                print(f"[Executor] Task #{args.task_id} not found in tag='{args.tag}'. Stopping.")
                break
            task_id = args.task_id
        else:
            task_obj = next_ready_task(adapter, tag=args.tag)
            if task_obj is None:
                print(f"[Executor] No pending tasks in tag='{args.tag}'. Queue is empty.")
                break
            task_id = task_obj["id"] if isinstance(task_obj, dict) else task_obj.id

        print(f"\n[Executor] === Task #{task_id} ===")

        rc = run_adw(task_id, args.config, args.skip_plan, args.dry_run, tier=args.tier)
        executed += 1

        if rc == 0:
            print(f"[Executor] ✓ Task #{task_id} completed successfully.")
        else:
            failed += 1
            print(f"[Executor] ✗ Task #{task_id} ADW exited with code {rc}.")
            if args.max_tasks == 1:
                break  # Single-task mode: stop on first failure

        # If a specific task was requested, stop after one
        if args.task_id is not None:
            break

    print(f"\n[Executor] Done. Executed: {executed}, Failed: {failed}, Remaining: (check task-master list)")


if __name__ == "__main__":
    main()
