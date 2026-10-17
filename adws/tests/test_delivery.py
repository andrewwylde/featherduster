"""Behavioral regressions for outcome acceptance, including the real ADW decisions.

Run using the dependencies declared in the ADW script, e.g.:
uv run --with "sssf-core @ file:///C:/Users/drewk/sssf/core" python -m unittest discover -s adws/tests -v
"""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adw_modules import delivery
from adw_modules.data_types import DeliveryContract, DeliveryReviewOutput, WorkflowRequest
from pydantic import ValidationError
from sssf_core import agents, permissions
from sssf_core.data_types import BuildOutput

ADW_PATH = Path(__file__).resolve().parents[1] / "adw_plan_build_verify_fd.py"
spec = importlib.util.spec_from_file_location("fd_delivery_adw", ADW_PATH)
adw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adw)


def contract_data():
    return {"id": "repair", "revision": 1, "scope": "engineering",
            "interactive": False, "delivery_extent": "complete",
            "user_checkpoint": "The requested outcome has independently verified evidence",
            "explicitly_remaining_scope": "",
            "product_references": [],
            "scenarios": [{"id": "source", "environment": "source", "state": "after repair",
                           "data_volume": "representative boundary cases", "load": "normal"}],
            "evidence_commands": [{"id": "regression", "kind": "check", "scenario_ids": ["source"],
                                   "argv": ["{python}", "-c", "print('observed behavior passed')"]}],
            "required_criteria": [{"id": "outcome", "outcome": "The requested boundary is verified",
                                   "command_ids": ["regression"]}]}


def verdict(bundle):
    return DeliveryReviewOutput(status="success", summary="Independent review", reviewer="delivery_reviewer",
        contract_sha256=bundle["contract_sha256"], source_sha256=bundle["source_sha256"],
        evidence_sha256=bundle["evidence_sha256"], entry_assessment="",
        criteria=[{"id": "outcome", "verdict": "pass", "observation": "Observed actual check output",
                   "evidence_ids": ["regression"]}], blocking_findings=[])


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fd-delivery-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for args in (["init", "-q"], ["config", "user.email", "fixture@example.invalid"],
                     ["config", "user.name", "Fixture"], ["config", "commit.gpgsign", "false"]):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        (self.root / "source.txt").write_text("source A", encoding="utf-8")
        subprocess.run(["git", "add", "source.txt"], cwd=self.root, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=self.root, check=True, capture_output=True)
        self.context = self.root / "adws/adw_data/sessions/fixture/context_handoff"
        self.context.mkdir(parents=True)
        self.cfg = SimpleNamespace(defaults=SimpleNamespace(git_excludes=["adws/adw_data/"],
                                                            ephemeral_paths=["adws/adw_data/"]))
        self.run = FakeRun(self)
        self.contract = DeliveryContract.model_validate(contract_data())
        self.counter = 0
        self.quality_patch = patch.object(delivery.quality, "run_check", side_effect=self.run_check)
        self.quality_patch.start()
        self.addCleanup(self.quality_patch.stop)

    def run_check(self, run, check):
        self.counter += 1
        # Exercise actual evidence subprocesses. The npm/build results are supplied
        # green to isolate whether the ADW can still wrongly accept an outcome.
        if check.name.startswith("delivery_"):
            proc = subprocess.run(check.argv, cwd=self.root, capture_output=True, text=True, timeout=10)
            passed, output = proc.returncode == 0, proc.stdout + proc.stderr
        else:
            passed, output = True, "engineering checks green"
        log = self.context / f"quality-{self.counter}.log"
        log.write_text(f"exit: {0 if passed else 1}\n{output}", encoding="utf-8")
        return SimpleNamespace(passed=passed, output_artifact=str(log), output_tail=output,
                               output_truncated=False, returncode=0 if passed else 1)

    def capture(self):
        return delivery.capture_evidence(self.run, self.contract)


