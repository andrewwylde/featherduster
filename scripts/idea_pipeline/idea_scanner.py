"""Codebase Idea Scanner for Featherduster.

Analyzes the Featherduster TypeScript/Node monorepo for feature opportunities,
technical debt, test coverage gaps, stubs, and architectural friction, publishing
structured proposals into TaskMaster under tag 'proposals'.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .taskmaster_adapter import TaskMasterAdapter, TaskMasterTask

TODO_PATTERN = re.compile(
    r"(?://|#|/\*|\*)\s*(TODO|FIXME|HACK|OPTIMIZE|XXX)\s*[:\-]?\s*(.+)",
    re.IGNORECASE,
)

STUB_PATTERNS = [
    re.compile(r"throw\s+new\s+Error\s*\(\s*['\"](?:Not implemented|TODO|Unimplemented|stub)['\"]", re.IGNORECASE),
    re.compile(r"(?://|/\*)\s*(?:STUB|PLACEHOLDER|MOCK_ONLY)\b", re.IGNORECASE),
]

EXCLUDED_DIRS = {
    "node_modules",
    "dist",
    ".git",
    ".taskmaster",
    "walkthrough-output",
    ".gemini",
    ".vscode",
    ".idea",
    "build",
    "coverage",
}


@dataclass
class ScannedIdea:
    category: str  # "todo", "test_gap", "stub", "architecture", "opportunity"
    title: str
    description: str
    details: str
    test_strategy: str
    suggested_priority: str = "medium"  # "high", "medium", "low"
    source_file: str = ""
    line_number: int = 0
    tags: list[str] = field(default_factory=list)


def is_excluded(path: Path) -> bool:
    """Check if path contains any excluded directory names."""
    return any(part in EXCLUDED_DIRS for part in path.parts)


def scan_todos(repo_root: Path) -> list[ScannedIdea]:
    """Scan TypeScript/JavaScript/JSON/CSS/Markdown files for TODO/FIXME/HACK comments."""
    ideas: list[ScannedIdea] = []
    scan_extensions = {".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".md"}

    scan_roots = [
        repo_root / "packages",
        repo_root / "scripts",
        repo_root / "docs",
    ]

    for root in scan_roots:
        if not root.exists():
            continue
        for file_path in root.rglob("*"):
            if not file_path.is_file() or file_path.suffix not in scan_extensions:
                continue
            if is_excluded(file_path):
                continue

            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue

            for idx, line in enumerate(lines, 1):
                match = TODO_PATTERN.search(line)
                if match:
                    tag_type = match.group(1).upper()
                    comment_text = match.group(2).strip().rstrip("*/").strip()
                    if not comment_text or len(comment_text) < 3:
                        continue

                    rel_path = file_path.relative_to(repo_root).as_posix()
                    priority = "high" if tag_type in ("FIXME", "XXX") else "medium"

                    summary_comment = comment_text[:60]
                    title = f"Resolve {tag_type} in {file_path.name}: {summary_comment}"
                    desc = f"Address {tag_type} comment found in {rel_path} at line {idx}."

                    start_ctx = max(0, idx - 3)
                    end_ctx = min(len(lines), idx + 3)
                    context_snippet = "\n".join(f"{i+1}: {lines[i]}" for i in range(start_ctx, end_ctx))

                    details = (
                        f"File: {rel_path}:{idx}\n"
                        f"Comment: {line.strip()}\n"
                        f"Context:\n{context_snippet}"
                    )

                    test_strategy = f"Run vitest test suite verifying behavior in {rel_path}: npx vitest run"

                    ideas.append(
                        ScannedIdea(
                            category="todo",
                            title=title,
                            description=desc,
                            details=details,
                            test_strategy=test_strategy,
                            suggested_priority=priority,
                            source_file=rel_path,
                            line_number=idx,
                            tags=["codebase-scan", "todo", tag_type.lower()],
                        )
                    )

    return ideas


def scan_test_gaps(repo_root: Path) -> list[ScannedIdea]:
    """Identify source modules in packages/*/src that lack dedicated unit/integration tests."""
    ideas: list[ScannedIdea] = []
    packages_dir = repo_root / "packages"
    if not packages_dir.exists():
        return ideas

    for pkg_dir in packages_dir.iterdir():
        if not pkg_dir.is_dir() or is_excluded(pkg_dir):
            continue

        src_dir = pkg_dir / "src"
        test_dir = pkg_dir / "tests"
        if not src_dir.exists():
            continue

        # Collect existing test file names and all text in tests for import detection
        test_files: list[Path] = []
        all_test_content = ""
        if test_dir.exists():
            for tf in test_dir.rglob("*"):
                if tf.is_file() and (".test." in tf.name or ".spec." in tf.name):
                    test_files.append(tf)
                    try:
                        all_test_content += tf.read_text(encoding="utf-8") + "\n"
                    except Exception:
                        pass

        for src_file in src_dir.rglob("*.ts*"):
            if not src_file.is_file() or is_excluded(src_file):
                continue
            # Skip declarations, indexes, templates, and type definition files
            if src_file.name.endswith(".d.ts") or src_file.stem in ("index", "types") or "templates" in src_file.parts:
                continue

            stem = src_file.stem
            # Check if matching test file exists by name (e.g. stem.test.ts, stem.test.tsx)
            has_dedicated_test = any(stem in tf.stem for tf in test_files)
            if has_dedicated_test:
                continue

            # Check if stem is referenced directly
            is_referenced_in_tests = (
                (f"/{stem}" in all_test_content)
                or (f"'{stem}'" in all_test_content)
                or (f'"{stem}"' in all_test_content)
            )
            if is_referenced_in_tests:
                continue

            # Extract exported symbols and check if any are referenced in tests
            try:
                src_content = src_file.read_text(encoding="utf-8")
                exports = re.findall(
                    r"export\s+(?:(?:async\s+)?function|class|const|let|enum|interface|type)\s+([a-zA-Z0-9_]+)",
                    src_content,
                )
                if any(exp in all_test_content for exp in exports if len(exp) > 3):
                    continue
            except Exception:
                pass

            rel_src = src_file.relative_to(repo_root).as_posix()
            target_test_name = f"{stem}.test.ts"
            rel_target_test = (test_dir / target_test_name).relative_to(repo_root).as_posix()

            priority = "high" if "core" in rel_src else "medium"
            display_name = f"{src_file.parent.name}/{src_file.name}" if src_file.parent.name != "src" else src_file.name
            title = f"Add test coverage for {display_name}"
            desc = f"Module {rel_src} has no dedicated test file and its exports are not referenced in {pkg_dir.name} tests."
            details = (
                f"Target module: {rel_src}\n"
                f"Recommended test location: {rel_target_test}\n"
                f"Implement test cases verifying exported functions, edge cases, and failure modes."
            )
            test_strategy = f"npx vitest run {rel_target_test}"

            ideas.append(
                ScannedIdea(
                    category="test_gap",
                    title=title,
                    description=desc,
                    details=details,
                    test_strategy=test_strategy,
                    suggested_priority=priority,
                    source_file=rel_src,
                    tags=["codebase-scan", "test-gap", pkg_dir.name],
                )
            )

    return ideas


def scan_stubs(repo_root: Path) -> list[ScannedIdea]:
    """Scan TypeScript/JavaScript files for placeholder stubs and unimplemented errors."""
    ideas: list[ScannedIdea] = []
    scan_roots = [repo_root / "packages"]

    for root in scan_roots:
        if not root.exists():
            continue
        for file_path in root.rglob("*.ts*"):
            if not file_path.is_file() or is_excluded(file_path) or file_path.name.endswith(".d.ts"):
                continue

            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue

            for idx, line in enumerate(lines, 1):
                for pattern in STUB_PATTERNS:
                    if pattern.search(line):
                        rel_path = file_path.relative_to(repo_root).as_posix()
                        title = f"Implement stub in {file_path.name}:{idx}"
                        desc = f"Placeholder stub or unimplemented error discovered in {rel_path} at line {idx}."
                        details = (
                            f"File: {rel_path}:{idx}\n"
                            f"Stub line: {line.strip()}\n"
                            f"Replace placeholder with full implementation and add verification."
                        )
                        test_strategy = f"Run unit tests covering {rel_path}: npx vitest run"

                        ideas.append(
                            ScannedIdea(
                                category="stub",
                                title=title,
                                description=desc,
                                details=details,
                                test_strategy=test_strategy,
                                suggested_priority="high",
                                source_file=rel_path,
                                line_number=idx,
                                tags=["codebase-scan", "stub"],
                            )
                        )
                        break

    return ideas


def scan_architecture_friction(repo_root: Path) -> list[ScannedIdea]:
    """Scan monorepo package boundaries and import paths for architectural violations."""
    ideas: list[ScannedIdea] = []
    core_src = repo_root / "packages" / "core" / "src"
    ui_src = repo_root / "packages" / "ui" / "src"

    # Rule 1: Core must never import CLI or UI
    if core_src.exists():
        for file_path in core_src.rglob("*.ts"):
            if not file_path.is_file() or is_excluded(file_path):
                continue
            try:
                content = file_path.read_text(encoding="utf-8")
            except Exception:
                continue

            for match in re.finditer(r"from\s+['\"](@featherduster/(?:cli|ui)[^'\"]*)['\"]", content):
                leaked_pkg = match.group(1)
                rel_path = file_path.relative_to(repo_root).as_posix()
                ideas.append(
                    ScannedIdea(
                        category="architecture",
                        title=f"Fix architectural leak in core: imports {leaked_pkg}",
                        description=f"Core library module {rel_path} illegally imports from {leaked_pkg}.",
                        details=(
                            f"File: {rel_path}\n"
                            f"Illegal import: {leaked_pkg}\n"
                            f"Core must remain headless and independent of UI/CLI dependencies."
                        ),
                        test_strategy="npm run build:core && npx vitest run",
                        suggested_priority="high",
                        source_file=rel_path,
                        tags=["codebase-scan", "architecture", "boundary-leak"],
                    )
                )

    # Rule 2: UI must not import CLI server or Node builtins
    if ui_src.exists():
        for file_path in ui_src.rglob("*.ts*"):
            if not file_path.is_file() or is_excluded(file_path):
                continue
            try:
                content = file_path.read_text(encoding="utf-8")
            except Exception:
                continue

            for match in re.finditer(r"from\s+['\"](@featherduster/cli[^'\"]*|node:(?:fs|child_process)|fs|child_process)['\"]", content):
                leaked_import = match.group(1)
                rel_path = file_path.relative_to(repo_root).as_posix()
                ideas.append(
                    ScannedIdea(
                        category="architecture",
                        title=f"Fix UI architecture leak: imports {leaked_import}",
                        description=f"UI module {rel_path} imports Node-only dependency {leaked_import}.",
                        details=(
                            f"File: {rel_path}\n"
                            f"Illegal import: {leaked_import}\n"
                            f"UI must run client-side in Vite browser context without Node dependencies."
                        ),
                        test_strategy="npm run build:ui && npx vitest run",
                        suggested_priority="high",
                        source_file=rel_path,
                        tags=["codebase-scan", "architecture", "ui-leak"],
                    )
                )

    return ideas


def scan_opportunities(repo_root: Path) -> list[ScannedIdea]:
    """Inspect Featherduster domain and roadmap for career intelligence feature opportunities."""
    opportunities = [
        ScannedIdea(
            category="opportunity",
            title="ATS Simulation & Readability Gate",
            description="Add automated ATS benchmark analyzer comparing resume plain-text parsing, section header extraction, and keyword scoring across Greenhouse/Lever/Workday schemas.",
            details=(
                "Feature proposal for Featherduster Integrity Engine (packages/core/src/integrity):\n"
                "- Simulates common applicant tracking system (ATS) parsers (Workday, Greenhouse, Lever, Taleo)\n"
                "- Flags multi-column parsing distortions, table collapse, or missing standard headings\n"
                "- Evaluates keyword density and computes an ATS-readability score prior to export\n"
                "- Integrated into pre-flight checks before PDF/Typst compilation"
            ),
            test_strategy="npx vitest run packages/core/tests/integrity.test.ts",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "ats", "integrity", "core"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Automated Git & PR Evidence Ingestion",
            description="Add 'featherduster ingest --git' command to parse repository commit history, PR descriptions, and diff metrics into structured draft evidence entries.",
            details=(
                "Feature proposal for Featherduster CLI (packages/cli/src/commands/ingest.ts):\n"
                "- Runs git log and GitHub/GitLab PR scraper for the user\n"
                "- Automatically identifies measurable impact statements, bug fixes, and performance PRs\n"
                "- Sanitizes repository-specific branches, internal ticket IDs, and commit SHAs\n"
                "- Generates candidate YAML evidence files under evidence/<company>/ for quick confirmation in desk UI"
            ),
            test_strategy="npx vitest run packages/cli/tests/commands.test.ts",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "cli", "evidence-capture"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Leveling Matrix Trajectory & Promotion Packet Generator",
            description="Add multi-cycle career leveling trajectory analyzer and automated promotion dossier compiler mapping evidence to L4/L5/L6 competency ladders.",
            details=(
                "Feature proposal for Featherduster Rubric & Compilers (packages/core/src/rubric):\n"
                "- Analyzes evidence timeline against SWE-IC rubric competencies (Architecture, Execution, Leadership, Mentorship)\n"
                "- Generates promotion delta heatmap highlighting under-represented competencies\n"
                "- Compiles comprehensive audit-proof promotion packet with cited evidence and impact narrative"
            ),
            test_strategy="npx vitest run packages/core/tests/rubric.test.ts",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "rubric", "promotion", "core"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Interactive Interview Defense Simulator",
            description="Add interactive mock interview defense mode that cross-examines the user on resume bullets using the Defensibility Brief and grades answers.",
            details=(
                "Feature proposal for Featherduster UI & CLI (packages/ui/src/views/desk/PrivateBriefing.tsx):\n"
                "- Utilizes the compiled Defense Brief for selected resume bullets\n"
                "- Acts as a skeptical Staff+ / Hiring Manager interviewer: 'What was your exact contribution and what trade-offs did you make?'\n"
                "- Scores user answers against ledger citations and anti-slop rules, ensuring interview preparedness"
            ),
            test_strategy="npx vitest run packages/ui/tests/desk-briefing.test.tsx",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "ui", "interview-prep"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Docx / Word Resume Compiler Integration",
            description="Implement Word (.docx) compiler target in packages/core/src/compilers alongside Typst, LaTeX, Markdown, and HTML.",
            details=(
                "Feature proposal for Featherduster Compilers (packages/core/src/compilers/docx-compiler.ts):\n"
                "- Many corporate recruiters and agency headhunters require editable .docx formats\n"
                "- Generate clean, styled docx output preserving typography, margins, and active bullet selections\n"
                "- Enforces strict privacy redaction rules during docx compilation"
            ),
            test_strategy="npx vitest run packages/core/tests/compilers.test.ts",
            suggested_priority="medium",
            tags=["codebase-scan", "opportunity", "compilers", "export", "core"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Local Air-Gapped Vector Search for Evidence Retrieval",
            description="Implement local semantic vector search over past evidence ledger entries for rapid retrieval during job tailoring.",
            details=(
                "Feature proposal for Featherduster Core (packages/core/src/parsers/vector-index.ts):\n"
                "- Generates offline, local embeddings of evidence summaries, problem contexts, and outcomes\n"
                "- Allows instant semantic nearest-neighbor retrieval when pasting a target job description\n"
                "- 100% local-first and zero-cloud to preserve confidential career data"
            ),
            test_strategy="npx vitest run packages/core/tests/evidence-parser.test.ts",
            suggested_priority="medium",
            tags=["codebase-scan", "opportunity", "local-first", "search", "core"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Linear & Jira Local Sprint Export Ingester",
            description="Add 'featherduster ingest --jira / --linear' command to parse exported CSV/JSON sprint histories into draft evidence entries.",
            details=(
                "Feature proposal for Featherduster CLI (packages/cli/src/commands/ingest.ts):\n"
                "- Ingests exported sprint retrospectives and resolved ticket exports\n"
                "- Automatically parses technical problem descriptions and resolutions\n"
                "- Sanitizes internal ticket IDs according to privacy-rules.yaml before staging evidence"
            ),
            test_strategy="npx vitest run packages/cli/tests/commands.test.ts",
            suggested_priority="medium",
            tags=["codebase-scan", "opportunity", "cli", "ingest", "integrations"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Visual Story Threads & Impact DAG Visualization",
            description="Add interactive Directed Acyclic Graph (DAG) visualizing career accomplishments from technical challenges to production metrics.",
            details=(
                "Feature proposal for Featherduster UI (packages/ui/src/views/desk/StoryThreadsNodeMap.tsx):\n"
                "- Graph visualization mapping Technical Challenges -> Architectural Interventions -> Measurable Outcomes\n"
                "- Allows engineers and hiring committees to interactively explore the proof trail behind resume bullets\n"
                "- Highlights skill clusters, leveling competency coverage, and architectural breadth"
            ),
            test_strategy="npx vitest run packages/ui/tests/story-threads.test.tsx",
            suggested_priority="medium",
            tags=["codebase-scan", "opportunity", "ui", "visualization"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Two-Pane Side-by-Side Tailoring Diff Inspector",
            description="Add interactive side-by-side diff visualizer comparing original evidence bullets against tailored proposals before applying.",
            details=(
                "Feature proposal for Featherduster UI Tailoring View (packages/ui/src/views/tailoring/wordDiff.ts):\n"
                "- Side-by-side visual diff editor highlighting word-level additions, deletions, and citation rewrites\n"
                "- Direct inline linter showing de-slop compliance and metric groundings\n"
                "- One-click accept/reject per bullet edit"
            ),
            test_strategy="npx vitest run packages/ui/tests/tailoring.test.tsx",
            suggested_priority="medium",
            tags=["codebase-scan", "opportunity", "ui", "tailoring"],
        ),
        ScannedIdea(
            category="opportunity",
            title="JSON Resume Standard Interoperability Gateway",
            description="Add bidirectional schema adapter between Featherduster verified evidence ledger and the open JSON Resume (jsonresume.org) schema.",
            details=(
                "Feature proposal for Featherduster Compilers (packages/core/src/compilers/json-resume-adapter.ts):\n"
                "- Export tailored or baseline resumes to valid schema.jsonresume.org format\n"
                "- Import existing JSON Resumes, mapping bullets into structured draft evidence entries\n"
                "- Preserves verification flags and metric status across ecosystem tools"
            ),
            test_strategy="npx vitest run packages/core/tests/compilers.test.ts",
            suggested_priority="medium",
            tags=["codebase-scan", "opportunity", "compilers", "standards", "core"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Real-Time Competency Match Radar & Role Fit Visualizer",
            description="Add multi-dimensional radar chart visualizing candidate evidence strength vs target job requirements across engineering competency axes.",
            details=(
                "Feature proposal for Featherduster UI (packages/ui/src/views/tailoring/CompetencyRadar.tsx):\n"
                "- Interactive radar/spider chart mapping candidate evidence against 6 core axes (Architecture, Distributed Systems, Reliability, Performance, Leadership, Mentorship)\n"
                "- Calculates quantified fit index score (%) for job postings before tailoring\n"
                "- Pinpoints exact competency gaps with direct links to ledger entries"
            ),
            test_strategy="npx vitest run packages/ui/tests/competency-radar.test.tsx",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "ui", "visualization", "matching"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Interactive Career Trajectory Timeline & Employer Arc",
            description="Add visual interactive career milestone and impact timeline mapping scope progression, promotions, and major system architectures.",
            details=(
                "Feature proposal for Featherduster UI (packages/ui/src/views/desk/CareerTimeline.tsx):\n"
                "- Chronological multi-track visual timeline showing company tenures, promotions, and system breakthroughs\n"
                "- Filterable by technical theme (#platform, #distributed-systems, #database) and evidence confidence\n"
                "- Provides hiring committees and peers with an instant holistic bird's-eye view of engineering maturity"
            ),
            test_strategy="npx vitest run packages/ui/tests/career-timeline.test.tsx",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "ui", "timeline", "portfolio"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Standalone Defensibility Brief PDF & Markdown Exporter",
            description="Generate dedicated interview defense dossier containing anticipated skeptical interviewer follow-ups, trade-offs, and ledger proof trails.",
            details=(
                "Feature proposal for Featherduster Compilers & UI (packages/core/src/compilers/defense-brief-compiler.ts):\n"
                "- Compiles standalone one-page defense brief per tailored resume or role\n"
                "- Anticipates hard Staff+ interview probes ('Why this architecture? What failed? What trade-offs?') with cited proof\n"
                "- Provides candidate cheat-sheet for rapid interview recall and defensibility verification"
            ),
            test_strategy="npx vitest run packages/core/tests/defense-brief.test.ts",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "compilers", "interview-prep", "export"],
        ),
        ScannedIdea(
            category="opportunity",
            title="Automated Secret & Confidentiality Leak Scanner",
            description="Add deterministic pre-flight scanner detecting internal hostnames, credentials, unredacted partner names, and private metric disclosures.",
            details=(
                "Feature proposal for Featherduster Integrity Engine (packages/core/src/integrity/confidentiality-scanner.ts):\n"
                "- Audits all compiled resume outputs, defense briefs, and exported packets against privacy-rules.yaml\n"
                "- Flags internal domain patterns (*.corp.*, *.internal.*), private repo URLs, internal server names, and API keys\n"
                "- Enforces zero unintentional confidential data leakage from private ledgers into external recruiter documents"
            ),
            test_strategy="npx vitest run packages/core/tests/confidentiality.test.ts",
            suggested_priority="high",
            tags=["codebase-scan", "opportunity", "privacy", "integrity", "security"],
        ),
    ]
    return opportunities


class IdeaScanner:
    """Orchestrates codebase scanning and publishes new proposals to TaskMaster."""

    def __init__(self, repo_root: Path | None = None, adapter: TaskMasterAdapter | None = None) -> None:
        self.repo_root = (repo_root or Path.cwd()).resolve()
        self.adapter = adapter or TaskMasterAdapter(self.repo_root)

    def scan(self, categories: list[str] | None = None) -> list[ScannedIdea]:
        """Execute selected scanners across the Featherduster repository."""
        cats = set(categories) if categories else {"opportunity", "architecture", "todo", "stub", "test_gap", "zeitgeist"}
        ideas: list[ScannedIdea] = []

        # Prioritize domain opportunities and architecture friction first!
        if "opportunity" in cats or "zeitgeist" in cats:
            ideas.extend(scan_opportunities(self.repo_root))
        if "architecture" in cats:
            ideas.extend(scan_architecture_friction(self.repo_root))
        if "todo" in cats:
            ideas.extend(scan_todos(self.repo_root))
        if "stub" in cats:
            ideas.extend(scan_stubs(self.repo_root))
        if "test_gap" in cats:
            ideas.extend(scan_test_gaps(self.repo_root))

        return ideas

    # Active statuses that block re-filing the same idea
    ACTIVE_STATUSES = {"pending", "in-progress", "blocked", "review"}

    def publish_proposals(
        self,
        ideas: list[ScannedIdea],
        tag: str = "proposals",
        max_new: int = 15,
    ) -> list[TaskMasterTask]:
        """Publish scanned ideas to TaskMaster, preventing duplicate submissions.

        Only skips re-filing an idea whose title matches a task that is currently
        *active* (pending / in-progress / blocked / review) in either the proposals
        or master tag.  Completed, cancelled, or deferred tasks do NOT block
        re-discovery — this keeps the pipeline healthy across multiple runs.
        """
        self.adapter.ensure_initialized([tag, "master"])

        # Collect titles of ACTIVE tasks only
        existing_proposals = self.adapter.get_tasks(tag=tag)
        existing_master   = self.adapter.get_tasks(tag="master")

        active_titles: set[str] = {
            t.title.lower().strip()
            for t in (existing_proposals + existing_master)
            if t.status in self.ACTIVE_STATUSES
        }

        created: list[TaskMasterTask] = []
        for idea in ideas:
            if len(created) >= max_new:
                break
            normalized_title = idea.title.lower().strip()
            if normalized_title in active_titles:
                continue

            task = self.adapter.add_task(
                title=idea.title,
                description=idea.description,
                details=idea.details,
                test_strategy=idea.test_strategy,
                priority=idea.suggested_priority,
                tag=tag,
                tags=idea.tags,
            )
            created.append(task)
            # Treat the newly-created task as active so we don't double-file
            # identical ideas discovered in the same scan cycle.
            active_titles.add(normalized_title)

        return created
