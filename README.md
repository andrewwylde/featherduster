# Featherduster 🪶

> **Local-First Career Intelligence & Evidence Ledger for Engineers**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-green.svg)](https://nodejs.org/)
[![Local--First](https://img.shields.io/badge/Architecture-100%25%20Local--First%20%2F%20Zero%20Cloud-success.svg)](#privacy--security-by-default)
[![Privacy Guarantee](https://img.shields.io/badge/Privacy-Strict%20Redaction%20Guarantee-red.svg)](#pre-flight-integrity--privacy-redaction)

**Featherduster** turns your real-world engineering accomplishments into verifiable, audit-proof career capital. It maintains an immutable, git-backed markdown ledger of your work history, validates metrics and citations against hallucination, compares your scope against engineering leveling ladders (L3–L6+), and compiles clean, redacted resumes and promotion brag docs across multiple targets.

---

## ⚡ Motivation & Problem Statement

Engineers face two acute career challenges:

1. **The Telemetry Decay Problem**: Over 2–5 years at a company, engineers ship complex migrations, optimize distributed systems, and scale infrastructure. But when performance reviews, promotion cycles, or job applications arrive, exact metrics (p99 latencies, dollar savings, throughput benchmarks, architecture RFCs) are lost in deprecated dashboards, inaccessible Jira tickets, or closed Slack channels. Resume bullets degrade into hand-waving claims.
2. **The Cloud Leak Problem**: Career telemetry frequently contains sensitive employer data—internal ticket IDs (`AUTH-892`), confidential enterprise client names, proprietary internal tools, and unannounced project codenames. Uploading career data or brag documents to cloud-based ATS scanners, public generative AI platforms, or third-party web services risks violating NDAs and leaking proprietary IP.

**Featherduster solves both issues at the architectural root**:
- **Strict Evidence Over Assertion**: Every claim, metric, and bullet is rooted in a local, dated evidence entry (`ev-###`).
- **Zero Hallucinations**: Incomplete metrics are explicitly tagged with `[METRIC NEEDED]`, and provisional work cannot be claimed as verified production outcomes.
- **Air-Gapped Privacy**: Runs 100% locally on `127.0.0.1:4173`. Zero cloud dependencies, zero telemetry phone-home, automated pre-push git defense, and deterministic redaction pipelines that strip citations and internal identifiers before public export.

---

## ✨ Core Features

### 🗄️ Local Markdown Ledger
Store granular accomplishment entries in clean markdown files with structured YAML frontmatter under `evidence/<company>/ev-###-<slug>.md`. Track verified metrics, architectural themes, technical problem contexts, implementation details, and internal ticket/PR references.

```yaml
---
id: ev-042
date: '2026-03-12'
company: Parable Systems
title: Zero-Downtime Distributed Partition Sharding
summary: Architected dynamic consistent hashing controller eliminating partition hotspots.
impact: Reduced p99 tail latency from 850ms to 42ms across 14M active tenant accounts.
confidence: verified
in_flight: false
metrics:
  - name: p99 latency reduction
    value: 808ms (95% drop)
    status: verified
internal_references:
  - type: ticket
    ref: CORE-4019
  - type: pr
    ref: '#2914'
---
```

### 🎯 Zero-Hallucination Metrics
Unverified numbers are never fabricated. If an achievement lacks exact quantitative proof, the token `[METRIC NEEDED]` is explicitly inserted. The integrity compiler flags unverified claims and prevents ungrounded assertions from entering candidate resumes.

### 📊 Leveling Rubric Gap Matrix
Import engineering ladders directly from Notion tables, Google Docs, CSV/TSV, or structured YAML. Map your accomplishments against competencies (System Architecture, Execution, Technical Leadership, Mentorship) across L3, L4, L5, and L6 to visually uncover coverage holes before promotion committee reviews.

### 📝 Multi-Target Compilers
Write your career evidence once and compile downstream artifacts deterministically:
- **ATS-Optimized Markdown**: Clean, bulleted markdown parsed effortlessly by Applicant Tracking Systems.
- **Paginated Web Print / PDF**: Pixel-perfect, 1-page CSS `@media print` layout with A4/US-Letter page budgeting.
- **Typst**: Modern, lightning-fast, high-precision typographic typesetting.
- **LaTeX**: Classic academic and engineering resume typesetting.
- **Promotion Brag Documents**: Comprehensive performance review dossiers grouped by leveling rubric competencies with narrative impact summaries.

### 🛡️ Pre-Flight Integrity & Privacy Redaction
Before any resume or brag document is exported, Featherduster runs an automated pre-flight audit:
- **Citation Stripping**: Removes internal traceability tags (`(ev-042)`) from public text.
- **Ticket ID Redaction**: Sanitizes Jira/Linear issue patterns (e.g. `AUTH-892`, `CONF-104`).
- **Client & Codename Replacements**: Replaces confidential partner and employer names with configured public aliases (e.g. `Enterprise Client`).
- **Banned Keyword Gate**: Fails compilation if classified terms (e.g. `CONFIDENTIAL`, `PROPRIETARY_ALGO`) are detected.
- **Dangling Citation Detection**: Ensures no bullet points cite nonexistent evidence IDs.

### 🧹 Native De-Slop Engine & Anti-Slop Linter
AI-generated resume bullets often suffer from "ChatGPT slop"—hollow corporate buzzwords, empty hedging, and manufactured stakes. Featherduster features a native, deterministic anti-slop engine directly in `@featherduster/core`:
- **Buzzword & Fluff Detection**: Flags empty corporate buzzwords (`spearheaded cross-functional synergies`, `fostered synergistic alignment`), LLM filler lexicon (`delve`, `tapestry`, `realm of`, `testament to`), manufactured stakes (`in today's fast-paced digital landscape`), and empty hedging (`it's worth noting that`, `needless to say`).
- **Deterministic 1-Click Cleaner**: Strips filler phrases and throat-clearing while preserving 100% of technical facts, engineering mechanisms, and quantitative metrics.
- **Pre-Flight & Headless Integration**: Integrated directly into `featherduster check`, the UI Pre-Flight Gate modal, and the Resume Canvas toolbar.

### 📦 Bundled Career Skills & Agent Integration
`featherduster init` automatically installs specialized agent skills into `.featherduster/skills/` and `.claude/skills/`, plus locked-down `.claude/settings.json` permissions:
- `career-growth-tailor-resume`: Surgical job description matching, enforcing the Ledger Ceiling Rule and transferable vs. fabricated checks.
- `career-growth-evidence`: Ingests work signals from GitHub PRs, Linear issues, and local notes into the evidence ledger.
- `career-growth-accomplishments`: Builds and maintains structured accomplishment journals and brag docs.
- `career-growth-competency`: Maps verified evidence to leveling ladders (L3–L6).
- `career-growth-self-review` & `promotion-packet`: Prepares audit-proof self-assessments and promotion packets backed strictly by cited evidence.
- `de-slop`: Evaluates candidate prose against an editorial rubric to ensure it reads like an authoritative senior engineer, not generic machine slop.

### 🔒 Git Push Defense & Claude Safety Permissions
`featherduster init --block-push` configures `.githooks/pre-push` and `.claude/settings.json` to guarantee your private evidence ledger can **never be pushed to a public or remote git repository**. Dangerous git operations (`git push`, `git remote add`, `gh repo create`) are denied in Claude Code permissions by default. Even in standard mode, pre-push hooks halt if unverified metrics or banned keywords are detected.

### 🤖 AI Agent Operating Protocol (`AGENT.md`)
Every Featherduster workspace includes an authoritative `AGENT.md` contract. External coding agents (Claude Code, Cursor, Antigravity) can safely edit resumes and analyze leveling gaps while being strictly bound to three non-negotiable prime directives:
1. **Zero Hallucinated Metrics**: Missing numbers must use `[METRIC NEEDED]`.
2. **Strict Citation Contract**: Every accomplishment must cite a valid `ev-###`.
3. **Zero AI Slop**: Banning ungrounded buzzwords, empty hedging, and manufactured stakes.

---

## 🚀 Quickstart Guide

Get up and running in under 60 seconds with Node.js (>=18):

### 1. Initialize a Workspace
Initialize a new career evidence corpus in your current directory (or a specified target folder):

```bash
npx featherduster init --block-push
```

This scaffolds:
- `.featherduster/config.yaml` & `privacy-rules.yaml`
- `.featherduster/skills/` & `.claude/skills/` (Bundled career growth & de-slop skills)
- `.claude/settings.json` (Push-denied safety permissions)
- `evidence/sample-company/ev-001-starter.md`
- `rubrics/engineering-ic.yaml` (Standard Software Engineering IC ladder)
- `resumes/tailored/starter.yaml` & `resumes/templates/starter.md`
- `companies/sample-company/profile.yaml`
- `AGENT.md` (AI Agent Operating Protocol)
- `.githooks/pre-push` (Local evidence push defense)

### 2. Launch the Local Web UI
Start the local server and open the interactive dashboard in your browser:

```bash
npm start
```

This builds the local UI and starts the server. Open `http://127.0.0.1:4173` if your browser does not open automatically. Stop it with `Ctrl+C`.

The web dashboard binds strictly to `http://127.0.0.1:4173` and features:
- **Evidence Explorer**: Search, filter by theme or company, and review verified metrics.
- **Quick-Capture Modal**: Record new achievements immediately with live metric taggers.
- **Rubric Gap Matrix**: Interactive competency grid highlighting verified vs. unmapped skills.
- **Rubric Importer**: One-click paste parser for Notion, CSV, and markdown ladders.
- **Resume Tailoring Canvas**: Toggle modular bullets on/off and instantly preview Markdown, HTML, Typst, or LaTeX compilations.
- **Pre-Flight Gate Modal**: Interactive privacy redaction checklist and audit download.

### 3. Run Headless Integrity Audits
Validate citations, detect unverified metrics, and scan for confidential keyword leaks:

```bash
npx featherduster check
```

Output:
```
Featherduster Integrity Audit

✔ [PASS] Integrity check passed! 0 violations found across 6 files.
  • 8 valid citation(s) verified against evidence store.
  • 0 unverified or missing metric tokens.
  • 0 banned keyword leaks detected.
```

### 4. Headless Compilation
Compile your tailored resume or performance brag doc directly from the terminal:

```bash
# Compile ATS-ready markdown resume
npx featherduster build --format markdown --output resumes/exports/resume.md

# Compile 1-page paginated HTML for PDF export
npx featherduster build --format html --output resumes/exports/resume.html

# Compile Typst document
npx featherduster build --format typst --output resumes/exports/resume.typ

# Compile LaTeX document
npx featherduster build --format latex --output resumes/exports/resume.tex

# Compile a Leveling Brag Doc against an engineering rubric
npx featherduster build --format brag --rubric swe-ic --output resumes/exports/brag-doc.md
```

---

## 📂 Workspace Directory Layout

```
my-career-corpus/
├── .featherduster/
│   ├── config.yaml              # Active profile, server port, and export preferences
│   └── privacy-rules.yaml       # Replacement aliases, banned keywords, strip regexes
│
├── evidence/                    # Immutable evidence ledger
│   └── <company-id>/
│       ├── ev-001-migration.md  # Structured entry with YAML frontmatter
│       └── ev-002-cache.md
│
├── rubrics/                     # Engineering leveling ladders
│   └── engineering-ic.yaml      # Competencies, levels (L3-L6), and milestone criteria
│
├── resumes/
│   ├── templates/               # Base markdown/LaTeX resume templates
│   ├── tailored/                # Role-specific tailored specs (YAML/JSON)
│   └── exports/                 # Compiled resumes (.md, .html, .typ, .tex)
│
├── companies/                   # Employer background dossiers & aliases
│   └── <company-id>/
│       └── profile.yaml         # Public vs internal title, tenure, and scope
│
├── .githooks/
│   └── pre-push                 # Git defense hook preventing remote push leaks
│
└── AGENT.md                     # Hard safety rules and playbooks for AI agents
```

---

## 🏗️ Architecture & Monorepo Overview

Featherduster is architected as a modular TypeScript monorepo managed with npm workspaces:

```
featherduster/
├── packages/
│   ├── core/       # @featherduster/core: Zero-dependency schemas, stores, linters & compilers
│   ├── cli/        # @featherduster/cli: Local Hono server, SSE watcher & terminal commands
│   └── ui/         # @featherduster/ui: Vite + React + Tailwind embedded web dashboard
└── package.json
```

### `@featherduster/core`
- **Schemas**: Zod-validated models for evidence entries, leveling rubrics, resume specs, and privacy rules.
- **Evidence Store**: In-memory indexed query engine with multi-criteria filtering (company, theme, confidence).
- **Integrity Linters**: Automated detectors for dangling citations, unresolved `[METRIC NEEDED]` tokens, provisional claims, and banned keyword leaks.
- **Gap Analyzer**: Competency coverage and level progression calculator comparing evidence against leveling ladders.
- **Compilers**: Deterministic transformers emitting ATS Markdown, CSS Paginated HTML, Typst, LaTeX, and Brag Docs with integrated privacy redaction.

### `@featherduster/cli`
- **Strict Localhost Server**: Lightweight [Hono](https://hono.dev/) server bound strictly to `127.0.0.1:4173`.
- **Live SSE Watcher**: [Chokidar](https://github.com/paulmillr/chokidar)-powered file system watcher streaming live update events to the browser.
- **Embedded SPA Fallback**: Serves compiled `@featherduster/ui` assets with full client-side routing support.
- **CLI Commands**: Headless `init`, `check`, `build`, and default `server` runner.

### `@featherduster/ui`
- **React 18 + Vite + Tailwind CSS**: Clean, responsive, high-performance interface with dark mode aesthetic.
- **Lucide Icons**: Crisp iconography across evidence and matrix views.
- **Zero External API Calls**: Communicates exclusively with `http://127.0.0.1:4173/api/*`.

---

## 🔒 Privacy & Security by Default

| Mechanism | Guarantee |
|---|---|
| **Localhost Binding** | Server listens exclusively on `127.0.0.1`. Never binds to `0.0.0.0` or external network interfaces. |
| **Air-Gapped Operation** | Zero outbound requests. No third-party tracking, analytics, telemetry, or external font/script CDNs. |
| **Automated Pre-Push Defense** | `.githooks/pre-push` prevents `git push` from leaking private career files to remote git hosts. |
| **Deterministic Sanitization** | `redactText` strips internal IDs (`AUTH-892`, `ev-###`) and transforms private client names before export. |
| **Banned Keyword Gate** | Linter rejects exports containing configured proprietary or confidential strings. |

---

## 🛠️ Development & Contributing

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Setup
```bash
# Clone repository
git clone https://github.com/drewk/featherduster.git
cd featherduster

# Install all dependencies
npm install

# Run all test suites across the monorepo (194+ tests)
npm test

# Build all packages (core -> ui -> cli)
npm run build
```

### Build Commands
```bash
npm run build:core   # Compile @featherduster/core TypeScript
npm run build:ui     # Build @featherduster/ui with Vite into cli/dist/ui
npm run build:cli    # Compile @featherduster/cli TypeScript
npm run build        # Build entire project in dependency order
```

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
Copyright (c) 2026 Andrew Wylde and Featherduster Contributors.