class FakeRun:
    def __init__(self, fixture):
        self.repo_root = fixture.root
        self.context_handoff_dir = fixture.context
        self.session_dir = fixture.context.parent
        self.cfg = fixture.cfg
        self.engineer = "fixture"
        self.accepted = None
        self.reviews = 0
        self.repair_prompts = []
        self.review_transform = lambda review: review

    @contextmanager
    def phase(self, params):
        yield SimpleNamespace(log=lambda **kwargs: None, call=self.call)

    def call(self, call):
        if call.output_type == DeliveryReviewOutput:
            self.reviews += 1
            bundle = json.loads(call.prompt.split("Captured evidence:\n", 1)[1])
            return self.review_transform(verdict(bundle))
        self.repair_prompts.append(call.prompt)
        return BuildOutput(status="success", changed_files=["source.txt"], summary="Applied requested change")

    def repair_loop(self, **kwargs):
        self.repair_prompts.append(kwargs["prompt"])
        passed = all(c.passed for c in kwargs["verifier"](self))
        return passed, kwargs["initial_envelope"]

    def finish(self, *, accepted, reason=""):
        self.accepted, self.reason = accepted, reason
        return 0 if accepted else 1


class AcceptanceTests(Fixture):
    def test_complete_current_independent_evidence_passes(self):
        bundle = self.capture()
        self.assertTrue(delivery.acceptance_report(self.contract, bundle, verdict(bundle), bundle["source_sha256"]).passed)

    def test_green_tests_do_not_replace_missing_or_failed_outcome_review(self):
        bundle = self.capture()
        reviews = [None]
        failed = verdict(bundle)
        failed.criteria[0] = failed.criteria[0].model_copy(update={"verdict": "fail"})
        reviews.append(failed)
        not_run = verdict(bundle)
        not_run.criteria[0] = not_run.criteria[0].model_copy(update={"verdict": "not_run"})
        reviews.append(not_run)
        for review in reviews:
            with self.subTest(review=review):
                self.assertFalse(delivery.acceptance_report(self.contract, bundle, review, bundle["source_sha256"]).passed)

    def test_missing_duplicate_or_unrelated_criterion_cannot_pass(self):
        bundle = self.capture()
        for criteria in ([], verdict(bundle).criteria * 2,
                         [verdict(bundle).criteria[0].model_copy(update={"id": "unrelated"})]):
            review = verdict(bundle).model_copy(update={"criteria": criteria})
            self.assertFalse(delivery.acceptance_report(self.contract, bundle, review, bundle["source_sha256"]).passed)

    def test_open_blocking_finding_prevents_acceptance(self):
        bundle = self.capture()
        review = verdict(bundle).model_copy(update={"blocking_findings": ["User cannot find the correction action"]})
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, review, bundle["source_sha256"]).passed)

    def test_same_size_source_edit_and_untracked_code_invalidate_review(self):
        bundle = self.capture()
        (self.root / "source.txt").write_text("source B", encoding="utf-8")
        current = delivery.source_identity(self.root, self.cfg.defaults.git_excludes)
        self.assertNotEqual(bundle["source_sha256"], current)
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, verdict(bundle), current).passed)
        (self.root / "new.py").write_text("new code", encoding="utf-8")
        self.assertNotEqual(current, delivery.source_identity(self.root, self.cfg.defaults.git_excludes))

    def test_changed_contract_or_evidence_cannot_reuse_approval(self):
        bundle = self.capture()
        changed = self.contract.model_copy(update={"revision": 2})
        self.assertFalse(delivery.acceptance_report(changed, bundle, verdict(bundle), bundle["source_sha256"]).passed)
        Path(bundle["records"][0]["files"][0]["path"]).write_text("replacement evidence", encoding="utf-8")
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, verdict(bundle), bundle["source_sha256"]).passed)

    def test_wrong_review_hashes_or_evidence_links_cannot_pass(self):
        bundle = self.capture()
        for field in ("contract_sha256", "source_sha256", "evidence_sha256"):
            review = verdict(bundle).model_copy(update={field: "old"})
            self.assertFalse(delivery.acceptance_report(self.contract, bundle, review, bundle["source_sha256"]).passed)
        review = verdict(bundle)
        review.criteria[0] = review.criteria[0].model_copy(update={"evidence_ids": []})
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, review, bundle["source_sha256"]).passed)

    def test_external_reference_change_invalidates_review_without_source_change(self):
        reference = self.context / "installed-skill.md"
        reference.write_text("Version A", encoding="utf-8")
        data = contract_data()
        data["product_references"] = [{"path": str(reference), "convention": "Retain the approved outcomes"}]
        self.contract = DeliveryContract.model_validate(data)
        bundle = self.capture()
        self.assertTrue(delivery.acceptance_report(self.contract, bundle, verdict(bundle), bundle["source_sha256"]).passed)
        reference.write_text("Version B", encoding="utf-8")
        self.assertEqual(bundle["source_sha256"], delivery.source_identity(self.root, self.cfg.defaults.git_excludes))
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, verdict(bundle), bundle["source_sha256"]).passed)

    def test_fixture_scope_does_not_claim_live_recovery(self):
        data = contract_data()
        data["scope"] = "live_incident"
        with self.assertRaises(ValidationError):
            DeliveryContract.model_validate(data)

    def test_unfinished_scope_cannot_claim_complete_delivery(self):
        data = contract_data()
        data["explicitly_remaining_scope"] = "Live incident still open"
        with self.assertRaises(ValidationError):
            DeliveryContract.model_validate(data)

    def test_commands_cannot_leave_required_scenarios_uncovered(self):
        data = contract_data()
        data["scenarios"].append(dict(data["scenarios"][0], id="missing"))
        with self.assertRaises(ValidationError):
            DeliveryContract.model_validate(data)

    def test_retained_contract_and_full_history_survive_repairs(self):
        prompt = delivery.retained_prompt("Original user request", self.contract, self.context)
        self.assertIn(self.contract.model_dump_json(indent=2), prompt)
        source = self.run.session_dir / "builder/envelope.json"
        source.parent.mkdir()
        first = {"summary": "x" * 300, "notes_for_next_agent": "Full causal evidence"}
        source.write_text(json.dumps(first), encoding="utf-8")
        delivery.retain_history(self.run)
        source.write_text(json.dumps({"summary": "Second repair"}), encoding="utf-8")
        delivery.retain_history(self.run)
        history = json.loads((self.context / "delivery-build-history.json").read_text(encoding="utf-8"))
        self.assertEqual(first, history[0])
        self.assertEqual(2, len(history))


