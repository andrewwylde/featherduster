# Full Dependency Overhaul & Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul production and development dependencies across the Featherduster monorepo to eliminate all 19 `npm audit` vulnerabilities (reducing findings to 0) while keeping all 142 test files and builds passing.

**Architecture:** 
1. Remove legacy `gray-matter` in `@featherduster/core` and implement frontmatter parsing/serialization using the existing `js-yaml` (v4), eliminating `gray-matter`, `js-yaml@3`, `argparse@1`, and `sprintf-js`.
2. Upgrade `@featherduster/cli` production runtime dependencies: `hono` to `^4.13.13` (fixing `serveStatic` decode bypass) and `chokidar` to `^4.0.3` (eliminating `braces` and `chokidar@3`).
3. Upgrade build/test toolchain: `vite` to `^6.4.5` and `vitest` to `^4.1.12` across root and package manifests, eliminating `tinypool` (2 critical RCE advisories), `@vitest/mocker`, and `esbuild` vulnerabilities.
4. Upgrade `@featherduster/ui` styling stack to Tailwind CSS v4 (`@tailwindcss/vite`), eliminating `micromatch`, `fast-glob`, `postcss-nested`, `postcss-selector-parser`, and transitive `braces`.
5. Rebuild all packages, execute full test suite (142 files, 1,650+ tests), verify 0 audit findings with `npm audit`, update `docs/releases/v0.2.0-validation.md`, and commit on `release/v0.2.0`.

**Tech Stack:** Node.js 20+, TypeScript 5.5+, Hono 4.13.13, Chokidar 4.0.3, js-yaml 4.1.0, Vite 6.4.5, Vitest 4.1.12, Tailwind CSS 4.3.3, React 18.3.1.

---

### Task 1: Replace `gray-matter` with native `js-yaml` in `@featherduster/core`

**Files:**
- Modify: `packages/core/src/parsers/evidence-parser.ts`
- Modify: `packages/core/package.json`
- Delete: `packages/core/src/types/gray-matter.d.ts`
- Test: `packages/core/tests/evidence-parser.test.ts`

- [ ] **Step 1: Inspect failing evidence parser test baseline**

Run: `npx vitest run packages/core/tests/evidence-parser.test.ts`
Expected: PASS (baseline check before replacing `gray-matter`).

- [ ] **Step 2: Replace `gray-matter` in `packages/core/src/parsers/evidence-parser.ts`**

Update `parseEvidenceMarkdown` and `serializeEvidenceMarkdown` to use `js-yaml` directly:
- Validate frontmatter start (`content.trim().startsWith('---')`).
- Match frontmatter block via regex `/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/`.
- Parse YAML with `yaml.load(yamlBlock)`.
- Serialize with `yaml.dump(validatedEntry, { lineWidth: -1, noRefs: true })`.
- Ensure round-trip idempotency and handling of unquoted dates.

- [ ] **Step 3: Remove `gray-matter` dependency and type declarations**

- In `packages/core/package.json`, remove `"gray-matter": "^4.0.3"` from `dependencies`.
- Delete `packages/core/src/types/gray-matter.d.ts`.

- [ ] **Step 4: Run tests and build core**

Run:
```bash
npm run build:core
npx vitest run packages/core/tests/evidence-parser.test.ts
```
Expected: PASS (all 38 parser tests pass, core compiles without TypeScript errors).

- [ ] **Step 5: Commit core changes**

```bash
git add packages/core/src/parsers/evidence-parser.ts packages/core/package.json packages/core/src/types/gray-matter.d.ts
git commit -m "refactor(core): replace gray-matter with native js-yaml to eliminate sprintf-js vulnerability"
```

---

### Task 2: Upgrade `hono` and `chokidar` in `@featherduster/cli`

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/watcher.ts`
- Test: `packages/cli/tests/bin.test.ts`
- Test: `packages/cli/tests/settings.test.ts`

- [ ] **Step 1: Update CLI package dependencies**

In `packages/cli/package.json`:
- Bump `"hono"` to `^4.13.13`
- Bump `"chokidar"` to `^4.0.3`

- [ ] **Step 2: Adapt `packages/cli/src/watcher.ts` for Chokidar v4**

Chokidar v4 dropped `fsevents` and `braces` and standardized its export and watcher options.
Verify `import chokidar, { FSWatcher } from 'chokidar';` or `import { watch, type FSWatcher } from 'chokidar';`.
Verify options: `ignoreInitial: true, persistent: true, followSymlinks: false, ignored: [...]`.

- [ ] **Step 3: Build CLI and run CLI tests**

Run:
```bash
npm run build:cli
npx vitest run packages/cli/tests/bin.test.ts
npx vitest run packages/cli/tests/settings.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit CLI changes**

```bash
git add packages/cli/package.json packages/cli/src/watcher.ts
git commit -m "fix(cli): upgrade hono to 4.13.13 and chokidar to 4.0.3"
```

---

### Task 3: Upgrade `vite` to v6 and `vitest` to v4

**Files:**
- Modify: `package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vite.config.ts`

- [ ] **Step 1: Update Vite and Vitest dependencies in manifests**

