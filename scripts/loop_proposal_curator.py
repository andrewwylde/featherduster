#!/usr/bin/env python
"""Proposal Curator Loop for Featherduster.

Monitors the TaskMaster 'proposals' tag, iteratively:
1. Deduplicating overlapping proposals and merging context.
2. Ranking proposals by architectural impact and feasibility.
3. Expanding top proposals into executable subtasks and test strategies.
4. Optionally promoting curated high-priority proposals to the 'master' tag.

Usage:
    python scripts/loop_proposal_curator.py [--interval SECONDS] [--tag TAG] [--promote] [--max-expand N]
"""

import argparse
import sys
import time
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root / "scripts"))

from idea_pipeline.proposal_curator import ProposalCurator
from idea_pipeline.taskmaster_adapter import TaskMasterAdapter


def run_curator_cycle(curator: ProposalCurator, tag: str, max_expand: int, promote: bool) -> None:
    print(f"\n[Proposal Curator] Running curation pass on tag='{tag}'...")
    report = curator.curate(
        tag=tag,
        max_expand=max_expand,
        promote_top=promote,
    )

    print(f"[Proposal Curator] Pass complete:")
    print(f"  * Deduped / Cancelled: {report.deduped_count}")
    print(f"  * Evaluated & Ranked: {report.ranked_count}")
    print(f"  * Expanded Subtasks:  {report.expanded_count}")
    print(f"  * Promoted to Master: {report.promoted_count}")
    print(f"  * Active in Backlog:  {report.active_proposals}")

    proposals = curator.adapter.get_tasks(tag=tag, status="pending")
    if proposals:
        print(f"\n[Proposal Curator] Top Pending Proposals ({tag}):")
        for t in proposals[:5]:
            sub_str = f" ({len(t.subtasks)} subtasks)" if t.subtasks else " (unexpanded)"
            print(f"  #{t.id} [{t.priority.upper()}]: {t.title}{sub_str}")
    else:
        print(f"\n[Proposal Curator] No pending proposals in '{tag}' — all curated or promoted.")

    # Always show the master queue status
    master_tasks = curator.adapter.get_tasks(tag="master", status="pending")
    if master_tasks:
        print(f"\n[Master Queue] {len(master_tasks)} active task(s) ready to execute:")
        for t in master_tasks[:5]:
            sub_str = f" ({len(t.subtasks)} subtasks)" if t.subtasks else " (no subtasks)"
            print(f"  #{t.id} [{t.priority.upper()}]: {t.title}{sub_str}")
        if len(master_tasks) > 5:
            print(f"  ... and {len(master_tasks) - 5} more. Run: task-master list")
    else:
        print(f"\n[Master Queue] Empty — all master tasks are done or no tasks promoted yet.")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Featherduster Proposal Curator Loop")
    parser.add_argument("--interval", type=int, default=0, help="Loop interval in seconds (0 to run once)")
    parser.add_argument("--tag", type=str, default="proposals", help="TaskMaster tag context to curate")
    parser.add_argument("--max-expand", type=int, default=3, help="Max proposals to expand with subtasks per cycle")
    parser.add_argument("--promote", action="store_true", help="Promote top curated proposal to 'master' tag")
    args = parser.parse_args()

    adapter = TaskMasterAdapter(repo_root)
    curator = ProposalCurator(repo_root=repo_root, adapter=adapter)

    cycle = 1
    while True:
        print(f"=== Proposal Curator Cycle #{cycle} ===")
        run_curator_cycle(curator, args.tag, args.max_expand, args.promote)

        if args.interval <= 0:
            break

        print(f"[Proposal Curator] Sleeping for {args.interval}s until next curation cycle...")
        try:
            time.sleep(args.interval)
            cycle += 1
        except KeyboardInterrupt:
            print("\n[Proposal Curator] Stopped by user.")
            break


if __name__ == "__main__":
    main()