class ADWDecisionTests(Fixture):
    def execute(self, dry_run=False):
        contract_file = self.context / "input-contract.json"
        contract_file.write_text(self.contract.model_dump_json(), encoding="utf-8")
        reviewer = SimpleNamespace(writes=[], capability_profile="read_only")
        with patch.object(adw.agents, "load_config", return_value=self.cfg), \
             patch.object(adw.agents, "validate"), \
             patch.object(adw.agents, "resolve", return_value=reviewer), \
             patch.object(adw.session, "ensure", return_value=self.run), \
             patch.object(adw, "get_task_json", return_value={"id": 55, "title": "Deliver boundary"}), \
             patch.object(adw.git_helper, "commit_all", return_value="commit") as commit, \
             patch.object(adw, "mark_task_done") as done, patch.object(adw, "mark_task_failed"):
            result = adw.main(WorkflowRequest(task_id=55, config="fixture", skip_plan=True,
                                             dry_run=dry_run,
                                             delivery_contract=str(contract_file)))
        return result, commit.call_count, done.call_count

    def test_real_adw_refuses_commit_and_task_done_when_tests_green_review_failed(self):
        def reject(review):
            review.criteria[0] = review.criteria[0].model_copy(update={"verdict": "fail"})
            return review
        self.run.review_transform = reject
        result, commits, completions = self.execute()
        self.assertEqual((1, 0, 0), (result, commits, completions))
        self.assertFalse(self.run.accepted)
        self.assertEqual(adw.MAX_DELIVERY_ROUNDS, self.run.reviews)
        self.assertTrue(all(self.contract.model_dump_json(indent=2) in p for p in self.run.repair_prompts))

    def test_real_adw_accepts_complete_current_outcome(self):
        self.assertEqual((0, 1, 1), self.execute())
        self.assertTrue(self.run.accepted)

    def test_partial_checkpoint_does_not_mark_overall_task_done(self):
        data = contract_data()
        data.update(delivery_extent="checkpoint", explicitly_remaining_scope="Live job recovery and UI cleanup remain open")
        self.contract = DeliveryContract.model_validate(data)
        self.assertEqual((0, 1, 0), self.execute())

    def test_dry_run_does_not_accept_unverified_delivery(self):
        self.assertEqual((1, 0, 0), self.execute(dry_run=True))
        self.assertFalse(self.run.accepted)
        self.assertIn("delivery is unverified", self.run.reason)
        self.assertEqual(0, self.run.reviews)

    def test_change_after_review_prevents_commit_and_completion(self):
        def mutate(review):
            source = self.root / "source.txt"
            source.write_text(source.read_text(encoding="utf-8") + "!", encoding="utf-8")
            return review
        self.run.review_transform = mutate
        self.assertEqual((1, 0, 0), self.execute())

    def test_failed_capture_does_not_launch_blind_repairs_or_review(self):
        data = contract_data()
        data["evidence_commands"][0]["argv"] = ["{python}", "-c", "raise SystemExit(1)"]
        self.contract = DeliveryContract.model_validate(data)
        self.assertEqual((1, 0, 0), self.execute())
        self.assertEqual(0, self.run.reviews)


