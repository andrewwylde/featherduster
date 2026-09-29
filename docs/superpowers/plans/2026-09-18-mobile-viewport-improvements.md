# Featherduster Mobile Viewport UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Featherduster web UI into a first-class, touch-optimized, responsive experience across mobile (320px–430px) and tablet (768px–1024px) viewports while preserving its bespoke editorial desk aesthetic, privacy guarantees, and verifiable resume workflows.

**Architecture:** A responsive shell that adapts seamlessly between desktop and mobile modes:
1. **Desktop ($\ge$ 768px):** Persistent left `DeskSidebar`, full 2-pane/3-column canvases, and desktop header.
2. **Mobile (< 768px):** Hidden sidebar replaced with an ergonomic `MobileBottomNav` (Briefing, Tailor, Threads, Evidence, Skills, More), a touch-friendly `DeskHeader` with collapsible search and mobile integrity indicator, full-width bottom sheet modals, segmented pane switchers for multi-column canvases (Resume Tailor & Story Threads), and safe-area inset support (`100dvh`).

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Lucide React, Vite 5, Vitest & React Testing Library.

**Target Workspaces:**
- App Workspace: `C:/Users/drewk/featherduster/packages/ui`
- Career Corpus: `C:/Users/drewk/career`

---

## 1. Problem Statement & Audit Findings

| Component / Area | Desktop Assumption | Mobile Viewport Failure (< 768px) | Severity |
| :--- | :--- | :--- | :---: |
| **Global Shell (`Layout.tsx`, `DeskSidebar.tsx`)** | Fixed `w-64` (256px) sidebar on left | Consumes 68% of a 375px screen; squeezes content into 119px or causes massive horizontal overflow | **Blocker** |
| **Desk Header (`DeskHeader.tsx`)** | Wide `max-w-xl` search input; hidden sm/lg pills | Search bar squishes header; `Integrity` audit trigger is hidden under 640px, blinding mobile users | **Blocker** |
| **Story Threads Node Map (`StoryThreadsNodeMap.tsx`)** | 3 side-by-side columns with `min-w-[560px]` | Traps users in horizontal scroll within card; Inspector stacked far below all 3 columns | **Blocker** |
| **Resume Tailor (`ResumeTailor.tsx`)** | 12-column grid (`5 col` matcher + `7 col` editor) | Vertically stacks into an endless ~6,000px scroll; action buttons wrap into 4 clunky rows; HTML preview blows past viewport | **Blocker** |
| **Quick-Capture Modal (`QuickCaptureModal.tsx`)** | Multi-input inline flex rows (Name + Value + Status + Delete) | Metric rows blow out horizontally past screen width; modal clipped on small heights | **Blocker** |
| **Export Drawer (`ExportDrawer.tsx`)** | Hardcoded `pl-10` (40px) left margin; `grid-cols-3` actions | Wastes 40px screen width on phones; action buttons clip text; iframe print preview overflows | **Major** |
| **Tailoring Run Proposals (`ProposalsStep.tsx`)** | Side-by-side word diffs | Word diff columns become illegible < 500px; approval button scrolled off screen | **Major** |
| **Touch Ergonomics & Input Zoom** | 14px inputs; small 28px icon buttons | iOS Safari auto-zooms viewport on 14px input focus; buttons fail WCAG 44x44px touch target | **Major** |

---

## 2. Responsive Design System & Mobile Tokens

### 2.1 Viewport Breakpoint Matrix
- **Mobile Compact (`< 380px`):** iPhone SE (375px), Galaxy Fold (320px–360px). Single column, 14px base typography, stacked controls, bottom bar labels minimized.
- **Mobile Standard (`380px – 639px`):** iPhone 14/15/16 (393px–430px), Pixel 8 (412px). Full bottom nav, segmented switchers, 16px form inputs (no iOS zoom).
- **Tablet / Phablet (`640px – 767px`):** iPad Mini portrait, foldable unfolded. 2-column grids, compact sidebar trigger option.
- **Desktop (`\ge 768px`):** Existing persistent sidebar, multi-pane canvas layouts.

