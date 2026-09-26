"""Unit tests for Featherduster Idea & Proposal Pipeline."""

import tempfile
import unittest
from pathlib import Path

from .idea_scanner import (
    IdeaScanner,
    ScannedIdea,
    scan_architecture_friction,
    scan_opportunities,
    scan_stubs,
    scan_test_gaps,
    scan_todos,
)
from .proposal_curator import ProposalCurator, token_similarity
from .taskmaster_adapter import TaskMasterAdapter, TaskMasterTask


class TestTaskMasterAdapter(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temp_dir.name)
        self.adapter = TaskMasterAdapter(self.project_root)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_initialization(self):
        self.adapter.ensure_initialized(["master", "proposals"])
        self.assertTrue(self.adapter.tasks_file.exists())
        tags = self.adapter.get_tags()
        self.assertIn("master", tags)
        self.assertIn("proposals", tags)

    def test_add_and_get_task(self):
        task = self.adapter.add_task(
            title="Test Task",
            description="Testing task description",
            details="Some details",
            test_strategy="npm test",
            priority="high",
            tag="proposals",
            tags=["test", "unit"],
        )
        self.assertEqual(task.id, 1)
        self.assertEqual(task.title, "Test Task")
        self.assertEqual(task.priority, "high")

        fetched = self.adapter.get_task(1, tag="proposals")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.title, "Test Task")

    def test_update_and_status(self):
        task = self.adapter.add_task(title="Status Test", description="Desc", tag="proposals")
        self.assertEqual(task.status, "pending")

        self.adapter.set_status(task.id, "done", tag="proposals")
        updated = self.adapter.get_task(task.id, tag="proposals")
        self.assertEqual(updated.status, "done")

    def test_promote_task(self):
        source = self.adapter.add_task(
            title="Promote Me",
            description="To be promoted",
            details="Promotion details",
            tag="proposals",
        )
        source.subtasks = [{"id": "1.1", "title": "Subtask 1", "status": "pending"}]
        self.adapter.update_task(source, tag="proposals")

        promoted = self.adapter.promote_task(source.id, from_tag="proposals", to_tag="master")
        self.assertIsNotNone(promoted)
        self.assertEqual(promoted.title, "Promote Me")
        self.assertEqual(len(promoted.subtasks), 1)

        # Verify source is marked done
        src_after = self.adapter.get_task(source.id, tag="proposals")
        self.assertEqual(src_after.status, "done")

        # Verify target exists in master
        master_tasks = self.adapter.get_tasks(tag="master")
        self.assertEqual(len(master_tasks), 1)


class TestIdeaScanner(unittest.TestCase):
    def setUp(self):
        self.repo_root = Path(__file__).resolve().parent.parent.parent
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_root = Path(self.temp_dir.name)
        self.adapter = TaskMasterAdapter(self.temp_root)
        self.scanner = IdeaScanner(repo_root=self.repo_root, adapter=self.adapter)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_scan_opportunities(self):
        opps = scan_opportunities(self.repo_root)
        self.assertGreater(len(opps), 0)
        self.assertTrue(any("ATS" in o.title for o in opps))

    def test_scan_architecture_friction(self):
        violations = scan_architecture_friction(self.repo_root)
        self.assertIsInstance(violations, list)

    def test_scanner_full_scan(self):
        ideas = self.scanner.scan()
        self.assertIsInstance(ideas, list)
        self.assertGreater(len(ideas), 0)

    def test_publish_proposals_prevents_duplicates(self):
        dummy_ideas = [
            ScannedIdea(
                category="opportunity",
                title="Unique Proposal A",
                description="Desc A",
                details="Details A",
                test_strategy="Strategy A",
                suggested_priority="high",
            ),
            ScannedIdea(
                category="opportunity",
                title="Unique Proposal A",  # Duplicate title in same batch
                description="Desc A duplicate",
                details="Details A duplicate",
                test_strategy="Strategy A",
                suggested_priority="high",
            ),
            ScannedIdea(
                category="opportunity",
                title="Unique Proposal B",
                description="Desc B",
                details="Details B",
                test_strategy="Strategy B",
                suggested_priority="medium",
            ),
        ]
        published = self.scanner.publish_proposals(dummy_ideas, tag="proposals")
        self.assertEqual(len(published), 2)

    def test_publish_proposals_refires_after_done(self):
        """Done/cancelled tasks should NOT block re-discovery on the next scan cycle."""
        idea = ScannedIdea(
            category="test_gap",
            title="Recoverable Proposal",
            description="Desc",
            details="Details",
            test_strategy="Strategy",
            suggested_priority="medium",
        )
        # File and promote (marks as done in proposals)
        published = self.scanner.publish_proposals([idea], tag="proposals")
        self.assertEqual(len(published), 1)
        task_id = published[0].id
        self.adapter.set_status(task_id, "done", tag="proposals")

        # Re-scan: same idea should be re-filed because the old one is done
        re_published = self.scanner.publish_proposals([idea], tag="proposals")
        self.assertEqual(len(re_published), 1, "Should re-file after the previous task is marked done")

    def test_publish_proposals_blocks_active_duplicates(self):
        """Pending/in-progress tasks SHOULD block re-filing."""
        idea = ScannedIdea(
            category="test_gap",
            title="Active Proposal",
            description="Desc",
            details="Details",
            test_strategy="Strategy",
            suggested_priority="medium",
        )
        self.scanner.publish_proposals([idea], tag="proposals")  # Creates as pending

        # Re-scan: same idea should NOT be re-filed since it's still pending
        re_published = self.scanner.publish_proposals([idea], tag="proposals")
        self.assertEqual(len(re_published), 0, "Should not re-file an idea that is still pending")


class TestProposalCurator(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_root = Path(self.temp_dir.name)
        self.adapter = TaskMasterAdapter(self.temp_root)
        self.curator = ProposalCurator(repo_root=self.temp_root, adapter=self.adapter)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_token_similarity(self):
        sim1 = token_similarity("Add unit test coverage for desk", "Add unit test coverage for desk")
        self.assertEqual(sim1, 1.0)

        sim2 = token_similarity("Completely unrelated text apples oranges", "Quantum physics semiconductor")
        self.assertEqual(sim2, 0.0)

    def test_curate_dedupe_rank_expand(self):
        self.adapter.add_task(
            title="Fix architecture leak in packages/core",
            description="Core library module illegally imports cli",
            priority="high",
            tag="proposals",
            tags=["codebase-scan", "architecture"],
        )
        self.adapter.add_task(
            title="Fix architecture leak in packages/core",
            description="Core library module illegally imports cli duplicate copy",
            priority="high",
            tag="proposals",
            tags=["codebase-scan", "architecture"],
        )
        self.adapter.add_task(
            title="Add test coverage for rubric parser",
            description="Module has no test file in core tests",
            priority="medium",
            tag="proposals",
            tags=["codebase-scan", "test-gap", "core"],
        )

        report = self.curator.curate(tag="proposals", max_expand=2, promote_top=False)
        self.assertEqual(report.deduped_count, 1)
        self.assertEqual(report.expanded_count, 2)
        self.assertEqual(report.active_proposals, 2)

        active = self.adapter.get_tasks(tag="proposals", status="pending")
        for task in active:
            self.assertEqual(len(task.subtasks), 3)


if __name__ == "__main__":
    unittest.main()