class BrowserEvidenceTests(Fixture):
    def browser_contract(self, extra=""):
        self.identity = self.context / "served-build.txt"
        self.identity.write_text("served-build-a", encoding="utf-8")
        self.outcome = self.context / "outcome.txt"
        self.outcome.write_text("healthy", encoding="utf-8")
        # A tiny valid test image exercises capture plumbing only. It is never
        # presented as usability evidence for the actual product.
        capture_code = (
            "import pathlib,sys,json,base64; p=pathlib.Path(sys.argv[1]); "
            "image=p.with_suffix('.png'); "
            "image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=')); "
            "p.write_text(json.dumps({'served_build_identity':pathlib.Path(sys.argv[2]).read_text(),"
            "'outcome_identity':pathlib.Path(sys.argv[3]).read_text(),"
            "'identity_method':'Test fixture only: independently read mutable served identity',"
            "'observation':'Test capture; not production UX evidence','scenario_ids':['source'],"
            "'artifacts':[{'path':image.name,'kind':'screenshot'}]})); " + extra)
        data = contract_data()
        data["scope"] = "interactive"
        data["interactive"] = True
        data["product_references"] = [{"path": "source.txt", "convention": "Human-facing task labels"}]
        data["scenarios"][0]["environment"] = "fixture"
        data["evidence_commands"][0].update(kind="browser",
            argv=["{python}", "-c", capture_code, "{manifest}", str(self.identity), str(self.outcome)],
            identity_argv=["{python}", "-c", "import pathlib,sys,json; print(json.dumps({'served_build_identity':pathlib.Path(sys.argv[1]).read_text(),'outcome_identity':pathlib.Path(sys.argv[2]).read_text()}))", str(self.identity), str(self.outcome)])
        self.contract = DeliveryContract.model_validate(data)

    def test_screenshot_existence_alone_is_not_acceptance(self):
        self.browser_contract()
        bundle = self.capture()
        self.assertTrue(bundle["records"][0]["passed"], bundle)
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, None, bundle["source_sha256"]).passed)
        self.assertFalse(delivery.acceptance_report(self.contract, bundle, verdict(bundle), bundle["source_sha256"]).passed)

    def test_served_build_change_after_review_invalidates_acceptance(self):
        self.browser_contract()
        bundle = self.capture()
        review = verdict(bundle).model_copy(update={"entry_assessment": "Blocked wording; edit the named proposal in place"})
        initial = delivery.validate_delivery(self.run, self.contract, bundle, review)
        self.assertTrue(initial.passed, initial.violations)
        self.identity.write_text("served-build-b", encoding="utf-8")
        report = delivery.validate_delivery(self.run, self.contract, bundle, review)
        self.assertFalse(report.passed)
        self.assertTrue(any("served identity" in v for v in report.violations))

    def test_capture_that_changes_source_is_not_current_evidence(self):
        self.browser_contract("pathlib.Path('source.txt').write_text('changed by capture')")
        bundle = self.capture()
        self.assertFalse(bundle["source_unchanged_during_capture"])

    def test_live_state_regression_with_unchanged_build_invalidates_review(self):
        self.browser_contract()
        bundle = self.capture()
        review = verdict(bundle).model_copy(update={"entry_assessment": "Blocked wording; edit the proposal here"})
        self.assertTrue(delivery.validate_delivery(self.run, self.contract, bundle, review).passed)
        self.outcome.write_text("failed", encoding="utf-8")
        self.assertFalse(delivery.validate_delivery(self.run, self.contract, bundle, review).passed)

    def test_failed_or_malformed_current_state_probe_cannot_pass(self):
        for failure in ("raise SystemExit(7)", "print('not JSON')"):
            with self.subTest(failure=failure):
                self.browser_contract()
                data = self.contract.model_dump()
                original = data["evidence_commands"][0]["identity_argv"]
                original[2] = ("import pathlib,sys,json; state=pathlib.Path(sys.argv[2]).read_text(); "
                    "exec(" + repr(failure) + ") if state != 'healthy' else "
                    "print(json.dumps({'served_build_identity':pathlib.Path(sys.argv[1]).read_text(),'outcome_identity':state}))")
                self.contract = DeliveryContract.model_validate(data)
                bundle = self.capture()
                review = verdict(bundle).model_copy(update={"entry_assessment": "Observed task surface"})
                self.assertTrue(delivery.validate_delivery(self.run, self.contract, bundle, review).passed)
                self.outcome.write_text("failed", encoding="utf-8")
                self.assertFalse(delivery.validate_delivery(self.run, self.contract, bundle, review).passed)

    def test_headless_live_incident_requires_live_evidence_without_browser_requirement(self):
        self.browser_contract()
        data = self.contract.model_dump()
        data.update(scope="live_incident", interactive=False, product_references=[])
        data["scenarios"][0]["environment"] = "live"
        data["evidence_commands"][0]["kind"] = "live"
        self.contract = DeliveryContract.model_validate(data)
        bundle = self.capture()
        self.assertTrue(delivery.validate_delivery(self.run, self.contract, bundle, verdict(bundle)).passed)

    def test_manifest_missing_or_artifact_escaping_capture_directory_fails(self):
        self.browser_contract()
        original = self.contract.model_dump()
        original["evidence_commands"][0]["argv"] = ["{python}", "-c", "print('no actual manifest')"]
        self.contract = DeliveryContract.model_validate(original)
        self.assertFalse(self.capture()["records"][0]["passed"])
        self.browser_contract("data=json.loads(p.read_text()); data['artifacts'][0]['path']=str(pathlib.Path('source.txt').resolve()); p.write_text(json.dumps(data))")
        self.assertFalse(self.capture()["records"][0]["passed"])