### 2.2 Viewport & Safe-Area Hygiene
```css
/* packages/ui/src/index.css */
@supports (min-height: 100dvh) {
  .min-h-screen-dvh {
    min-height: 100dvh;
  }
}

.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 1rem);
}

.pt-safe {
  padding-top: env(safe-area-inset-top, 0rem);
}
```

### 2.3 Mobile-First Component Patterns
1. **Segmented Canvas Switcher:** Multi-pane desktop layouts (e.g. Resume Tailor Left/Right, Story Threads 3-Columns) convert to an animated top tab bar on mobile:
   - `ResumeTailor`: `[Job Target | Bullets & Specs | Preview & Export]`
   - `StoryThreads`: `[1. Sources (N) | 2. Evidence (N) | 3. Threads (N)]`
2. **Bottom Sheet Modals:** Modals transition on `< sm` from centered dialogs to full-width bottom sheets sliding up from the bottom edge (`fixed inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl`) with sticky drag/action headers.
3. **Sticky Action Ledge:** Multi-step workflows (`TailoringRun`, `FocusedInterview`) anchor primary approval/capture actions to a sticky bottom bar above the safe area.

---

## 3. File Structure & Responsibilities

```
packages/ui/
├── src/
│   ├── components/
│   │   ├── desk/
│   │   │   ├── DeskHeader.tsx               # Updated with mobile menu toggle, mobile search bar, and compact integrity badge
│   │   │   ├── DeskSidebar.tsx              # Updated to hidden on < md; slide-over drawer mode for tablet/mobile
│   │   │   ├── MobileBottomNav.tsx          # NEW: Fixed bottom navigation bar for mobile viewports
│   │   │   └── MobileMoreDrawer.tsx         # NEW: Bottom sheet for settings, onboarding, and workspace details
│   │   ├── Layout.tsx                       # Updated with 100dvh, responsive main padding, and MobileBottomNav
│   │   ├── QuickCaptureModal.tsx            # Updated: mobile bottom sheet, stacked metric rows
│   │   ├── ExportDrawer.tsx                 # Updated: pl-0 on mobile, responsive release action grid
│   │   └── PreFlightModal.tsx               # Updated: mobile bottom sheet with scrollable violation cards
│   ├── views/
│   │   ├── EvidenceExplorer.tsx             # Updated: responsive metric stats, mobile filter drawer / horizontal tray
│   │   ├── ResumeTailor.tsx                 # Updated: mobile 3-pane switcher, compact header, fit-to-width HTML preview
│   │   ├── RubricGapMatrix.tsx              # Updated: responsive rubric selector & target level chips
│   │   └── desk/
│   │       ├── StoryThreadsNodeMap.tsx      # Updated: segmented 3-stage switcher, mobile bottom sheet inspector
│   │       ├── PrivateBriefing.tsx          # Updated: responsive lead card & action stacks
│   │       └── EvidenceStrengthener.tsx     # Updated: stacked checklist & mobile form fields
│   ├── views/tailoring/
│   │   ├── TailoringRun.tsx                 # Updated: sticky mobile pane navigation and action bar
│   │   └── steps/
│   │       ├── AnalysisStep.tsx             # Updated: responsive requirement cards
│   │       ├── AlignmentStep.tsx            # Updated: touch-friendly rating tiles
│   │       └── ProposalsStep.tsx            # Updated: stacked unified diff mode on small screens
│   └── index.css                            # Safe-area and mobile utility classes
└── tests/
    ├── mobile-navigation.test.tsx           # NEW: Tests for mobile bottom nav, drawer, and header
    ├── mobile-canvases.test.tsx             # NEW: Tests for segmented mobile switchers in tailor & threads
    └── mobile-modals.test.tsx               # NEW: Tests for modal responsiveness and metric stacking
```

