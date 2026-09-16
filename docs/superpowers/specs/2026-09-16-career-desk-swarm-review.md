# Featherduster Career Intelligence Desk: Swarm Review Synthesis

**Review Date:** September 16, 2026  
**Review Team:** Multi-Agent Swarm (UX & Interaction Architecture, Visual Design & Design Systems, Accessibility & WCAG 2.1 AA)  
**Target:** Featherduster Career Intelligence Desk Vertical Slice (`packages/ui`)  
**Status:** COMPLETE — 15 Identified Items (6 Blockers, 6 Improvements, 3 Follow-ups)

---

## 1. Executive Summary & Review Scorecard

A coordinated 3-agent swarm review was conducted on the implementation of the Featherduster Career Intelligence Desk. The swarm evaluated the core loop (Briefing $\rightarrow$ Interview $\rightarrow$ Live Dossier $\rightarrow$ Evidence Capture $\rightarrow$ Story Thread Strengthening), visual craft, materiality, token consistency, and WCAG 2.1 AA accessibility.

| Lens | Auditor Role | Grade | Core Finding |
| :--- | :--- | :---: | :--- |
| **UX & Interaction** | UX & Interaction Architecture | **B+** | Core loop is compelling and intuitive, but tab switching destroys active interview drafts; onboarding paths are partially unwired; source links hijacked interviews. |
| **Visual Design** | Design Systems Specialist | **A-** | High-fidelity editorial tone and typography; zero em dashes in copy; minor token drift with rose vs vermilion and an uncalibrated glowing card shadow. |
| **Accessibility** | WCAG 2.1 AA Specialist | **C+ (FAIL)** | Clear failures in keyboard navigation (un-tabbable node map preview card), missing modal focus trap, invisible focus rings, and contrast violations with `slate-400`/`slate-500`. |

---

## 2. Prioritized Issues Matrix

| ID | Lens | Severity | Component / Area | Description | Effort |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **BLK-01** | UX | **Blocker** | `App.tsx` / `FocusedInterview` | Tab navigation clears `isInterviewActive(false)`, causing draft transcript and live dossier data loss. | Low (1h) |
| **BLK-02** | A11y / UX | **Blocker** | `OnboardingModal.tsx` | Missing focus trap, focus restoration, backdrop dismiss, and first-run localStorage check. | Low (30m) |
| **BLK-03** | A11y | **Blocker** | `PrivateBriefing.tsx` | Mini node map thread card is a non-semantic `<div>` unreachable via keyboard. | Low (15m) |
| **BLK-04** | A11y | **Blocker** | `StoryThreadsNodeMap.tsx` | Node items use `focus:outline-none` with no visible focus ring and no `aria-pressed` selection state. | Low (45m) |
| **BLK-05** | A11y | **Blocker** | Design Tokens / Colors | `slate-400` in light mode (2.56:1) and `slate-500` in dark mode (3.81:1) fail WCAG AA contrast. | Med (1h) |
| **BLK-06** | Design | **Blocker** | `tokens.ts` & HTML title | `missing_proof` uses rose palette (pink clash) instead of vermilion; em dash character in `index.html`. | Low (15m) |
| **IMP-01** | UX | **Improvement** | `StoryThreadsNodeMap.tsx` | Cross-column relational illumination: selecting a thread should highlight its contributing sources and evidence. | Med (1.5h) |
| **IMP-02** | UX | **Improvement** | `PrivateBriefing.tsx` | "View source" links hijack interview flow instead of inspecting source or opening external links. | Low (30m) |
| **IMP-03** | A11y | **Improvement** | `index.css` | Missing global `@media (prefers-reduced-motion: reduce)` accessibility override. | Low (15m) |
| **IMP-04** | A11y / UX | **Improvement** | `FocusedInterview.tsx` | Transcript lacks `role="log" aria-live="polite"`; capture button needs idempotent state after submission. | Low (45m) |
| **IMP-05** | Design | **Improvement** | `StoryThreadsNodeMap.tsx` | Remove neon glow `shadow-lg shadow-vermilion-500/25` on active thread card; enforce `rounded-desk`. | Low (20m) |
| **IMP-06** | A11y | **Improvement** | `DeskHeader.tsx` | Search input missing `aria-label`; replace glassmorphism blur with opaque desk header ledge. | Low (20m) |
| **FOL-01** | UX | **Follow-up** | `FocusedInterview.tsx` | Inline editable fields for Live Dossier claims (Situation, Action, Outcome) for immediate user agency. | Med (2h) |
| **FOL-02** | A11y | **Follow-up** | `Layout.tsx` | Global skip link (`Skip to main content`) and live announcer region for theme / integrity updates. | Med (1.5h) |
| **FOL-03** | Design | **Follow-up** | Design Tokens | Complete replacement of raw hex codes in view classes with semantic `desk.*` Tailwind classes. | Low (1h) |

