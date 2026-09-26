# Implementation Plan: Add Test Coverage for Uncovered Modules

## Overview
Add dedicated Vitest test files for 5 modules that currently lack test coverage. Each test file will verify exported functions, edge cases, and failure modes using the existing test patterns in the monorepo.

---

## Files to Create

### 1. `packages/cli/tests/evidence-files.test.ts`
**Target:** `packages/cli/src/evidence-files.ts`  
**Exports to test:**
- `isConsolidatedLedgerFile(file: string): boolean`
- `toWorkspaceRelative(workspaceDir: string, file: string): string`
- `isInsideWorkspace(workspaceDir: string, file: string): boolean`

**Test cases:**
| Function | Scenarios |
|----------|-----------|
| `isConsolidatedLedgerFile` | Returns true for files starting with "evidence-ledger" (case-insensitive); returns false for non-existent files; returns true for existing ledger files with valid entries array; returns false for files without "entries:" key; returns false on parse errors |
| `toWorkspaceRelative` | Normalizes path separators to forward slashes; returns relative path from workspace |
| `isInsideWorkspace` | Returns true for files inside workspace; returns false for files outside workspace; handles symlinks correctly |

**Patterns to follow:** Use `fs.mkdtempSync` + temp dirs like `settings.test.ts` and `evidence-writes.test.ts`. Mock `parseEvidenceLedger` from `@featherduster/core` if needed.

---

### 2. `packages/cli/tests/settings-routes.test.ts`
**Target:** `packages/cli/src/settings/routes.ts`  
**Exports to test:** `mountSettingsRoutes(app: Hono, deps: SettingsRouteDeps): void`

**Note:** This module mounts HTTP routes. Test via the Hono app using the same pattern as `settings.test.ts` (which already tests the settings API endpoints). The new test file should focus on route-specific behavior not covered in `settings.test.ts`:
- JSON body requirement middleware (`requireJson`)
- All 14 route handlers (GET/PUT/POST/DELETE on `/api/settings/*`)
- Error responses: 400 (validation), 403 (consent), 404, 409, 415 (non-JSON), 500, 503
- Ollama models endpoint with timeout and error handling

**Test cases:**
- `requireJson` middleware blocks form-encoded POST/PUT/DELETE with 415
- `GET /api/settings` returns snapshot with runner, consent, deslop, credentials
- `PUT /api/settings/runner` validates via `RunnerSettingsPatchSchema`, writes config, returns snapshot
- `PUT /api/settings/credentials/anthropic` validates key shape, stores in credential store, returns snapshot
- `DELETE /api/settings/credentials/anthropic` deletes key, returns snapshot
- `DELETE /api/settings/consent/:runner` validates runner in TESTABLE list, revokes consent
- `POST /api/settings/runners/:id/test` runs detection, returns availability
- `GET /api/settings/ollama/models` fetches from URL, handles timeout/unreachable
- `GET/POST` Claude Code auth routes (status, login, cancel, logout)
- `GET/POST` Codex auth routes (status, login, cancel, api-key, logout)

**Patterns to follow:** Use `createApp` from `../src/server.js`, `MemoryCredentialStore`, `FakeRunner`, `WorkspaceWatcher` like in `settings.test.ts` and `tailoring.test.ts`.

---

### 3. `packages/cli/tests/tailoring-routes.test.ts`
**Target:** `packages/cli/src/tailoring/routes.ts`  
**Exports to test:** `mountTailoringRoutes(app: Hono, orchestrator: TailoringOrchestrator): void`

**Note:** This module mounts 12 tailoring API routes. Many are already integration-tested via `tailoring.test.ts`. The new test file should focus on:
- Route-level error handling via `handleError` (TailoringError, RunStoreError, generic)
- JSON body parsing via `readJson`
- Path parameter extraction and validation
- Individual route response shapes

**Test cases:**
- `GET /api/runners` returns runner list from orchestrator
- `POST /api/runners/consent` records consent, returns success
- `GET /api/tailoring-citations` returns citation index
- `GET /api/tailoring` lists runs
- `POST /api/tailoring` creates run, returns 201 with slug and manifest
- `GET /api/tailoring/:slug` returns run details
- `POST /api/tailoring/:slug/steps/:step/run` starts step, returns 202
- `GET /api/tailoring/:slug/steps/:step/preview` returns preview
- `PUT /api/tailoring/:slug/steps/:step` saves step data
- `POST /api/tailoring/:slug/steps/:step/approve` approves step
- `POST /api/tailoring/:slug/cancel` cancels run
- `POST /api/tailoring/:slug/finalize` finalizes run
- Error mapping: TailoringError → status/code/detail, RunStoreError → 403/404/409, generic → 500

**Patterns to follow:** Mock `TailoringOrchestrator` with vi.fn() implementations. Use Hono test client via `app.request()` like existing tests.

---

### 4. `packages/cli/tests/store.test.ts`
**Target:** `packages/cli/src/tailoring/store.ts`  
**Exports to test:**
- `isValidSlug(slug: string): boolean`
- `slugify(label: string): string`
- `timestampSlug(date: Date): string`
- `class RunStore` (constructor, `runDir`, `filePath`, `exists`, `allocateSlug`, `create`, `readManifest`, `writeManifest`, `readText`, `writeText`, `readJson`, `writeJson`, `list`, `writeAtomic`)