---

## Task 1: Responsive Shell, Mobile Bottom Navigation & Header (`packages/ui`)

**Files:**
- Create: `packages/ui/src/components/desk/MobileBottomNav.tsx`
- Create: `packages/ui/src/components/desk/MobileMoreDrawer.tsx`
- Modify: `packages/ui/src/components/desk/DeskSidebar.tsx`
- Modify: `packages/ui/src/components/desk/DeskHeader.tsx`
- Modify: `packages/ui/src/components/Layout.tsx`
- Modify: `packages/ui/src/index.css`
- Test: `packages/ui/tests/mobile-navigation.test.tsx`

- [x] **Step 1: Write failing test for mobile navigation shell**
  - Verify `DeskSidebar` is hidden or collapsable when viewport is mobile (`window.innerWidth < 768`).
  - Verify `MobileBottomNav` renders primary navigation buttons (`Briefing`, `Tailor`, `Threads`, `Evidence`, `Skills`, `More`).
  - Verify clicking `More` opens `MobileMoreDrawer` containing `Settings`, `Onboarding`, and `Workspace` path.
  - Verify `DeskHeader` renders a mobile-visible integrity pill and search toggle.

- [x] **Step 2: Implement `MobileBottomNav.tsx`**
  - Fixed to bottom (`fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#0f131d]/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 pb-safe md:hidden`).
  - 5 primary items: Briefing (`FileText`), Tailor (`WandSparkles`), Threads (`MessageSquare`), Evidence (`BookOpen`), Skills (`Target`), and More (`Menu`).
  - Active state: vermilion indicator bar at the top or pill background; minimum 48px tap targets with centered icons and 10px text labels.

- [x] **Step 3: Implement `MobileMoreDrawer.tsx`**
  - Accessible bottom sheet drawer powered by `useModalA11y`.
  - Displays Workspace path, Integrity audit status, Settings navigation, and Foundation Onboarding trigger.

- [x] **Step 4: Update `DeskSidebar.tsx` and `Layout.tsx`**
  - Change `DeskSidebar` root to `hidden md:flex w-64 flex-shrink-0 flex-col ...`.
  - Update `Layout.tsx` main container:
    - Replace `min-h-screen` with `min-h-[100dvh] flex flex-col`.
    - Main content: `px-4 py-4 sm:px-6 sm:py-8 pb-24 md:pb-8 flex-1`.
    - Mount `MobileBottomNav` for mobile users.

- [x] **Step 5: Update `DeskHeader.tsx` for mobile viewports**
  - Add search expansion toggle on mobile (magnifying glass icon expands to full-width input overlay on click).
  - Ensure Integrity badge is visible on mobile as a compact icon dot/shield (`sm:hidden flex items-center p-1.5 rounded-full border`).
  - Ensure theme toggle is easily accessible with a minimum 44x44px touch target.

- [x] **Step 6: Run tests to verify Task 1 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/mobile-navigation.test.tsx
  ```

---

## Task 2: Evidence Explorer Mobile Optimization (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/views/EvidenceExplorer.tsx`
- Test: `packages/ui/tests/explorer.test.tsx`

- [x] **Step 1: Write test for Evidence Explorer mobile layouts**
  - Test metric counters render as a clean 2x2 grid or swipeable strip without clipping on narrow screens.
  - Test search and filters stack gracefully with mobile touch-friendly selects.
  - Test evidence card actions and tag wraps on 360px simulated width.

- [x] **Step 2: Refactor Metric Counters & Header**
  - Header: Stack title and action buttons cleanly (`flex-col sm:flex-row gap-3`).
  - Metrics Grid: Change `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` to `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4`.
  - For small mobile screens, ensure stats cards have compact padding (`p-3 sm:p-4`) and font sizes that prevent number truncation.

