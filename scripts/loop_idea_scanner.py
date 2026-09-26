#!/usr/bin/env python
"""Codebase Idea Scanner Loop for Featherduster.

Continuously or periodically scans the Featherduster codebase for feature opportunities,
technical debt, test gaps, and architectural friction, publishing structured
proposals to TaskMaster under tag 'proposals'.

Usage:
    python scripts/loop_idea_scanner.py [--interval SECONDS] [--max-proposals N] [--categories CATS] [--dry-run]
"""

import argparse
import sys
import time
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root / "scripts"))

from idea_pipeline.idea_scanner import IdeaScanner
from idea_pipeline.taskmaster_adapter import TaskMasterAdapter


def run_scanner_cycle(scanner: IdeaScanner, categories: list[str] | None, tag: str, max_proposals: int, dry_run: bool) -> int:
    print(f"\n[Idea Scanner] Starting Featherduster codebase scan (tag='{tag}')...")
    ideas = scanner.scan(categories)
    print(f"[Idea Scanner] Identified {len(ideas)} potential idea(s) across codebase.")

    if not ideas:
        print("[Idea Scanner] No new opportunities identified.")
        return 0

    # Group by category
    by_cat: dict[str, int] = {}
    for i in ideas:
        by_cat[i.category] = by_cat.get(i.category, 0) + 1
    for cat, count in by_cat.items():
        print(f"  * {cat}: {count} candidate(s)")

    if dry_run:
        print(f"\n[Dry Run] Previewing up to {max_proposals} discovered candidates:")
        for idx, idea in enumerate(ideas[:max_proposals], 1):
            print(f"  {idx}. [{idea.suggested_priority.upper()}] [{idea.category}] {idea.title}")
            if idea.source_file:
                print(f"     Source: {idea.source_file}:{idea.line_number}")
            print(f"     Strategy: {idea.test_strategy}\n")
        return 0

    published = scanner.publish_proposals(ideas, tag=tag, max_new=max_proposals)
    if published:
        print(f"\n[Idea Scanner] Successfully published {len(published)} new proposal(s) to TaskMaster (tag='{tag}'):")
        for p in published:
            print(f"  + Task #{p.id} [{p.priority.upper()}]: {p.title}")
    else:
        print(f"[Idea Scanner] All discovered ideas already exist in TaskMaster (0 new proposals filed).")

    return len(published)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Featherduster Codebase Idea Scanner Loop")
    parser.add_argument("--interval", type=int, default=0, help="Loop interval in seconds (0 to run once)")
    parser.add_argument("--categories", type=str, default="", help="Comma-separated categories (todo,test_gap,stub,architecture,opportunity)")
    parser.add_argument("--tag", type=str, default="proposals", help="TaskMaster tag context to publish to")
    parser.add_argument("--max-proposals", type=int, default=10, help="Max new proposals to publish per cycle")
    parser.add_argument("--dry-run", action="store_true", help="Scan and report without writing to TaskMaster")
    args = parser.parse_args()

    cats = [c.strip() for c in args.categories.split(",") if c.strip()] or None
    adapter = TaskMasterAdapter(repo_root)
    scanner = IdeaScanner(repo_root=repo_root, adapter=adapter)

    cycle = 1
    while True:
        print(f"=== Idea Scanner Cycle #{cycle} ===")
        run_scanner_cycle(scanner, cats, args.tag, args.max_proposals, args.dry_run)

        if args.interval <= 0:
            break

        print(f"[Idea Scanner] Sleeping for {args.interval}s until next scan cycle...")
        try:
            time.sleep(args.interval)
            cycle += 1
        except KeyboardInterrupt:
            print("\n[Idea Scanner] Stopped by user.")
            break


if __name__ == "__main__":
    main()
