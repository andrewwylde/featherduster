#!/usr/bin/env python
"""Autonomous Feature Pipeline for Featherduster.

Coordinates the dual-bot loop:
1. Scanner: Discovers opportunities across the Featherduster codebase (TODOs, test gaps,
   stubs, architecture leaks, and domain opportunities) and publishes proposals into TaskMaster.
2. Curator: Analyzes incoming proposals, deduplicates them, ranks by architectural impact,
   expands into executable subtasks, and prepares them for agentic execution.

Usage:
    python scripts/autonomous_feature_pipeline.py [--interval SECONDS] [--promote] [--dry-run]
"""

import argparse
import sys
import time
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root / "scripts"))

from idea_pipeline.idea_scanner import IdeaScanner
from idea_pipeline.proposal_curator import ProposalCurator
from idea_pipeline.taskmaster_adapter import TaskMasterAdapter


def run_pipeline_iteration(
    scanner: IdeaScanner,
    curator: ProposalCurator,
    categories: list[str] | None = None,
    tag: str = "proposals",
    max_proposals: int = 10,
    max_expand: int = 3,
    promote: bool = False,
    dry_run: bool = False,
) -> None:
    print(f"\n=======================================================")
    print(f"   STAGE 1: Codebase Idea Scanning (Tag: '{tag}')")
    print(f"=======================================================")
    ideas = scanner.scan(categories=categories)
    print(f"Scanned {len(ideas)} raw candidate(s) from codebase.")
    by_cat: dict[str, int] = {}
    for i in ideas:
        by_cat[i.category] = by_cat.get(i.category, 0) + 1
    for cat, count in by_cat.items():
        print(f"  * {cat}: {count} candidate(s)")

    if not dry_run:
        published = scanner.publish_proposals(ideas, tag=tag, max_new=max_proposals)
        print(f"\nPublished {len(published)} new proposal(s) to TaskMaster.")
        for p in published:
            print(f"  + Task #{p.id} [{p.priority.upper()}]: {p.title}")
    else:
        print(f"[Dry Run] Skipping publishing.")

    print(f"\n=======================================================")
    print(f"   STAGE 2: Proposal Curation & Expansion")
    print(f"=======================================================")
    if not dry_run:
        report = curator.curate(tag=tag, max_expand=max_expand, promote_top=promote)
        print(f"Curation Summary:")
        print(f"  * Overlapping Deduped: {report.deduped_count}")
        print(f"  * Prioritized/Ranked:  {report.ranked_count}")
        print(f"  * Expanded Subtasks:   {report.expanded_count}")
        print(f"  * Promoted to Master:  {report.promoted_count}")
        print(f"  * Total Active Queue:  {report.active_proposals}")
    else:
        print(f"[Dry Run] Skipping curation.")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Autonomous Feature Pipeline for Featherduster")
    parser.add_argument("--interval", type=int, default=0, help="Loop interval in seconds (0 to run once)")
    parser.add_argument("--tag", type=str, default="proposals", help="TaskMaster tag context")
    parser.add_argument("--categories", type=str, default="opportunity,architecture,todo,stub",
                        help="Comma-separated categories to scan (default: opportunity,architecture,todo,stub)")
    parser.add_argument("--include-test-gaps", action="store_true",
                        help="Include mechanical unit test coverage gaps in scanning")
    parser.add_argument("--max-proposals", type=int, default=10, help="Max new proposals to add per scan")
    parser.add_argument("--max-expand", type=int, default=3, help="Max proposals to expand with subtasks")
    parser.add_argument("--promote", action="store_true", help="Promote highest ranked expanded proposal to 'master'")
    parser.add_argument("--dry-run", action="store_true", help="Analyze without modifying TaskMaster")
    args = parser.parse_args()

    cats = [c.strip() for c in args.categories.split(",") if c.strip()]
    if args.include_test_gaps and "test_gap" not in cats:
        cats.append("test_gap")

    adapter = TaskMasterAdapter(repo_root)
    scanner = IdeaScanner(repo_root=repo_root, adapter=adapter)
    curator = ProposalCurator(repo_root=repo_root, adapter=adapter)

    cycle = 1
    while True:
        print(f"\n>>> Autonomous Feature Pipeline Iteration #{cycle} <<<")
        run_pipeline_iteration(
            scanner=scanner,
            curator=curator,
            categories=cats,
            tag=args.tag,
            max_proposals=args.max_proposals,
            max_expand=args.max_expand,
            promote=args.promote,
            dry_run=args.dry_run,
        )

        if args.interval <= 0:
            break

        print(f"\n[Pipeline] Sleeping for {args.interval}s until next pipeline iteration...")
        try:
            time.sleep(args.interval)
            cycle += 1
        except KeyboardInterrupt:
            print("\n[Pipeline] Stopped by user.")
            break


if __name__ == "__main__":
    main()