- [x] **Step 3: Refactor Filter Bar for Mobile**
  - Turn the horizontal filter cluster into a mobile-friendly layout:
    - Search input full width.
    - Company and Confidence dropdowns in a 2-column grid on mobile (`grid grid-cols-2 sm:flex gap-2`).
    - Theme tags in a horizontally swipeable scroll container (`overflow-x-auto no-scrollbar flex items-center gap-1.5 py-1`).

- [x] **Step 4: Refactor Evidence Card Component**
  - Ensure metadata badges (confidence, in-flight, company, date) wrap smoothly without pushing cards out of bounds.
  - Quantitative metrics badge list: Stack metric items cleanly with clear labels.
  - Action buttons (`View details`, `Edit`): Use 44px min-height buttons across the card footer.
  - Sticky mobile "+ Capture" button: Add a subtle floating action button or sticky bottom action button when scrolled.

- [x] **Step 5: Run tests to verify Task 2 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/explorer.test.tsx
  ```

---

## Task 3: Story Threads & Node Map Mobile Architecture (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/views/desk/StoryThreadsNodeMap.tsx`
- Test: `packages/ui/tests/desk-nodemap.test.tsx`
- Test: `packages/ui/tests/mobile-canvases.test.tsx`

- [x] **Step 1: Write test for Story Threads Node Map mobile mode**
  - On viewports `< 1024px`, verify the view provides a 3-stage segmented control: `[1. Sources (N) | 2. Evidence (N) | 3. Threads (N)]`.
  - Verify switching stages updates the visible node list without horizontal overflow.
  - Verify selecting a node on mobile opens the Traceable Inspector as an accessible bottom sheet or modal rather than forcing a scroll past 500px of cards.

- [x] **Step 2: Implement Responsive Node Map View Switcher**
  - Replace `<div className="grid grid-cols-3 gap-6 min-w-[560px]">` with a responsive wrapper:
    - On `lg:` (desktop): Keep the 3-column side-by-side node grid with relational illumination.
    - On `< lg` (mobile/tablet): Render a segmented tab control:
      ```tsx
      <div role="tablist" className="flex lg:hidden rounded-desk bg-slate-100 p-1 dark:bg-slate-900 mb-4">
        <button role="tab" aria-selected={activeStage === 'sources'}>1. Sources ({sources.length})</button>
        <button role="tab" aria-selected={activeStage === 'evidence'}>2. Evidence ({evidence.length})</button>
        <button role="tab" aria-selected={activeStage === 'threads'}>3. Threads ({threads.length})</button>
      </div>
      ```
    - Display the active stage's cards in a full-width vertical list with relational illumination badges.

- [x] **Step 3: Implement Mobile Inspector Bottom Sheet**
  - On `< lg`, when an entity (`source`, `evidence`, `thread`) is selected, pop up an expandable bottom drawer or slide-over sheet containing the full provenance trail and action buttons (`Strengthen`, `View Details`).
  - Add a dismiss button (`X`) and backdrop touch dismiss.

- [x] **Step 4: Run tests to verify Task 3 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/desk-nodemap.test.tsx tests/mobile-canvases.test.tsx
  ```

---

## Task 4: Resume Tailoring Canvas Mobile Experience (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/views/ResumeTailor.tsx`
- Modify: `packages/ui/src/components/ExportDrawer.tsx`
- Test: `packages/ui/tests/resume-tailor.test.tsx`
- Test: `packages/ui/tests/export-drawer.test.tsx`

- [x] **Step 1: Write test for Resume Tailor mobile viewport states**
  - Test mobile pane switcher: `[Target Job | Resume Bullets | Preview & Export]`.
  - Test that clicking `Preview & Export` renders the selected compiler format without horizontal clipping.
  - Test that 1-page line budget indicator collapses to a compact telemetry badge on mobile.
  - Test `ExportDrawer` opens full-width on mobile without `pl-10`.

