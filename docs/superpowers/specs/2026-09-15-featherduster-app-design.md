# Design Document: Featherduster — Local-First Career Corpus & Evidence Engine

- **Date:** 2026-09-15
- **Status:** Approved
- **Topic:** Packaging Featherduster as an Open-Source, Local-First App to Share

---

## 1. Overview & Objectives

**Featherduster** packages the verifiable career corpus and evidence ledger methodology into an open-source, local-first application for software engineers. It gives developers a private, git-friendly tool to log daily accomplishments, track progress against company leveling rubrics, and generate tailored, ATS-ready resumes with zero fabricated metrics or leaked company secrets.

### Core Objectives:
1. **Zero-Friction Local Execution:** Runnable instantly via `npx featherduster` or global CLI. Binds strictly to `127.0.0.1` and opens an embedded modern web UI in the default browser.
2. **Direct Filesystem Sovereignty:** All data is stored in human-readable Markdown (`.md`) and YAML (`.yaml`) files in a user-chosen repository. Zero proprietary database lock-in. 100% interoperable with Git and AI coding agents (Claude Code, Cursor, Antigravity).
3. **Evidence-Backed Leveling & Brag Docs:** Import custom company leveling rubrics (or use standard IC ladders like L4 $\rightarrow$ L5, Staff, Principal). Visually map evidence to competency criteria, highlight coverage gaps, and export complete performance review brag docs.
4. **Multi-Target Resume Tailoring:** Drag-and-drop verified bullets into role-targeted 1-page resumes. Multi-target compilation supports zero-dependency modern Web Print/PDF, fast Typst compilation, native LaTeX (`pdflatex`), and clean ATS Markdown export.
5. **Strict Integrity & Redaction Gates:** Enforces citation verification (`ev-###`), detects missing or unverified metrics (`[METRIC NEEDED]`), and automatically scrubs employer ticket IDs, customer names, and private internal terms prior to export.
6. **Isolated Open-Source Distribution:** Developed and maintained in a clean, standalone open-source repository (`featherduster-app`), ensuring personal career repositories remain 100% private and unpushed.

---

## 2. Architecture & Topology

### 2.1 Monorepo / Package Structure (`featherduster-app`)
The open-source project is organized as a lightweight TypeScript workspace:
```
featherduster/
├── packages/
│   ├── core/                  # Core domain logic: Zod schemas, AST parser, redaction engine, linters
│   ├── cli/                   # Node executable: CLI flags, chokidar watcher, Hono local server, git hooks
│   └── ui/                    # Pre-compiled React SPA (Vite + Tailwind CSS + shadcn/ui + Lucide)
├── package.json
└── README.md
```

- **Runtime:** Node.js (v18+). Distributed as an npm package (`featherduster` / `@featherduster/cli`).
- **Local Server:** Built with **Hono** using Node's native HTTP adapter, serving pre-compiled static UI assets and exposing typed RPC/REST endpoints on `http://127.0.0.1:4173`.
- **Dual Mode:**
  - Running `featherduster` or `featherduster ui` opens the interactive browser UI.
  - Running `featherduster check` runs headless citation and privacy validation (ideal for CI and pre-push git hooks).
  - Running `featherduster build [variant]` compiles resumes from the terminal.

### 2.2 User Workspace Topology (The Target Project)
When a user runs `npx featherduster init` in a directory, it scaffolds:
```
my-career-corpus/
├── .featherduster/               # Workspace configuration & redaction dictionary
│   ├── config.yaml               # Active user profile, default export targets, port preferences
│   └── privacy-rules.yaml        # Anonymization rules (banned employer terms, customer aliases)
├── evidence/                     # Verifiable evidence corpus
│   └── <company-slug>/           # Granular markdown files per accomplishment
│       ├── ev-001-session-auth.md
│       └── ev-002-cache-layer.md
├── rubrics/                      # Leveling rubrics & promotion criteria
│   ├── engineering-ic5.yaml      # Imported company leveling ladder (L3-L6)
│   └── mappings/                 # Rubric-to-evidence competency mappings & brag docs
├── companies/                    # Career history organized by employer chapters
│   └── <company-slug>/
│       ├── profile.yaml          # Company metadata, public vs internal names, dates
│       └── role/job-desc.md      # Canonical role expectations & OKRs
├── resumes/                      # Resume source files & exports
│   ├── templates/                # LaTeX, Typst, and Markdown master templates
│   ├── tailored/                 # Role-specific tailored variants & targeting briefs
│   └── exports/                  # Generated ATS-friendly Markdown and compiled PDFs
├── AGENT.md                      # Operating manual for external AI coding agents (Claude/Cursor)
└── .githooks/pre-push            # Local push-defense hook preventing accidental remote leaks
```