class ConfigurationTests(unittest.TestCase):
    def test_application_builder_cannot_weaken_factory_gates_or_acceptance_oracles(self):
        cfg = agents.load_config(str(ADW_PATH.parent / "adw_featherduster_config/sssf.config.yaml"))
        builder = agents.resolve(cfg, "builder")
        for path in ("adws/adw_plan_build_verify_fd.py", "adws/adw_modules/delivery.py",
                     "adws/adw_modules/data_types.py", "adws/contracts/factory-acceptance.json",
                     "adws/tests/test_delivery.py"):
            self.assertFalse(permissions.permitted(path, builder, cfg), path)
        self.assertTrue(permissions.permitted("packages/ui/src/views/jobs/JobProposalReview.tsx", builder, cfg))

    def test_reviewer_has_independent_read_only_boundary_and_matching_schema(self):
        cfg = agents.load_config(str(ADW_PATH.parent / "adw_featherduster_config/sssf.config.yaml"))
        reviewer = agents.resolve(cfg, "delivery_reviewer")
        self.assertEqual([], reviewer.writes)
        self.assertEqual("read_only", reviewer.capability_profile)
        permissions.validate_agent_capabilities(reviewer)
        user = (ADW_PATH.parent.parent / reviewer.prompt_engineering.user).read_text(encoding="utf-8")
        example = json.loads(user.split("```json\n")[1].split("```", 1)[0])
        DeliveryReviewOutput.model_validate(example)
        self.assertIn("delivery_reviewer", adw.REQUIRED_AGENTS)


if __name__ == "__main__":
    unittest.main()