- [x] **Step 2: Implement Mobile 3-Pane Switcher in `ResumeTailor.tsx`**
  - Add state: `const [mobileTab, setMobileTab] = useState<'job' | 'bullets' | 'preview'>('bullets');`.
  - Add segmented control on mobile (`xl:hidden`):
    - `Job Matcher`: Variant selector, job description textarea, matched/missing keyword pills.
    - `Resume Bullets`: Modular experience list, bullet toggles, "+ Add Bullet from Evidence" button, de-slop trigger.
    - `Preview & Export`: Live compiled preview (ATS Markdown, HTML Print, Typst, LaTeX), 1-page budget telemetry, and export trigger.

- [x] **Step 3: Compact Mobile Action Toolbar**
  - Condense the top action bar:
    - Combine `Budget`, `Squeeze`, `De-Slop`, `Pre-Flight`, and `Deliverables` into a responsive flex wrap with icons.
    - Budget badge: Compact font-mono chip (`58/62 lines`).
    - Make "Deliverables & Exports" sticky or prominent at the bottom in mobile mode.

- [x] **Step 4: Responsive HTML Print Preview & Typst Zoom Wrapper**
  - Wrap HTML print layout (`w-[8.5in]`) in a responsive scale viewport container:
    ```tsx
    <div className="w-full overflow-hidden flex justify-center bg-slate-900/50 p-2 sm:p-6 rounded-2xl">
      <div className="origin-top scale-[0.42] xs:scale-[0.5] sm:scale-[0.75] md:scale-[0.9] lg:scale-100 transition-transform">
        <iframe ... />
      </div>
    </div>
    ```
  - Allows mobile users to see the authentic 1-page document layout without horizontal viewport breakage.

- [x] **Step 5: Mobile Optimization for `ExportDrawer.tsx`**
  - Remove `pl-10` on mobile: `className="fixed inset-y-0 right-0 max-w-2xl w-full flex pl-0 sm:pl-10"`.
  - Action button grid: Change `grid grid-cols-3 gap-2.5` to `grid grid-cols-1 sm:grid-cols-3 gap-2` so buttons like "Copy ATS Markdown" and "One-Click Release Bundle" have full width for readable text.

- [x] **Step 6: Run tests to verify Task 4 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/resume-tailor.test.tsx tests/export-drawer.test.tsx
  ```

---

## Task 5: Tailoring Run & Multi-Step Workflow Polish on Mobile (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/views/tailoring/TailoringRun.tsx`
- Modify: `packages/ui/src/views/tailoring/steps/AnalysisStep.tsx`
- Modify: `packages/ui/src/views/tailoring/steps/AlignmentStep.tsx`
- Modify: `packages/ui/src/views/tailoring/steps/ProposalsStep.tsx`
- Test: `packages/ui/tests/tailoring-ui.test.tsx`

- [x] **Step 1: Write test for Tailoring Run mobile interactions**
  - Verify proposals render in stacked unified diff view on small viewports.
  - Verify alignment ratings (backed, transferable, gap) have 44px touch targets.
  - Verify approval and continuation buttons remain accessible via a sticky bottom ledge.

- [x] **Step 2: Sticky Stepper Navigation & Action Ledge**
  - Ensure the mobile pane tablist (`[Steps | Current Step | Context]`) is sticky (`sticky top-16 z-20 bg-[#fbfbfb] dark:bg-[#0c0f17] py-2`).
  - Anchor the step footer (`Re-run`, `Approve & Continue`) to a sticky bottom ledge on mobile with safe-area padding:
    `sticky bottom-0 bg-white/95 dark:bg-[#121622]/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 p-3 pb-safe z-30`.

- [x] **Step 3: Proposals Word Diff Stacked Mode (`ProposalsStep.tsx`)**
  - Detect mobile viewport or use CSS media queries to stack "Current Ledger Bullet" and "Proposed Tailored Bullet" vertically rather than side-by-side.
  - Ensure word-level diff highlight tokens wrap cleanly without horizontal blowout.