---

## 3. Data Models & Schemas

All entities are validated at runtime using strict **Zod** schemas.

### 3.1 Granular Evidence Entry (`evidence/<company>/ev-###-<slug>.md`)
Each entry is an individual file to prevent Git merge conflicts and facilitate AI editing:
```yaml
---
id: "ev-042"
date: "2026-04-12"
company: "parable"
title: "Zero-Downtime Session Migration"
summary: "Architected token rotation protocol eliminating session invalidations during DB switch."
impact: "Reduced user re-auth events by 99.4% across 140k active daily sessions."
themes:
  - "distributed-systems"
  - "reliability"
  - "auth"
confidence: "verified" # verified | provisional | retracted
in_flight: false
metrics:
  - name: "re-auth reduction"
    value: "99.4%"
    status: "verified" # verified | "METRIC NEEDED"
internal_references: # Automatically stripped on export
  - type: "linear"
    ref: "AUTH-892"
  - type: "datadog"
    ref: "wa-au-018"
---

### Narrative & Context
During the tenant database migration, auth tokens were being invalidated when connecting to the new cluster.

### Key Decisions
- Implemented a dual-key HMAC token rotation window.
- Ran load tests simulating 50k concurrent requests.
```

### 3.2 Leveling Rubrics (`rubrics/<name>.yaml`)
Enables importing custom company ladders or standard frameworks:
```yaml
id: "eng-ic-ladder"
title: "Engineering IC Competency Framework"
target_level: "L5"
levels:
  - id: "L4"
    name: "Senior Software Engineer"
  - id: "L5"
    name: "Staff / Tech Lead"
  - id: "L6"
    name: "Principal Engineer"
competencies:
  - id: "architecture-scope"
    name: "System Architecture & Scope"
    levels:
      L4: "Designs single-service modules with minimal guidance."
      L5: "Leads multi-service system designs; resolves ambiguous trade-offs."
      L6: "Defines cross-organization architectural strategy and standards."
    evidence_mapped:
      - ev_id: "ev-042"
        relevance: "primary"
        narrative: "Cross-system token protocol spanning auth-service and web-app."
```

### 3.3 Privacy & Redaction Rules (`.featherduster/privacy-rules.yaml`)
```yaml
rules:
  strip_patterns:
    - "(ev-[0-9]{3})"                     # Always strip internal citation tags
    - "([A-Z]{2,10}-[0-9]{1,5})"          # Strip internal ticket numbers (e.g. AUTH-892)
  replacements:
    - search: "Fortune 50 Bank X"
      replace: "a global tier-1 financial institution"
    - search: "psgen"
      replace: "internal schema code generator"
  banned_keywords:
    - "confidential-project-apollo"
```

---

## 4. Core Features & User Workflows

### 4.1 Web-First Onboarding & Setup
- Running `npx featherduster` in an empty folder launches the browser into an interactive initialization wizard.
- Prompts for engineer's name, current/past employers, and choice of initial leveling rubric (e.g., General IC, Staff+, or custom).
- Automatically installs `.githooks/pre-push` to guarantee private evidence never accidentally pushes to a public git remote.

### 4.2 Evidence Ledger & Quick-Capture
- **Browse & Filter:** Search and filter accomplishments by employer, date range, themes, and verification status.
- **Quick-Capture Drawer:** Add achievements during day-to-day work. Paste raw commit messages, PR links, or Slack notes, and tag them with metrics and confidence levels.
- **Metric Verification Status:** Highlights any entries containing `[METRIC NEEDED]` so engineers never rely on unverified claims.

