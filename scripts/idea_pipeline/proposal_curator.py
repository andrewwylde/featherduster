"""Proposal Curator for Featherduster.

Monitors the TaskMaster 'proposals' tag, performing:
1. Deduplication: Identifies semantic duplicates, merges supplementary context, and cancels redundancies.
2. Ranking: Scores proposals by architectural leverage, test gaps, feasibility, and centrality.
3. Expansion: Synthesizes structured subtasks (falsifiable test specs, implementation, verification guards).
4. Promotion: Optionally promotes top expanded proposal to the active work queue ('master' tag).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .taskmaster_adapter import TaskMasterAdapter, TaskMasterTask

WORD_RE = re.compile(r"\b[a-zA-Z0-9_]{3,}\b")
STOPWORDS = {
    "add", "unit", "test", "coverage", "for", "in", "the", "a", "an", "to",
    "of", "and", "module", "does", "not", "have", "dedicated", "file", "with",
    "resolve", "fix", "implement", "update", "packages", "src", "featherduster"
}


def token_similarity(str1: str, str2: str) -> float:
    """Compute Jaccard similarity between two strings, ignoring generic stopwords."""
    tokens1 = {w for w in WORD_RE.findall(str1.lower()) if w not in STOPWORDS}
    tokens2 = {w for w in WORD_RE.findall(str2.lower()) if w not in STOPWORDS}
    if not tokens1 or not tokens2:
        return 0.0
    intersection = len(tokens1 & tokens2)
    union = len(tokens1 | tokens2)
    return intersection / union if union > 0 else 0.0


@dataclass
class CuratedReport:
    deduped_count: int
    ranked_count: int
    expanded_count: int
    promoted_count: int
    active_proposals: int


class ProposalCurator:
    """Curator bot that manages, refines, and promotes proposals in TaskMaster."""

    def __init__(self, repo_root: Path | None = None, adapter: TaskMasterAdapter | None = None) -> None:
        self.repo_root = (repo_root or Path.cwd()).resolve()
        self.adapter = adapter or TaskMasterAdapter(self.repo_root)

    def deduplicate(self, tag: str = "proposals", similarity_threshold: float = 0.60) -> list[int]:
        """Detect duplicate or overlapping proposals and cancel redundant tasks."""
        tasks = self.adapter.get_tasks(tag=tag, status="pending")
        cancelled_ids: list[int] = []

        for i in range(len(tasks)):
            t1 = tasks[i]
            if t1.id in cancelled_ids:
                continue

            for j in range(i + 1, len(tasks)):
                t2 = tasks[j]
                if t2.id in cancelled_ids:
                    continue

                sim = token_similarity(f"{t1.title} {t1.description}", f"{t2.title} {t2.description}")
                if sim >= similarity_threshold:
                    # Merge context into t1
                    t1.details += f"\n\n[Merged context from duplicate #{t2.id}]:\n{t2.description}\n{t2.details}"
                    self.adapter.update_task(t1, tag=tag)

                    # Mark t2 as cancelled with duplicate explanation
                    t2.status = "cancelled"
                    t2.details += f"\n[Cancelled]: Duplicate of proposal #{t1.id} (similarity: {sim:.2f})"
                    self.adapter.update_task(t2, tag=tag)
                    cancelled_ids.append(t2.id)

        return cancelled_ids

    def rank(self, tag: str = "proposals") -> list[TaskMasterTask]:
        """Score and prioritize proposals based on architectural leverage, stability, and gaps."""
        tasks = self.adapter.get_tasks(tag=tag, status="pending")

        def score_task(t: TaskMasterTask) -> int:
            score = 50
            if "opportunity" in t.tags:
                score += 35
            if "architecture" in t.tags or "boundary-leak" in t.tags:
                score += 30
            if "fixme" in t.tags or "xxx" in t.tags:
                score += 25
            if "stub" in t.tags:
                score += 20
            if "test-gap" in t.tags:
                score += 15 if "core" in t.tags else 10
            if t.priority == "high":
                score += 15
            elif t.priority == "low":
                score -= 15
            return score

        scored_tasks = sorted(tasks, key=score_task, reverse=True)

        for task in scored_tasks:
            s = score_task(task)
            new_prio = "high" if s >= 75 else ("medium" if s >= 45 else "low")
            if task.priority != new_prio:
                task.priority = new_prio
                self.adapter.update_task(task, tag=tag)

        return scored_tasks

    def expand(self, tag: str = "proposals", max_expand: int = 3) -> list[TaskMasterTask]:
        """Synthesize structured subtasks with falsifiable test criteria for top proposals."""
        tasks = self.adapter.get_tasks(tag=tag, status="pending")
        # Find tasks without subtasks
        unexpanded = [t for t in tasks if not t.subtasks]
        expanded: list[TaskMasterTask] = []

        for task in unexpanded[:max_expand]:
            subtasks = [
                {
                    "id": f"{task.id}.1",
                    "title": f"1. Falsifiable Specification for {task.title}",
                    "description": f"Author Vitest assertions or gate checks verifying the expected behavior before changes: {task.testStrategy or 'npx vitest run'}",
                    "status": "pending",
                },
                {
                    "id": f"{task.id}.2",
                    "title": f"2. Implementation of {task.title}",
                    "description": f"Implement changes satisfying requirements: {task.description}\n{task.details}",
                    "status": "pending",
                },
                {
                    "id": f"{task.id}.3",
                    "title": "3. Verification & Monorepo Guard",
                    "description": "Run full test suite (`npm test`) and monorepo build (`npm run build`) to ensure zero regressions.",
                    "status": "pending",
                },
            ]
            task.subtasks = subtasks
            self.adapter.update_task(task, tag=tag)
            expanded.append(task)

        return expanded

    def curate(
        self,
        tag: str = "proposals",
        max_expand: int = 3,
        promote_top: bool = False,
    ) -> CuratedReport:
        """Run full curation pass: deduplicate, rank, expand subtasks, and optionally promote."""
        self.adapter.ensure_initialized([tag, "master"])

        # 1. Deduplication
        cancelled = self.deduplicate(tag=tag)

        # 2. Ranking
        ranked = self.rank(tag=tag)

        # 3. Expansion
        expanded = self.expand(tag=tag, max_expand=max_expand)

        # 4. Optional promotion of top candidate with subtasks
        promoted_count = 0
        if promote_top:
            ready_to_promote = [t for t in self.adapter.get_tasks(tag=tag, status="pending") if t.subtasks]
            if ready_to_promote:
                top_candidate = ready_to_promote[0]
                promoted = self.adapter.promote_task(top_candidate.id, from_tag=tag, to_tag="master")
                if promoted:
                    promoted_count = 1

        active_pending = len(self.adapter.get_tasks(tag=tag, status="pending"))

        return CuratedReport(
            deduped_count=len(cancelled),
            ranked_count=len(ranked),
            expanded_count=len(expanded),
            promoted_count=promoted_count,
            active_proposals=active_pending,
        )