- Root `package.json`:
  - `"vitest": "^4.1.12"`
  - Add `"vite": "^6.4.5"` to `devDependencies`
- `packages/core/package.json`:
  - `"vitest": "^4.1.12"`
- `packages/cli/package.json`:
  - `"vitest": "^4.1.12"`
- `packages/ui/package.json`:
  - `"vite": "^6.4.5"`
  - `"vitest": "^4.1.12"`
  - `"@vitejs/plugin-react": "^4.7.0"`

- [ ] **Step 2: Install updated test and build dependencies**

Run: `npm install`
Expected: Installs Vite 6.4.5 and Vitest 4.1.12; tinypool and esbuild <=0.24 are replaced.

- [ ] **Step 3: Test and build all packages**

Run:
```bash
npm run build
npm test -- packages/cli/tests/bin.test.ts
```
Expected: PASS with Vite 6 and Vitest 4.

- [ ] **Step 4: Commit Vite and Vitest upgrade**

```bash
git add package.json packages/*/package.json package-lock.json packages/ui/vite.config.ts
git commit -m "chore: upgrade vite to 6.4.5 and vitest to 4.1.12"
```

---

### Task 4: Upgrade `@featherduster/ui` to Tailwind CSS v4

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vite.config.ts`
- Modify: `packages/ui/src/index.css`
- Delete: `packages/ui/postcss.config.js`
- Delete: `packages/ui/tailwind.config.js`
- Test: `packages/ui/tests/jobs-ui.test.tsx`
- Test: `packages/ui/tests/job-proposal-review.test.tsx`

- [ ] **Step 1: Update UI package dependencies**

In `packages/ui/package.json`:
- Replace `"tailwindcss": "^3.4.10"`, `"postcss": "^8.4.45"`, `"autoprefixer": "^10.4.20"`
- With `"tailwindcss": "^4.3.3"`, `"@tailwindcss/vite": "^4.3.3"`

- [ ] **Step 2: Update `packages/ui/vite.config.ts`**

Import and add `@tailwindcss/vite` plugin:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  ...
```

- [ ] **Step 3: Migrate `packages/ui/src/index.css` to Tailwind v4 `@theme`**

Replace `@tailwind base; @tailwind components; @tailwind utilities;` with:
```css
@import "tailwindcss";

@theme {
  --color-vermilion-50: #fff1ef;
  --color-vermilion-100: #ffe1dc;
  --color-vermilion-200: #ffc7be;
  --color-vermilion-300: #ffa193;
  --color-vermilion-400: #f87171;
  --color-vermilion-500: #d93829;
  --color-vermilion-600: #c23022;
  --color-vermilion-700: #a32418;
  --color-vermilion-800: #841f16;
  --color-vermilion-900: #691c14;
  --color-vermilion-950: #45120c;

  --color-brand-50: #f0fdf4;
  --color-brand-100: #dcfce7;
  --color-brand-500: #22c55e;
  --color-brand-600: #16a34a;
  --color-brand-700: #15803d;

  --color-desk-bg-light: #fbfbfb;
  --color-desk-bg-dark: #0c0f17;
  --color-desk-panel-light: #ffffff;
  --color-desk-panel-dark: #121622;
  --color-desk-card-light: #ffffff;
  --color-desk-card-dark: #161c2b;
  --color-desk-border-light: #e2e8f0;
  --color-desk-border-dark: #1e293b;

  --radius-desk: 10px;
}
```
Remove `packages/ui/postcss.config.js` and `packages/ui/tailwind.config.js`.

- [ ] **Step 4: Build and test UI package**

Run:
```bash
npm run build:ui
npx vitest run packages/ui/tests/jobs-ui.test.tsx
npx vitest run packages/ui/tests/job-proposal-review.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit Tailwind v4 upgrade**

```bash
git add packages/ui/ packages/ui/vite.config.ts packages/ui/src/index.css
git rm packages/ui/postcss.config.js packages/ui/tailwind.config.js
git commit -m "feat(ui): migrate to Tailwind CSS v4 and @tailwindcss/vite"
```

---

### Task 5: Full validation, audit verification, and release documentation

**Files:**
- Modify: `docs/releases/v0.2.0-validation.md`
- Test: Full monorepo test suite

- [ ] **Step 1: Run `npm audit`**

Run: `npm audit`
Expected: `found 0 vulnerabilities`.

- [ ] **Step 2: Run full build and complete test suite**

Run:
```bash
npm run build
npm test
```
Expected: All packages build, 142 test files pass, 1,650+ tests pass.

- [ ] **Step 3: Update `docs/releases/v0.2.0-validation.md`**

Update validation report to record:
- Remediated all 19 findings: 0 vulnerabilities remaining.
- Re-tested full suite across all workspaces.
- Mark publication blockers as resolved.

- [ ] **Step 4: Commit release documentation and update draft release**

```bash
git add docs/releases/v0.2.0-validation.md package-lock.json
git commit -m "docs(release): document complete remediation of all 19 dependency audit findings"
```
Update GitHub release notes on draft `untagged-7e2cdd01b185df355bef` removing the blocker warning.
