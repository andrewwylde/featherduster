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

3. **Zero AI Slop:**
   - Strictly bans buzzwords without metrics ("synergy", "spearheaded cross-functional paradigms", "cutting-edge"), empty hedging ("it is worth noting that", "needless to say", "at the end of the day"), and manufactured stakes ("in today's fast-paced digital world").
   - Ban formulaic triadic triplets ("fast, reliable, and scalable") unless backed by verifiable evidence.
   - All bullets and accomplishment narratives must be concise, active, evidence-backed statements without corporate fluff.
   - Run `featherduster check` to detect and eliminate slop patterns.

4. **Traceability ID Stripping:**
   - Citation tags (`ev-###`) are internal-only metadata for auditability.
   - When generating or compiling external-facing artifacts (`.md`, `.html`, `.typ`, `.tex`), all citation tags must be cleanly removed via the redaction engine.

5. **Absolute Privacy Boundary:**
   - Never promote internal-only identifiers into public resumes or external summaries:
     - **Banned from public text:** Internal customer names, ticket IDs (e.g. `JIRA-123`, `CONF-99`), unannounced project codenames, raw Slack/chat quotes, work email addresses, and system credentials.
     - **Allowed in public text:** Approved company aliases (defined in `.featherduster/privacy-rules.yaml`), public project descriptions, and standard technology stacks.

6. **In-Flight Work Separation:**
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
  - Unverified metrics or missing metric placeholders (`[METRIC NEEDED]`).
  - Banned keywords or privacy leaks defined in `.featherduster/privacy-rules.yaml`.
  - AI slop, corporate buzzwords, and empty hedging.

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
  - `skills/`: Bundled local agent skills (`de-slop`, `career-growth`).
- `.claude/`:
  - `settings.json`: Tool permissions denying dangerous git push/remote commands.
  - `skills/`: Mirrored agent skills for Claude Code.
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

## 4. Local Agent Skills in `.featherduster/skills/`

Featherduster bundles local-first agent skills in `.featherduster/skills/` (and mirrored in `.claude/skills/`). Agents must inspect and follow these skill specifications when executing career workflows:

- **`de-slop` (`.featherduster/skills/de-slop/SKILL.md`):**
  - Two hard rules: fidelity over flair, flag don't fabricate.
  - 6-step loop: scope, pre-flag, judge, triage, rewrite, self-score, report.
  - Strips empty hedging, filler, manufactured stakes, and buzzword inflation while preserving verified facts and metrics.

- **`career-growth` (`.featherduster/skills/career-growth/SKILL.md`):**
  - Index skill routing career development, performance reviews, and resume workflows.

- **`career-growth-tailor-resume` (`.featherduster/skills/career-growth/career-growth-tailor-resume/SKILL.md`):**
  - Surgical job description matching adhering strictly to the **Ledger Ceiling Rule** (never add unbacked skills or keywords).
  - 4 gates: Ingest JD, Alignment Matrix, Strategic Re-weighting / Terminology Harmonization, Interview Defensibility Brief.
  - Transferable vs fabricated discipline: keep truthful tools on the resume, bridge adjacent patterns in the interview brief.

- **`career-growth-evidence` (`.featherduster/skills/career-growth/career-growth-evidence/SKILL.md`):**
  - Ingests work signals from GitHub, Linear, Slack, and local notes into structured evidence entries.

- **`career-growth-accomplishments` (`.featherduster/skills/career-growth/career-growth-accomplishments/SKILL.md`):**
  - Builds and maintains the accomplishment journal / brag doc grouped by strategic themes and impact.

- **`career-growth-competency` (`.featherduster/skills/career-growth/career-growth-competency/SKILL.md`):**
  - Maps verified evidence to engineering leveling ladders (L3–L6) for gap analysis.

- **`career-growth-self-review` (`.featherduster/skills/career-growth/career-growth-self-review/SKILL.md`):**
  - Drafts structured, first-person self-assessments backed strictly by cited evidence.

- **`career-growth-promotion-packet` (`.featherduster/skills/career-growth/career-growth-promotion-packet/SKILL.md`):**
  - Assembles promotion cases with leveling worksheet sections and gap identification.

### How Agents Should Use Local Skills
When asked to tailor a resume, collect evidence, audit prose, or prepare a performance review, agents must read the relevant local `SKILL.md` in `.featherduster/skills/` before taking action. Always execute the defined gates and preserve the Core Principles.

---

## 5. Operational Playbooks

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
5. Run `featherduster check` to verify schema, citations, metrics, and anti-slop integrity.

### Playbook B: Tailoring a Resume for a Target Role

1. Read `.featherduster/skills/career-growth/career-growth-tailor-resume/SKILL.md`.
2. Review job description requirements and target competencies (Gate 0).
3. Build Alignment Matrix against `evidence/**/*.md` (Gate 1).
4. Re-weight bullets and harmonize truthful terminology without exceeding ledger ceiling (Gate 2).
5. Compile tailored resume with stripped citations and verified metrics (Gate 3).
6. Generate Interview Defensibility Brief covering anchor stories and true gaps (Gate 4).
7. Run `featherduster check` to ensure zero dangling citations and valid metrics.

### Playbook C: Drafting Performance Brag Documents

1. Identify target leveling rubric in `rubrics/` (e.g. `engineering-ic.yaml`).
2. Run `featherduster build --format brag --rubric swe-ic-ladder -o resumes/exports/brag-doc.md`.
3. Review competency gap analysis to identify areas requiring additional evidence.

---

## 6. Environment & Safety Standards

- **Local-First Privacy:** Career data contains personal identifying information, internal architecture notes, and proprietary metrics. The `.githooks/pre-push` hook and `.claude/settings.json` protect against pushing this data to remote git repositories.
- **File Encoding:** All files must be saved in `UTF-8` encoding without BOM.
- **Cross-Platform Paths:** Always use forward slashes (`/`) in markdown links and references.
