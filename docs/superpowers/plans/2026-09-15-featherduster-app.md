# Featherduster Local-First App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Featherduster as an open-source, local-first web app and CLI tool (`featherduster-app`) for software engineers to manage career evidence, map leveling rubrics, and tailor verifiable resumes.

**Architecture:** Standalone TypeScript workspace (`packages/core`, `packages/cli`, `packages/ui`). The CLI launches a local Hono HTTP server on `127.0.0.1:4173`, watches the user's workspace using `chokidar`, and serves a pre-compiled React/Tailwind/shadcn SPA. All data is read/written directly to granular Markdown files with YAML frontmatter on the local filesystem.

**Tech Stack:** TypeScript, Node.js (v18+), Hono, React, Vite, Tailwind CSS, Zod, Vitest, chokidar.

**Target Workspace Directory:** `C:/Users/drewk/orca/workspaces/career/featherduster-app`

---

## File Structure & Responsibilities

```
featherduster-app/
├── packages/
│   ├── core/                                # Pure domain logic & algorithms (no DOM/Node specifics)
│   │   ├── src/
│   │   │   ├── schemas/
│   │   │   │   ├── evidence.ts              # Zod schema for granular evidence frontmatter
│   │   │   │   ├── rubric.ts                # Zod schema for leveling ladders & competency mappings
│   │   │   │   ├── privacy.ts               # Zod schema for redaction rules & banned terms
│   │   │   │   └── config.ts                # Workspace config schema (.featherduster/config.yaml)
│   │   │   ├── parsers/
│   │   │   │   ├── evidence-parser.ts       # Parses & serializes markdown frontmatter + body
│   │   │   │   └── rubric-table-parser.ts   # Parses Notion / Markdown / CSV tables into rubrics
│   │   │   ├── integrity/
│   │   │   │   ├── citation-linter.ts       # Checks for dangling ev-### references
│   │   │   │   ├── metric-validator.ts      # Flags [METRIC NEEDED] & unverified assertions
│   │   │   │   └── redaction-engine.ts      # AST & regex string sanitization & alias replacer
│   │   │   ├── compilers/
│   │   │   │   ├── markdown-compiler.ts     # ATS-clean markdown resume generator
│   │   │   │   ├── html-print-compiler.ts   # Zero-dependency styled 1-page printable HTML
│   │   │   │   ├── brag-doc-compiler.ts     # Competency-grouped performance review packet
│   │   │   │   └── latex-compiler.ts        # TeX source generation and pdflatex runner
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── evidence-parser.test.ts
│   │   │   ├── integrity.test.ts
│   │   │   ├── rubric-parser.test.ts
│   │   │   └── compilers.test.ts
│   │   └── package.json
│   │
│   ├── cli/                                 # Node CLI & local server
│   │   ├── src/
│   │   │   ├── bin.ts                       # CLI entry point (featherduster / npx)
│   │   │   ├── server.ts                    # Hono server on 127.0.0.1 serving UI & RPC API
│   │   │   ├── watcher.ts                   # chokidar filesystem watcher & SSE event broadcaster
│   │   │   ├── commands/
│   │   │   │   ├── init.ts                  # Scaffolds workspace, sample rubrics, & git hooks
│   │   │   │   ├── check.ts                 # Headless integrity linter for git pre-push hooks
│   │   │   │   └── build.ts                 # Headless resume & brag doc compiler
│   │   │   └── templates/                   # Workspace starter templates (rubrics, resumes, hooks)
│   │   ├── tests/
│   │   │   ├── cli-init.test.ts
│   │   │   └── cli-check.test.ts
│   │   └── package.json
│   │
│   └── ui/                                  # Pre-compiled browser SPA
│       ├── src/
│       │   ├── api/client.ts                # Typed RPC client communicating with local Hono server
│       │   ├── hooks/use-live-sync.ts       # SSE hook listening for filesystem changes
│       │   ├── components/
│       │   │   ├── evidence/                # Evidence cards, quick-capture drawer, filters
│       │   │   ├── rubric/                  # Leveling matrix, gap visualizer, brag doc preview
│       │   │   ├── resume/                  # Split-screen job matcher, bullet composer
│       │   │   └── pre-flight-modal.tsx     # Integrity gate modal with one-click remediations
│       │   ├── pages/                       # Dashboard, Evidence, Rubrics, Resumes, Settings
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── package.json                             # Monorepo root with npm/pnpm workspaces
└── README.md
```

---

### Task 1: Standalone Monorepo Scaffolding & Core Schemas (`packages/core`)