---

## 3. Detailed Lens Reports

### Lens 1: UX & Interaction Architecture
1. **Draft Persistence (BLK-01)**: When users are in the middle of a focused interview with The Editor and click "Threads" or "Evidence" to inspect supporting context, returning to "Briefing" resets `isInterviewActive` to `false`, discarding the interview transcript and draft dossier. Draft state should be stored in parent state or `localStorage` so users never lose conversational work.
2. **Onboarding Integration (BLK-02)**: The modal was not wiring `onSelectPath`, and the initial check `localStorage.getItem('featherduster_onboarding_dismissed')` was omitted, requiring manual triggers rather than gentle first-run guidance.
3. **External Link Semantics (IMP-02)**: "View source" in briefing cards executed `onOpenInterview()` with `e.preventDefault()`, which conflates inspecting a signal source with starting a conversation. It should open external references or reveal details.
4. **Relational Illumination (IMP-01)**: The 3-column node map is clear, but when a Story Thread is clicked, the specific contributing Evidence cards in Column 2 and Signal Sources in Column 1 should visually illuminate to show the full provenance chain.

### Lens 2: Visual Design & Design Systems
1. **Palette Harmony & The Rose Drift (BLK-06)**: `tokens.ts` defined `missing_proof` using `bg-rose-50 border-rose-200` and `dark:bg-rose-950/50 dark:border-rose-900/60`. This introduced a magenta/pink tint that clashes with the strict vermilion accent (`#d93829`). The vermilion scale (`vermilion-50`, `vermilion-100`, `vermilion-950`) should be used instead.
2. **Anti-Slop Cleanliness (IMP-05)**: The active `Reliability leadership` card in `StoryThreadsNodeMap.tsx` had `shadow-lg shadow-vermilion-500/25` and a solid vermilion background, which feels like a glowing SaaS card. It should use quiet fine rules, calm borders, and subtle tonal tinting.
3. **Typography & Orthography**: Zero visible em dashes (`—`) in product copy was respected across all view components, but `packages/ui/index.html` retained an em dash in `<title>Featherduster — Local-First Career Intelligence</title>`, which must be replaced with a colon `:`.

### Lens 3: Accessibility & WCAG 2.1 AA
1. **Keyboard Operability (BLK-03, BLK-04)**: The Story Thread card in `PrivateBriefing.tsx` was a `div` with `onClick`, making it inaccessible to keyboard users. Node map items lacked focus rings when not active and lacked `aria-pressed` states.
2. **Color Contrast (BLK-05)**:
   - Light mode `text-slate-400` on white provides only **2.56:1** contrast (fails WCAG AA 4.5:1). Replaced with `text-slate-600` (**7.56:1**).
   - Dark mode `dark:text-slate-500` provides only **3.81:1** contrast. Replaced with `dark:text-slate-400` (**7.08:1**).
   - Low-contrast text on vermilion (`text-white/70` at 10px gives **2.96:1**). Replaced with solid white text or darker vermilion container.
3. **Dialog Focus Management (BLK-02)**: `OnboardingModal.tsx` lacked focus trapping and initial focus. It should adopt the project's existing `useModalA11y` hook.
4. **Motion Preference (IMP-03)**: Added `@media (prefers-reduced-motion: reduce)` in `index.css` to respect user accessibility preferences.

---

## 4. Remediation Plan

All blockers and high-leverage improvements are straightforward to implement without architectural refactors:
1. **Tokens & Theme**: Update `tokens.ts` for `missing_proof` to use vermilion hues; fix `index.html` title; add reduced motion in `index.css`.
2. **A11y & Contrast**: Update `text-slate-400` to `text-slate-600` (light) and `dark:text-slate-500` to `dark:text-slate-400` (dark); add focus rings and `aria-pressed` in `StoryThreadsNodeMap.tsx`; convert briefing card to `<button>`.
3. **Dialog & Navigation**: Wire `useModalA11y` into `OnboardingModal.tsx`; preserve interview state across tabs in `App.tsx`.
4. **Interaction Polish**: Add cross-column relational illumination in `StoryThreadsNodeMap.tsx`; ensure capture button enters an idempotent disabled state after capture.
5. **Verification**: Run `npm test` across the full test suite and confirm all 263+ tests pass.