- [x] **Step 4: Alignment & Analysis Touch Polish (`AlignmentStep.tsx`, `AnalysisStep.tsx`)**
  - Alignment rating selector: Replace tiny radio buttons with large touch-friendly button chips (`Backed`, `Transferable`, `Gap`).
  - Evidence dropdown: Full-width select with 16px font to prevent mobile zoom.

- [x] **Step 5: Run tests to verify Task 5 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/tailoring-ui.test.tsx
  ```

---

## Task 6: Touch-First Modals & Dialogs (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/components/QuickCaptureModal.tsx`
- Modify: `packages/ui/src/components/PreFlightModal.tsx`
- Modify: `packages/ui/src/components/RubricImporterModal.tsx`
- Modify: `packages/ui/src/components/BragDocModal.tsx`
- Modify: `packages/ui/src/components/EvidenceDetailModal.tsx`
- Modify: `packages/ui/src/components/IntegrityModal.tsx`
- Test: `packages/ui/tests/mobile-modals.test.tsx`

- [x] **Step 1: Write test for mobile modal adaptations**
  - Test `QuickCaptureModal` metric rows wrap into stacked fields on mobile (`name` on line 1, `value` + `status` + `delete` on line 2).
  - Test modal containers adopt full-width bottom sheet layout on `< sm` viewports.
  - Test modal actions (Cancel, Save) remain sticky at the bottom.

- [x] **Step 2: Update `QuickCaptureModal.tsx` Form Layout**
  - Modal container: `className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:max-w-3xl max-h-[92dvh] rounded-t-2xl sm:rounded-2xl ..."`
  - Metric entries: Replace single-row `flex items-center gap-2` with a responsive grid:
    ```tsx
    <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
      <input type="text" placeholder="Metric Name (e.g. p99 latency)" className="w-full text-base sm:text-xs ..." />
      <div className="flex items-center gap-2">
        <input type="text" placeholder="Value (e.g. 12ms)" className="flex-1 text-base sm:text-xs ..." />
        <select className="text-base sm:text-xs ...">...</select>
        <button type="button" className="p-2 text-slate-400 hover:text-rose-400 min-h-[44px] min-w-[44px] flex items-center justify-center">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
    ```
  - Ticket references: Apply identical responsive stacking to type selector + ticket ID string + delete button.
  - Form inputs: Ensure `text-base sm:text-sm` font size on all text inputs to prevent iOS Safari auto-zooming.

- [x] **Step 3: Update `PreFlightModal.tsx` & `IntegrityModal.tsx`**
  - Convert to bottom sheet layout on mobile.
  - Issue list: Ensure dangling citation tags, metric warnings, and banned keyword alerts wrap cleanly with tap-friendly "Remediate" buttons.
  - Sticky footer: Keep "Redact & Download" and "Close" anchored at the bottom.

- [x] **Step 4: Update `RubricImporterModal.tsx` and `BragDocModal.tsx`**
  - Table paste textarea: Responsive sizing with minimum 16px font on mobile.
  - Brag doc export preview: Full-width copy buttons and markdown viewer with touch scroll.

- [x] **Step 5: Run tests to verify Task 6 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/mobile-modals.test.tsx
  ```

---

## Task 7: Rubric Gap Matrix & Settings Mobile Polish (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/views/RubricGapMatrix.tsx`
- Modify: `packages/ui/src/views/settings/SettingsView.tsx`
- Modify: `packages/ui/src/views/desk/PrivateBriefing.tsx`
- Modify: `packages/ui/src/views/desk/EvidenceStrengthener.tsx`
- Test: `packages/ui/tests/rubric-gaps.test.tsx`
- Test: `packages/ui/tests/settings-ui.test.tsx`

