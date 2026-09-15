# Agent Operating Manual & Safety Directives

This document defines the non-negotiable operational rules, data boundaries, and execution playbooks for AI agents (Cursor, Claude Code, Antigravity, etc.) operating in this Featherduster career evidence repository.

---

## 1. Non-Negotiable Prime Directives (Hard Gates)

Any violation of these gates represents an immediate failure of the task:

1. **Zero Hallucinated Metrics:**
   - Never invent numbers, latencies, percentages, cost savings, or scale figures.
   - If an accomplishment or bullet is missing a quantitative metric, use the literal string `[METRIC NEEDED]`.
   - Never substitute plausible-sounding estimates or approximations for unverified facts.

2. **Strict Citation Contract:**
   - Every bullet in tailored resumes, brag docs, and candidate accomplishment summaries **must cite** a valid evidence ID (`ev-###`).
   - If a claim cannot be verified against an existing entry in `evidence/**/*.md`, it cannot be asserted.
   - Run `featherduster check` to verify citation validity before committing.

3. **Traceability ID Stripping:**
   - Citation tags (`ev-###`) are internal-only metadata for auditability.
   - When generating or compiling external-facing artifacts (`.md`, `.html`, `.typ`, `.tex`), all citation tags must be cleanly removed via the redaction engine.

4. **Absolute Privacy Boundary:**
   - Never promote internal-only identifiers into public resumes or external summaries:
     - **Banned from public text:** Internal customer names, ticket IDs (e.g. `JIRA-123`, `CONF-99`), unannounced project codenames, raw Slack/chat quotes, work email addresses, and system credentials.
     - **Allowed in public text:** Approved company aliases (defined in `.featherduster/privacy-rules.yaml`), public project descriptions, and standard technology stacks.

5. **In-Flight Work Separation:**
   - Unreleased, in-progress, or RFC-stage initiatives must be flagged with `in_flight: true` or `confidence: provisional`.
   - Never format in-flight work as shipped, past-tense achievements.

---

## 2. CLI Tooling & Automation

Featherduster provides CLI commands to validate, compile, and manage career workspaces:

- **Integrity Check:**
  ```bash
  featherduster check
  ```
  Runs headless verification across all workspace files for:
  - Dangling citations (cited `ev-###` missing from evidence store).
  - Unverified metrics or missing metric placeholders.
  - Banned keywords or privacy leaks defined in `.featherduster/privacy-rules.yaml`.

- **Compile Resume / Brag Doc:**
  ```bash
  featherduster build [variant] --format <markdown|html|typst|latex|brag>
  ```
  Compiles ATS-friendly resumes or competency brag documents with automatic citation stripping and privacy redaction.

- **Local Server & Web UI:**
  ```bash
  featherduster [root] --port 4173
  ```
  Launches the interactive local-first web UI for reviewing evidence, leveling gaps, and live resume previews.

---

## 3. Workspace Directory Structure

- `.featherduster/`:
  - `config.yaml`: Active profile, export targets, and server port.
  - `privacy-rules.yaml`: Banned keywords, regex patterns (e.g., ticket formats), and alias replacements.
- `evidence/<company>/`:
  - Structured accomplishment entries (`ev-###-slug.md`) containing YAML frontmatter and technical narrative.
- `rubrics/`:
  - Engineering leveling ladders (e.g. `engineering-ic.yaml`) used for promotion readiness and gap analysis.
- `companies/<company>/`:
  - Company dossiers and `profile.yaml` specifying employment dates, roles, and public vs ledger-only naming.
- `resumes/`:
  - `templates/`: Base resume templates and styling configurations.
  - `tailored/`: Target-specific resume specs and tailored drafts.
  - `exports/`: Compiled production outputs (Markdown, HTML, PDF, Typst, LaTeX).
- `.githooks/`:
  - `pre-push`: Git hook preventing accidental remote pushes of private career evidence and running integrity checks.

---

## 4. Operational Playbooks

### Playbook A: Ingesting New Career Evidence

1. Locate or create the appropriate company directory under `evidence/<company>/`.
2. Assign the next sequential ID (e.g., `ev-002-slug.md`).
3. Fill out the YAML frontmatter adhering to the `EvidenceEntrySchema`:
   - `id`: Unique identifier (`ev-###`).
   - `date`: ISO date (`YYYY-MM-DD`).
   - `company`: Company slug matching directory.
   - `title`: Concise accomplishment title.
   - `summary`: One-line overview.
   - `impact`: Concrete business or technical impact.
   - `themes`: Relevant competency tags.
   - `confidence`: `verified`, `provisional`, or `retracted`.
   - `in_flight`: `true` if work is ongoing, `false` if completed.
   - `metrics`: Array of verified quantitative outcomes.
4. Write the technical narrative documenting context, actions taken, and measured outcomes.
5. Run `featherduster check` to verify schema and metrics.

### Playbook B: Tailoring a Resume for a Target Role

1. Review job description requirements and target competencies.
2. Draft resume content in `resumes/tailored/<target>.md` or create a `spec.json`.
3. Ensure every bullet cites an existing evidence entry (e.g., `(ev-001)`).
4. Run `featherduster check` to ensure zero dangling citations and valid metrics.
5. Run `featherduster build <target> --format markdown -o resumes/exports/<target>.md`.
6. Inspect output to ensure citations and private identifiers have been completely stripped.

### Playbook C: Drafting Performance Brag Documents

1. Identify the target leveling rubric in `rubrics/` (e.g. `engineering-ic.yaml`).
2. Run `featherduster build --format brag --rubric swe-ic-ladder -o resumes/exports/brag-doc.md`.
3. Review competency gap analysis to identify areas requiring additional evidence.

---

## 5. Environment & Safety Standards

- **Local-First Privacy:** Career data contains personal identifying information, internal architecture notes, and proprietary metrics. The `.githooks/pre-push` hook protects against pushing this data to remote git repositories.
- **File Encoding:** All files must be saved in `UTF-8` encoding without BOM.
- **Cross-Platform Paths:** Always use forward slashes (`/`) in markdown links and references.
