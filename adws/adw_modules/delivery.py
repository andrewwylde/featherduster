"""Retain outcome context and verify independent, current delivery evidence.

Code validates provenance/coverage. The separate reviewer judges whether the
captured behavior actually satisfies the contract; file existence is not a UX oracle.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

from sssf_core import quality
from sssf_core.data_types import AgentCall, GateReport, PhaseParams, QualityCheckSpec

from .data_types import CaptureManifest, CurrentIdentity, DeliveryContract, DeliveryReviewOutput


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def file_digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _git(root: Path, args: list[str]) -> bytes:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True).stdout


def source_identity(root: Path, excludes: list[str]) -> str:
    """Include untracked code and same-size edits; omit only runtime exclusions."""
    paths = set(_git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split(b"\0"))
    records = []
    for raw in sorted(paths - {b""}):
        name = os.fsdecode(raw).replace("\\", "/")
        if any(name == p.rstrip("/") or name.startswith(p.rstrip("/") + "/") for p in excludes):
            continue
        path = root / name
        value = ("symlink:" + os.readlink(path) if path.is_symlink() else
                 file_digest(path) if path.is_file() else "missing")
        records.append((name, value))
    return digest([_git(root, ["rev-parse", "HEAD"]).decode().strip(), records])


def retained_prompt(prompt: str, contract: DeliveryContract, context: Path) -> str:
    return (prompt + "\n\n## Retained delivery contract (complete; failures supplement this)\n"
            + contract.model_dump_json(indent=2)
            + f"\n\nRead the original plan at {context / 'plan.md'} when it exists. "
              f"Read full earlier build/repair reports at {context / 'delivery-build-history.json'}. "
              "Do not replace outcome requirements with a test failure or shorten them to fix summaries.")


def retain_history(run) -> None:
    """Archive complete builder reports before the next repair overwrites its envelope."""
    source = run.session_dir / "builder" / "envelope.json"
    if not source.is_file():
        return
    target = run.context_handoff_dir / "delivery-build-history.json"
    history = json.loads(target.read_text(encoding="utf-8")) if target.exists() else []
    current = json.loads(source.read_text(encoding="utf-8"))
    if not history or current != history[-1]:
        history.append(current)
        target.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def _artifact(path: Path, directory: Path) -> dict:
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(directory.resolve()) or not resolved.is_file() or resolved.stat().st_size == 0:
        raise ValueError(f"capture artifact must be a nonempty file inside {directory}: {path}")
    return {"path": str(resolved), "sha256": file_digest(resolved)}


def probe_identity(run, command, directory: Path | None = None) -> CurrentIdentity:
    """Recheck both the served build and authoritative live outcome, independently."""
    argv = [arg.replace("{repo_root}", str(run.repo_root))
            .replace("{python}", __import__("sys").executable) for arg in command.identity_argv]
    if directory is not None:
        argv = [arg.replace("{evidence_dir}", str(directory))
                .replace("{manifest}", str(directory / f"{command.id}.json")) for arg in argv]
    argv[0] = shutil.which(argv[0]) or argv[0]
    result = quality.run_check(run, QualityCheckSpec(name=f"delivery_identity_{command.id}",
        area="backend", operation="test", argv=argv, timeout_seconds=command.timeout_seconds))
    if not result.passed or result.output_truncated or not result.output_tail.strip():
        raise ValueError(f"{command.id}: served-build identity probe failed or produced no complete identity")
    return CurrentIdentity.model_validate_json(result.output_tail.strip())


def capture_evidence(run, contract: DeliveryContract) -> dict:
    """Run declared checks in code phases; capture immutable evidence before review."""
    directory = run.context_handoff_dir / ("delivery-evidence-" + uuid4().hex)
    directory.mkdir(parents=True)
    records = []
    reference_files, reference_errors = [], []
    for reference in contract.product_references:
        path = (run.repo_root / reference.path).resolve()
        try:
            reference_files.append({"reference": reference.path, "path": str(path), "sha256": file_digest(path)})
        except OSError as error:
            reference_errors.append(f"{reference.path}: {error}")
    before = source_identity(run.repo_root, run.cfg.defaults.git_excludes)
    for command in contract.evidence_commands:
        manifest_path = directory / f"{command.id}.json"
        replacements = {"{evidence_dir}": str(directory), "{manifest}": str(manifest_path),
                        "{repo_root}": str(run.repo_root), "{python}": __import__("sys").executable}
        argv = list(command.argv)
        for key, value in replacements.items():
            argv = [arg.replace(key, value) for arg in argv]
        argv[0] = shutil.which(argv[0]) or argv[0]
        with run.phase(PhaseParams(name=f"delivery_capture_{command.id}_{uuid4().hex[:8]}",
                kind="code", owner="quality", description=f"Capture observed outcomes for {command.id}")) as ph:
            result = quality.run_check(run, QualityCheckSpec(name=f"delivery_{command.id}",
                area="backend", operation="test", argv=argv, timeout_seconds=command.timeout_seconds))
            record = {"id": command.id, "kind": command.kind, "passed": result.passed,
                      "files": [], "capture": None, "errors": [], "evidence_dir": str(directory)}
            try:
                # Copy logs into this capture's own directory so later checks cannot overwrite them.
                log = directory / f"{command.id}.log"
                shutil.copyfile(result.output_artifact, log)
                record["files"].append(_artifact(log, directory))
                if command.kind != "check":
                    capture = CaptureManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
                    current = probe_identity(run, command, directory)
                    if (capture.served_build_identity != current.served_build_identity
                            or capture.outcome_identity != current.outcome_identity):
                        raise ValueError("captured served build/outcome does not match the independent current-state probe")
                    if set(capture.scenario_ids) != set(command.scenario_ids):
                        raise ValueError("capture scenario IDs do not match the command")
                    if command.kind == "browser" and not any(a.kind == "screenshot" for a in capture.artifacts):
                        raise ValueError("browser capture requires a screenshot")
                    record["files"].append(_artifact(manifest_path, directory))
                    for artifact in capture.artifacts:
                        record["files"].append(_artifact(directory / artifact.path, directory))
                    record["capture"] = capture.model_dump()
            except (OSError, ValueError) as error:
                record["errors"].append(str(error))
            record["passed"] = record["passed"] and not record["errors"]
            records.append(record)
            ph.log(passed=record["passed"], artifacts=[f["path"] for f in record["files"]],
                   errors=record["errors"])
    after = source_identity(run.repo_root, run.cfg.defaults.git_excludes)
    bundle = {"contract_sha256": digest(contract.model_dump()), "source_sha256": after,
              "source_unchanged_during_capture": before == after, "records": records,
              "reference_files": reference_files, "reference_errors": reference_errors}
    bundle["evidence_sha256"] = digest(bundle)
    (directory / "bundle.json").write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    return bundle


def acceptance_report(contract: DeliveryContract, bundle: dict, review: DeliveryReviewOutput | None,
                      current_source: str) -> GateReport:
    report = GateReport()
    report.check("capture source", bundle["source_unchanged_during_capture"], "source unchanged during evidence capture")
    report.check("current source", current_source == bundle["source_sha256"], "review must match the current source bytes")
    report.check("contract", digest(contract.model_dump()) == bundle["contract_sha256"], "contract matches captured evidence")
    unsigned = {k: v for k, v in bundle.items() if k != "evidence_sha256"}
    report.check("bundle", digest(unsigned) == bundle["evidence_sha256"], "evidence bundle fingerprint matches")
    report.check("references", not bundle["reference_errors"], "; ".join(bundle["reference_errors"]) or "named references captured")
    report.check("reference coverage", [r["reference"] for r in bundle["reference_files"]]
                 == [r.path for r in contract.product_references], "every named reference is bound to this review")
    for reference in bundle["reference_files"]:
        path = Path(reference["path"])
        report.check(reference["reference"], path.is_file() and file_digest(path) == reference["sha256"],
                     "named reference bytes remain unchanged, including installed skills outside the repository")
    records = {record["id"]: record for record in bundle["records"]}
    report.check("evidence coverage", set(records) == {c.id for c in contract.evidence_commands}
                 and len(records) == len(bundle["records"]), "every declared command has exactly one evidence record")
    for key, record in records.items():
        report.check(key, record["passed"], "; ".join(record["errors"]) or "capture command completed successfully")
        for artifact in record["files"]:
            path = Path(artifact["path"])
            report.check(str(path), path.is_file() and file_digest(path) == artifact["sha256"],
                         "captured evidence remains unchanged")
    report.check("independent review", review is not None, "a separate outcome review is required")
    if review is None:
        return report
    for key in ("contract_sha256", "source_sha256", "evidence_sha256"):
        report.check(key, getattr(review, key) == bundle[key], "review binds the current contract/source/evidence")
    report.check("review executed", review.status == "success", "review execution completed")
    report.check("blocking findings", not review.blocking_findings, "; ".join(review.blocking_findings) or "no open blocking findings")
    if contract.interactive:
        report.check("entry assessment", bool(review.entry_assessment.strip()), "review explains why stopped, next action, and where")
    expected = {c.id for c in contract.required_criteria}
    actual = {v.id for v in review.criteria}
    report.check("criterion coverage", actual == expected and len(actual) == len(review.criteria), "exactly one verdict per required criterion")
    requirements = {c.id: set(c.command_ids) for c in contract.required_criteria}
    for verdict in review.criteria:
        report.check(verdict.id, verdict.verdict == "pass", verdict.observation)
        report.check(f"{verdict.id} evidence", set(verdict.evidence_ids) == requirements.get(verdict.id, set()),
                     "verdict cites every required evidence command")
    return report


def review_delivery(run, contract: DeliveryContract, bundle: dict, user_request: str) -> DeliveryReviewOutput:
    prompt = ("Independently evaluate the requested user checkpoint. Inspect the actual captured artifacts, "
              "including default browser screenshots before reading interaction traces. Judge task usability "
              "and whether the capture's served-build identity method binds the actual served bytes. "
              "Do not read builder reports or its walkthrough recipe. Missing/unclear evidence is not_run/fail.\n\n"
              + "\n\nOriginal user request:\n" + user_request + "\n\nRetained contract:\n"
              + contract.model_dump_json(indent=2) + "\n\nCaptured evidence:\n" + json.dumps(bundle, indent=2))
    with run.phase(PhaseParams(name="delivery_review_" + uuid4().hex[:8], kind="agent",
            owner="delivery_reviewer", retries=0, description="Independently judge the actual user checkpoint from captured outcomes")) as ph:
        return ph.call(AgentCall(output_type=DeliveryReviewOutput, prompt=prompt, fresh_session=True))


def validate_delivery(run, contract: DeliveryContract, bundle: dict, review) -> GateReport:
    with run.phase(PhaseParams(name="delivery_acceptance_" + uuid4().hex[:8], kind="code", owner="quality",
            description="Reject missing, failed, stale, or unsupported outcome evidence")) as ph:
        identity_checks = []
        records = {r["id"]: r for r in bundle["records"]}
        for command in contract.evidence_commands:
            if command.kind != "check":
                try:
                    record = records.get(command.id, {})
                    directory = Path(record["evidence_dir"]) if record.get("evidence_dir") else None
                    current = probe_identity(run, command, directory)
                    captured = records.get(command.id, {}).get("capture") or {}
                    identity_checks.append((command.id,
                        current.served_build_identity == captured.get("served_build_identity")
                        and current.outcome_identity == captured.get("outcome_identity"),
                        "served build AND current outcome must still match the reviewed browser/live evidence"))
                except ValueError as error:
                    identity_checks.append((command.id, False, str(error)))
        report = acceptance_report(contract, bundle, review,
                                   source_identity(run.repo_root, run.cfg.defaults.git_excludes))
        for key, passed, note in identity_checks:
            report.check(f"{key} served identity", passed, note)
        ph.log(passed=report.passed, checks=[c.model_dump() for c in report.checks])
        target = run.context_handoff_dir / "delivery-acceptance.json"
        target.write_text(report.model_dump_json(indent=2), encoding="utf-8")
        return report


def delivery_prompt(prompt: str, contract: DeliveryContract, run) -> str:
    return retained_prompt(prompt, contract, run.context_handoff_dir)