### 4.3 Leveling Rubric Gap Matrix & Brag Docs
- **Multi-Format Rubric Importer:** Load standard templates (Progression.fyi, Big Tech, startup ladders), use a visual "Paste & Parse" table importer (for Notion, Confluence, or Google Docs tables), or manually configure levels in the UI.
- **Competency Gap Matrix:** A visual grid showing your current level vs. target level (e.g., L4 vs. L5). Each competency card shows mapped evidence bullets and visually flags coverage gaps (e.g., *"0/2 verified examples for Cross-Team Influence"*).
- **One-Click Brag Doc Export:** Compiles a formatted performance review packet or promotion case, grouping verified accomplishments under your company's exact rubric headings.

### 4.4 Resume Tailoring & Multi-Target Compilation
- **Target Job Matcher:** Split-screen canvas allowing users to paste a target job description side-by-side with their evidence pool, highlighting matching keywords and recommending relevant bullets.
- **Modular Bullet Assembly:** Drag-and-drop verified bullets into a tailored 1-page resume.
- **Multi-Target Compilation Engine:**
  1. *Zero-Dependency Web Print/PDF:* Instant browser rendering using styled CSS print layouts with pixel-perfect 1-page pagination.
  2. *Typst Support:* Fast, modern Rust-based typesetting compiler.
  3. *Native LaTeX (`pdflatex`):* Full support for traditional `.tex` templates when local LaTeX is detected.
  4. *Clean ATS Markdown:* Plaintext / Markdown export formatted for direct copy-pasting into ATS job application portals (Greenhouse, Lever, Workday).

---

## 5. Integrity Gate & Redaction Pipeline

### 5.1 The Pre-Flight Integrity Gate
When exporting a resume or brag doc (or running `featherduster check` in CLI), the system runs a strict pre-flight audit:
1. **Citation Verification:** Every bullet citing `ev-###` must resolve to a valid evidence file.
2. **Zero Hallucinated Metrics:** Bullets containing `[METRIC NEEDED]` or lacking verified metrics trigger a hard block.
3. **Data Boundary Enforcement:** Scans for banned keywords or unredacted internal ticket IDs.

### 5.2 Visual Resolution Modal
In the web UI, if violations are detected, the export is blocked and a Pre-Flight Modal presents the infractions with one-click remediations:
- *"Replace with public alias"*
- *"Strip citation tag"*
- *"Exclude bullet from this export"*

In the CLI (`featherduster check`), infractions print colored diffs and exit with code `1` to prevent git pushes via hooks.

---

## 6. Real-Time Sync & AI Collaboration Model

### 6.1 Bidirectional Live Sync
- **Filesystem Watcher:** `chokidar` monitors all `.md` and `.yaml` files in the workspace.
- **WebSocket / SSE Stream:** External edits made by IDEs or AI agents instantly update the web UI's in-memory state and visual views.
- **Conflict Prevention:** If a file is modified externally while being actively edited in the UI, an inline non-destructive resolution banner appears (*"File changed on disk: [Reload] [Merge] [Keep Mine]"*).

### 6.2 Dual AI Integration Model
1. **Agent-Native Workspace:** Scaffolds `AGENT.md` and `.cursorrules` in the user's workspace so external CLI/IDE agents (Claude Code, Cursor, Antigravity) understand the citation format, schemas, and privacy rules natively.
2. **Optional In-App AI Assistant:** An optional UI drawer where users can provide their own API key (OpenAI, Anthropic, Gemini, or local Ollama) for in-browser bullet polishing, rubric gap analysis, and job description keyword matching. Works 100% offline if no key is configured.

---

## 7. Testing & Quality Assurance

- **Unit Tests (Vitest):**
  - Zod schema validation for evidence, rubrics, and privacy rules.
  - Markdown AST extraction and redaction regex rules.
  - Citation cross-referencing and dangling reference detection.
- **Integration Tests:**
  - CLI commands (`init`, `check`, `build`) run against isolated fixture workspaces in temporary directories.
  - Pre-push git hook execution testing.
- **E2E Tests (Playwright):**
  - Web onboarding flow.
  - Quick-capture achievement drawer and live matrix updates.
  - Resume drag-and-drop bullet assembly and export triggers.