- [x] **Step 1: Write test for Rubric Gap Matrix and Settings mobile views**
  - Verify Rubric selector and Target Level pills wrap cleanly without horizontal clipping.
  - Verify Settings cards stack API keys, runner selectors, and test buttons with touch targets $\ge$ 44px.

- [x] **Step 2: Polish `RubricGapMatrix.tsx`**
  - Rubric selector bar: Stack rubric dropdown and target level pill buttons cleanly (`flex-col md:flex-row gap-3`).
  - Target Level pills: Allow horizontal scroll or wrap for levels (`L3`, `L4`, `L5`, `L6`, `L7`).
  - Level Coverage summary card: Compact progress bar and font sizing.
  - Competency accordion cards: Ensure mapped evidence pills, relevance tags, and gap indicators wrap smoothly.

- [x] **Step 3: Polish `PrivateBriefing.tsx` & `EvidenceStrengthener.tsx`**
  - Briefing lead card: Responsive typography (`text-xl sm:text-2xl`) and stacked action buttons.
  - Evidence Strengthener: On mobile, stack "Open Gaps Checklist" above the editing form; anchor "Save Changes" button to a sticky bottom ledge.

- [x] **Step 4: Polish `SettingsView.tsx`**
  - Model runner cards (`ClaudeCodeCard`, `AnthropicApiCard`, `CodexCard`, `OllamaCard`):
    - Stack radio buttons and inputs vertically on small screens.
    - Provide 44px tap targets for key toggles and test connection buttons.

- [x] **Step 5: Run tests to verify Task 7 passes**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- tests/rubric-gaps.test.tsx tests/settings-ui.test.tsx
  ```

---

## Task 8: End-to-End Verification, Responsive Testing & WCAG Audit

**Files:**
- Test: `packages/ui/tests/app-routes.test.tsx`
- Test: `packages/ui/tests/desk-e2e-slice.test.tsx`

- [x] **Step 1: Run comprehensive UI test suite across all viewports**
  ```bash
  npm test --prefix C:\Users\drewk\featherduster\packages\ui -- --run
  ```
  Ensure all 100+ tests pass with zero regressions.

- [x] **Step 2: Multi-Viewport Smoke Test Matrix**
  Verify core workflows at the following simulated viewport widths:
  1. **360px (Galaxy S8 / Fold):**
     - Bottom navigation bar visible and fully tappable.
     - Search expands and collapses cleanly.
     - Evidence cards fit within 360px with zero horizontal scrollbar.
     - Quick Capture modal opens as full bottom sheet; metric input rows wrap neatly.
  2. **390px (iPhone 14/15/16):**
     - Story Threads Node Map switches between Sources, Evidence, and Threads tabs.
     - Traceable Inspector opens as bottom drawer on node tap.
     - Resume Tailor 3-pane switcher moves between Job, Bullets, and Preview.
     - HTML Print layout renders scaled fit-to-width preview.
  3. **768px (iPad Portrait / Tablet):**
     - Smooth transition between mobile bottom navigation and desktop sidebar.
     - Modals transition between bottom sheet and centered dialog.
  4. **1280px (Desktop):**
     - Full persistent left sidebar, 12-column grid, and side-by-side canvases work without regression.

- [x] **Step 3: WCAG 2.1 AA Mobile Accessibility Verification**
  - Minimum touch targets ($\ge 44 \times 44\text{px}$) verified across all mobile buttons, tabs, and toggles.
  - Font sizes on all mobile form inputs verified at $\ge 16\text{px}$ (`text-base sm:text-sm`) to avoid unwanted iOS Safari zoom.
  - Safe-area insets (`pb-safe`) verified to prevent overlap with iOS home indicators.
  - Screen reader announcements verified for mobile tab changes (`aria-selected`, `role="tab"`).

- [x] **Step 4: Build Verification**
  ```bash
  npm run build --prefix C:\Users\drewk\featherduster\packages\ui
  ```
  Verify build succeeds and produces clean production bundles.