**Test cases:**
| Function/Method | Scenarios |
|-----------------|-----------|
| `isValidSlug` | Valid: `run-20260101-120000`, `acme-staff`, `a`; Invalid: `Run-123`, `_invalid`, `too-long...`, `..`, `/absolute`, empty |
| `slugify` | Lowercases, removes accents, replaces non-alnum with dashes, trims dashes, truncates to 60, handles edge cases |
| `timestampSlug` | Format: `run-YYYYMMDD-HHMMSS` with zero-padding |
| `RunStore.runDir` | Returns correct path; throws 400 for invalid slug; throws 403 for path traversal |
| `RunStore.filePath` | Returns file path; throws 403 for symlinks |
| `RunStore.exists` | True only for valid slugs with manifest file |
| `RunStore.allocateSlug` | Uses label slug or timestamp; appends `-N` for collisions |
| `RunStore.create` | Creates directory; throws 409 if exists |
| `RunStore.readManifest` | Parses YAML with schema; throws 404 if missing |
| `RunStore.writeManifest` | Validates schema, writes atomically with yaml.dump options |
| `RunStore.readText/writeText` | Returns null for missing; writes content |
| `RunStore.readJson/writeJson` | Parses with custom parse fn; returns null on parse error |
| `RunStore.list` | Returns sorted manifests (newest first); skips malformed runs |
| `RunStore.writeAtomic` | Uses pid temp file + renameSync; falls back to direct write on Windows error |

**Patterns to follow:** Use temp dirs with `fs.mkdtempSync` like `tailoring.test.ts` beforeEach/afterEach. Test `RunStoreError` status codes.

---

### 5. `packages/ui/tests/routing.test.ts`
**Target:** `packages/ui/src/routing.ts`  
**Exports to test:**
- `CANVAS_PATH` constant
- `redirectForPath(pathname: string): string | null`
- `pathForTab(tab: NavTab): string`
- `tabForPath(pathname: string): NavTab`
- `tailoringSlugForPath(pathname: string): string | null`
- `tailorViewForPath(pathname: string): TailorView`
- `normalize(pathname: string): string` (not exported but testable via re-export or indirect)

**Test cases:**
| Function | Scenarios |
|----------|-----------|
| `redirectForPath` | Returns `/tailor/canvas` for `/exports`; returns null for current paths; normalizes trailing slashes |
| `pathForTab` | Returns correct path for each `NavTab` value |
| `tabForPath` | Maps each path to correct tab; handles legacy `/exports` → `tailor`; handles `/tailor/*` → `tailor`; defaults to `briefing` |
| `tailoringSlugForPath` | Extracts slug from `/tailor/<slug>`; returns null for `/tailor/`, `/tailor/canvas`, non-matching paths; validates slug regex |
| `tailorViewForPath` | Returns `{mode: 'canvas'}` for canvas; `{mode: 'run', slug}` for valid slugs; `{mode: 'list'}` for `/tailor` |
| `normalize` | Strips trailing slashes (except root); handles empty string |

**Patterns to follow:** Pure unit tests (no DOM). Use `describe`/`it`/`expect` like `app-routes.test.tsx` but without React Testing Library. The existing `app-routes.test.tsx` tests routing at integration level; this file tests the pure routing logic.

---

## Test Commands

Run individual test files:
```bash
# CLI tests
npx vitest run packages/cli/tests/evidence-files.test.ts
npx vitest run packages/cli/tests/settings-routes.test.ts
npx vitest run packages/cli/tests/tailoring-routes.test.ts
npx vitest run packages/cli/tests/store.test.ts

# UI tests
npx vitest run packages/ui/tests/routing.test.ts
```

Run full suite (verification step):
```bash
npm test
npm run build
```

---

## Notes for Builder

1. **Naming conflict resolved:** The task mentions `routes.test.ts` for both `settings/routes.ts` and `tailoring/routes.ts`. I've split them into `settings-routes.test.ts` and `tailoring-routes.test.ts` to avoid collision, following the existing pattern (`settings.test.ts`, `tailoring.test.ts`).

2. **Existing coverage:** `settings.test.ts` and `tailoring.test.ts` already integration-test many of these routes. The new files should focus on:
   - Unit testing the route mounting functions directly
   - Edge cases not hit by integration tests (malformed JSON, missing params, error mapping)
   - Pure logic functions (`isConsolidatedLedgerFile`, `slugify`, `redirectForPath`, etc.)

3. **Test utilities available:**
   - `createApp` from `../src/server.js` (CLI)
   - `MemoryCredentialStore`, `UnavailableCredentialStore` from `../src/settings/credentials.js`
   - `FakeRunner` from `../src/runners/fake.js`
   - `WorkspaceWatcher` from `../src/watcher.js`
   - `yaml` from `js-yaml`
   - Temp dir pattern: `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))`

4. **RunStore testing:** The `RunStore` class uses `fs` directly. Use real filesystem in temp dirs (not mocks) to test atomic writes, symlink rejection, path traversal protection.

5. **UI routing tests:** Do not use `@testing-library/react` — these are pure logic tests. The `app-routes.test.tsx` covers integration; this file covers the routing module's functions.

6. **Dependencies:** All test files should import from the source modules directly (e.g., `import { isConsolidatedLedgerFile } from '../src/evidence-files.js'`).

7. **No new dependencies needed** — all test utilities already exist in the codebase.