**Files:**
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/package.json`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/package.json`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/tsconfig.json`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/schemas/evidence.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/schemas/rubric.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/schemas/privacy.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/index.ts`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/tests/schemas.test.ts`

- [ ] **Step 1: Create repository directory and root workspace package.json**
- [ ] **Step 2: Write failing schema tests in `packages/core/tests/schemas.test.ts`**
- [ ] **Step 3: Run Vitest to verify tests fail**
- [ ] **Step 4: Implement Zod schemas in `packages/core/src/schemas/*.ts`**
- [ ] **Step 5: Run Vitest to verify tests pass**
- [ ] **Step 6: Commit changes: `git commit -m "feat(core): scaffold workspace and define core Zod schemas"`**

---

### Task 2: Evidence Ledger Parser & Serialization Engine (`packages/core`)

**Files:**
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/parsers/evidence-parser.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/parsers/index-store.ts`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/tests/evidence-parser.test.ts`

- [ ] **Step 1: Write failing tests for parsing granular markdown with frontmatter and round-trip serialization**
- [ ] **Step 2: Run Vitest to verify tests fail**
- [ ] **Step 3: Implement `evidence-parser.ts` using `gray-matter` and `zod`**
- [ ] **Step 4: Implement `index-store.ts` for in-memory filtering (by company, theme, confidence, metric status)**
- [ ] **Step 5: Run Vitest to verify tests pass**
- [ ] **Step 6: Commit changes: `git commit -m "feat(core): add evidence parser and query store"`**

---

### Task 3: Integrity Linter & Redaction Engine (`packages/core`)

**Files:**
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/integrity/citation-linter.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/integrity/metric-validator.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/integrity/redaction-engine.ts`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/tests/integrity.test.ts`

- [ ] **Step 1: Write failing tests for citation verification, metric verification, and privacy redaction**
- [ ] **Step 2: Run Vitest to verify tests fail**
- [ ] **Step 3: Implement `citation-linter.ts` detecting missing or dangling `ev-###` tags**
- [ ] **Step 4: Implement `metric-validator.ts` flagging `[METRIC NEEDED]` and unverified claims**
- [ ] **Step 5: Implement `redaction-engine.ts` stripping tags, internal tickets, and applying customer aliases**
- [ ] **Step 6: Run Vitest to verify tests pass**
- [ ] **Step 7: Commit changes: `git commit -m "feat(core): add citation linter, metric validator, and redaction engine"`**

---

### Task 4: Rubric Importer & Competency Gap Engine (`packages/core`)

**Files:**
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/parsers/rubric-table-parser.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/rubric/gap-analyzer.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/rubric/presets/swe-ic.ts`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/tests/rubric-parser.test.ts`

- [x] **Step 1: Write failing tests for parsing markdown tables into structured leveling ladders and computing gap metrics**
- [x] **Step 2: Run Vitest to verify tests fail**
- [x] **Step 3: Implement `rubric-table-parser.ts` supporting markdown and TSV table formats**
- [x] **Step 4: Implement `gap-analyzer.ts` computing mapped evidence coverage per competency level**
- [x] **Step 5: Add standard SWE IC leveling preset (L3 to L6)**
- [x] **Step 6: Run Vitest to verify tests pass**
- [x] **Step 7: Commit changes: `git commit -m "feat(core): add rubric table importer and gap analyzer"`**

---

### Task 5: Multi-Target Resume & Brag Doc Compilers (`packages/core`)

**Files:**
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/compilers/markdown-compiler.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/compilers/html-print-compiler.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/compilers/brag-doc-compiler.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/compilers/typst-compiler.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/src/compilers/latex-compiler.ts`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/core/tests/compilers.test.ts`

- [x] **Step 1: Write failing tests for resume and brag doc compilers**
- [x] **Step 2: Run Vitest to verify tests fail**
- [x] **Step 3: Implement `markdown-compiler.ts` (ATS plaintext generator)**
- [x] **Step 4: Implement `html-print-compiler.ts` (1-page CSS paginated HTML generator)**
- [x] **Step 5: Implement `brag-doc-compiler.ts` (competency-mapped promotion packet generator)**
- [x] **Step 6: Implement `typst-compiler.ts` and `latex-compiler.ts`**
- [x] **Step 7: Run Vitest to verify tests pass**
- [x] **Step 8: Commit changes: `git commit -m "feat(core): implement multi-target resume and brag doc compilers"`**

---

### Task 6: CLI Package Scaffolding & Local HTTP Server
- Target: `packages/cli`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/package.json`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/server.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/watcher.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/commands/check.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/commands/build.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/bin.ts`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/tests/server.test.ts`

- [x] **Step 1: Scaffold `packages/cli/package.json` and `tsconfig.json`**
- [x] **Step 2: Write failing integration tests for Hono server API endpoints**
- [x] **Step 3: Implement Hono server strictly binding to `127.0.0.1`**
- [x] **Step 4: Implement `WorkspaceWatcher` using `chokidar` with SSE event streaming**
- [x] **Step 5: Implement headless `featherduster check` command**
- [x] **Step 6: Implement headless `featherduster build` command**
- [x] **Step 7: Run Vitest to verify server and CLI tests pass**
- [x] **Step 8: Commit changes: `git commit -m "feat(cli): implement local Hono server, watcher, and CLI check command"`**

---

### Task 7: Workspace Scaffolding & Git Push Defense (`featherduster init`)
- Target: `packages/cli`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/commands/init.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/templates/pre-push.sh`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/src/templates/AGENT.md`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/tests/init.test.ts`

- [x] **Step 1: Write failing tests for workspace initialization and pre-push hook configuration**
- [x] **Step 2: Implement `init.ts` scaffolding all career corpus directories and starter files**
- [x] **Step 3: Implement `pre-push.sh` script and git hooks configuration**
- [x] **Step 4: Bundle `AGENT.md` guidelines template for coding agents**
- [x] **Step 5: Run Vitest to verify initialization tests pass**
- [x] **Step 6: Commit changes: `git commit -m "feat(cli): implement workspace init with git push defense"`**

---

### Task 8: Embedded Web UI — Setup & Evidence Explorer (`packages/ui`)
- Target: `packages/ui`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/package.json`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/vite.config.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/api/client.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/hooks/useLiveSync.ts`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/views/EvidenceExplorer.tsx`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/components/QuickCaptureModal.tsx`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/App.tsx`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/tests/explorer.test.tsx`

- [x] **Step 1: Scaffold Vite + React + Tailwind frontend with Lucide icons**
- [x] **Step 2: Implement typed HTTP client and SSE `useLiveSync` hook**
- [x] **Step 3: Build Evidence Explorer view with filter tags (by company, theme, confidence, missing metrics)**
- [x] **Step 4: Build Quick-Capture drawer for rapid achievement logging**
- [x] **Step 5: Verify build with `npm run build` producing static assets in `packages/cli/dist/ui`**
- [x] **Step 6: Commit changes: `git commit -m "feat(ui): scaffold embedded web UI and implement Evidence Explorer"`**

---

### Task 9: Embedded Web UI — Rubric Gap Matrix & Brag Doc Generator (`packages/ui`)
- Target: `packages/ui`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/views/RubricGapMatrix.tsx`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/components/RubricImporterModal.tsx`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/components/BragDocModal.tsx`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/tests/rubric-gaps.test.tsx`

- [x] **Step 1: Build visual "Paste & Parse" table importer for Notion / Google Doc leveling tables**
- [x] **Step 2: Build visual Competency Gap Matrix displaying Level expectations and mapped evidence cards**
- [x] **Step 3: Add coverage gap indicators and promotion readiness recommendations**
- [x] **Step 4: Build Brag Doc generator preview with one-click Markdown copy/export**
- [x] **Step 5: Verify build with `npm run build`**
- [x] **Step 6: Commit changes: `git commit -m "feat(ui): implement Rubric Gap Matrix and Brag Doc generator"`**

---

### Task 10: Embedded Web UI — Resume Tailoring Canvas & Pre-Flight Gate (`packages/ui`)
- Target: `packages/ui`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/views/ResumeTailor.tsx`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/components/PreFlightModal.tsx`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/src/components/EvidencePickerModal.tsx`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/ui/tests/resume-tailor.test.tsx`

- [x] **Step 1: Build Job Matcher canvas allowing side-by-side job description comparison and keyword highlighting**
- [x] **Step 2: Build modular bullet selector with citation tags and "+ Add Bullet from Evidence" picker**
- [x] **Step 3: Build live preview panel showing styled print layout (HTML/PDF), ATS markdown, Typst, and LaTeX**
- [x] **Step 4: Build Pre-Flight Integrity Modal that blocks export on dangling citations or banned terms, offering one-click Redact & Download**
- [x] **Step 5: Verify build with `npm run build`**
- [x] **Step 6: Commit changes: `git commit -m "feat(ui): implement Resume Tailoring Canvas and Pre-Flight Gate"`**

---

### Task 11: End-to-End Verification, Dogfooding & Packaging
- Target: Root & Packages
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/README.md`
- Create: `C:/Users/drewk/orca/workspaces/career/featherduster-app/LICENSE`
- Test: `C:/Users/drewk/orca/workspaces/career/featherduster-app/packages/cli/tests/bin.test.ts`

- [x] **Step 1: Configure monorepo build pipeline (`npm run build` cleanly chaining core -> ui -> cli)**
- [x] **Step 2: Write comprehensive root `README.md` and `LICENSE` (MIT)**
- [x] **Step 3: Run end-to-end smoke test verifying `init`, `check`, and `build` in isolated temporary directory**
- [x] **Step 4: Run full test suite across all monorepo workspaces (195/195 passing)**
- [x] **Step 5: Commit changes: `git commit -m "feat: complete end-to-end verification, build pipeline, and open-source documentation"`**
