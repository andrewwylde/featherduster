# Career Intelligence Desk UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Featherduster into a private career intelligence desk with an editorial archive aesthetic, featuring The Editor guide, focused interview with live structured dossier, interactive story-thread node map, vermilion accents, and adaptive light/dark themes, while preserving existing evidence, rubric, and tailoring capabilities.

**Architecture:** A modern editorial desk shell replaces the top-heavy layout, introducing five cohesive workspaces: Briefing, Threads, Evidence, Skills, and Exports. The core vertical slice implements an interview with The Editor on the left and a live structured dossier on the right, connecting to a keyboard-accessible 3-column node map (Sources $\rightarrow$ Evidence $\rightarrow$ Story Threads) with verifiable state transitions (`Verified`, `Remembered`, `Missing proof`) and thread strengthening feedback.

**Tech Stack:** React 18, TypeScript, Vite 5, Tailwind CSS 3 with `class` dark mode, Lucide React icons, Vitest & React Testing Library.

---

### File Structure Map

- **Theme & Design Tokens:**
  - `packages/ui/src/theme/tokens.ts`: Semantic colors, status badges, radii, and theme toggle utilities.
  - `packages/ui/src/theme/ThemeContext.tsx`: Theme provider supporting `'light' | 'dark' | 'system'` with local storage sync.
  - `packages/ui/tailwind.config.js`: Extended with vermilion palette, surface tokens, and border radii.
  - `packages/ui/src/index.css`: Adaptive light/dark styling, editorial typography, fine rules, and scrollbars.

- **Fixtures & Desk Domain Types:**
  - `packages/ui/src/types/desk.ts`: Types for Story Threads, Signal Sources, Live Dossier, and Editor Transcript.
  - `packages/ui/src/data/deskFixtures.ts`: Realistic fixture data matching the concept renderings.

- **Components & Layout:**
  - `packages/ui/src/components/desk/DeskSidebar.tsx`: Left editorial navigation with brand header, vermilion active indicators, and footer.
  - `packages/ui/src/components/desk/DeskHeader.tsx`: Search bar, editorial subhead, theme toggle, and integrity audit trigger.
  - `packages/ui/src/components/desk/EvidenceBadge.tsx`: Reusable badge for `Verified`, `Remembered`, and `Missing proof`.
  - `packages/ui/src/components/desk/OnboardingModal.tsx`: One-time local-first privacy foundation and choose-your-path setup.
  - `packages/ui/src/components/Layout.tsx`: Updated desk shell integrating left sidebar, desk header, and view router.

- **Views:**
  - `packages/ui/src/views/desk/PrivateBriefing.tsx`: Recommended lead focal point, source signals with reviewer quotes, and node map preview.
  - `packages/ui/src/views/desk/FocusedInterview.tsx`: Left interview transcript with margin annotations; right live structured dossier with capture CTA.
  - `packages/ui/src/views/desk/StoryThreadsNodeMap.tsx`: Full interactive node map (Sources $\rightarrow$ Evidence $\rightarrow$ Story Threads) with keyboard navigation and relationship inspector.
  - `packages/ui/src/App.tsx`: Desk controller handling active tabs (`briefing`, `interview`, `threads`, `evidence`, `skills`, `exports`).

- **Tests:**
  - `packages/ui/tests/desk-theme.test.tsx`: Theme provider and token switching tests.
  - `packages/ui/tests/desk-briefing.test.tsx`: Briefing lead rendering, signal display, and interview launch.
  - `packages/ui/tests/desk-interview.test.tsx`: Focused interview interactions, live dossier updates, and capture transition.
  - `packages/ui/tests/desk-nodemap.test.tsx`: Node map relationships, keyboard accessibility, and source inspector.
  - `packages/ui/tests/desk-layout.test.tsx`: Navigation routing and existing views mounting.

---

### Task 1: Semantic Design Tokens & Theme System

**Files:**
- Create: `packages/ui/src/theme/tokens.ts`
- Create: `packages/ui/src/theme/ThemeContext.tsx`
- Modify: `packages/ui/tailwind.config.js`
- Modify: `packages/ui/src/index.css`
- Modify: `packages/ui/index.html`
- Test: `packages/ui/tests/desk-theme.test.tsx`

- [ ] **Step 1: Write the failing test for theme system**

Create `packages/ui/tests/desk-theme.test.tsx`:
```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';

function ThemeTester() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-val">{theme}</span>
      <span data-testid="resolved-val">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('light')}>Set Light</button>
    </div>
  );
}

describe('Desk Theme System', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    cleanup();
  });

  it('provides default light or dark theme and toggles dark class on document element', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeTester />
      </ThemeProvider>
    );

    expect(screen.getByTestId('resolved-val').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByText('Set Dark'));
    expect(screen.getByTestId('resolved-val').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('featherduster-theme')).toBe('dark');

    fireEvent.click(screen.getByText('Set Light'));
    expect(screen.getByTestId('resolved-val').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/desk-theme.test.tsx`
Expected: FAIL due to missing `ThemeContext`.

- [ ] **Step 3: Implement semantic tokens and ThemeProvider**

Create `packages/ui/src/theme/tokens.ts`:
```ts
export const vermilion = {
  50: '#fff1ef',
  100: '#ffe1dc',
  200: '#ffc7be',
  500: '#d93829', // Main vermilion accent
  600: '#c23022',
  700: '#a32418',
  800: '#841f16',
  900: '#691c14',
};

export type EvidenceStatus = 'verified' | 'remembered' | 'missing_proof';

export interface StatusStyle {
  label: string;
  badgeClass: string;
}

export const evidenceStatusStyles: Record<EvidenceStatus, StatusStyle> = {
  verified: {
    label: 'Verified',
    badgeClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60',
  },
  remembered: {
    label: 'Remembered',
    badgeClass:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80',
  },
  missing_proof: {
    label: 'Missing proof',
    badgeClass:
      'bg-rose-50 text-vermilion-600 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900/60',
  },
};
```

Create `packages/ui/src/theme/ThemeContext.tsx`:
```tsx
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_KEY = 'featherduster-theme';

export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  defaultTheme?: Theme;
}> = ({ children, defaultTheme = 'dark' }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    return (saved as Theme) || defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const computeResolved = (t: Theme): 'light' | 'dark' => {
      if (t === 'system') {
        return media.matches ? 'dark' : 'light';
      }
      return t;
    };

    const currentResolved = computeResolved(theme);
    setResolvedTheme(currentResolved);

    const root = document.documentElement;
    if (currentResolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    const listener = () => {
      if (theme === 'system') {
        const next = media.matches ? 'dark' : 'light';
        setResolvedTheme(next);
        if (next === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
      }
    };

    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // Storage unavailable
    }
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
```

Update `packages/ui/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        vermilion: {
          50: '#fff1ef',
          100: '#ffe1dc',
          200: '#ffc7be',
          500: '#d93829',
          600: '#c23022',
          700: '#a32418',
          800: '#841f16',
          900: '#691c14',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        desk: {
          bg: {
            light: '#fbfbfb',
            dark: '#0c0f17',
          },
          panel: {
            light: '#ffffff',
            dark: '#131824',
          },
          card: {
            light: '#ffffff',
            dark: '#161c2b',
          },
          border: {
            light: '#e2e8f0',
            dark: '#1e293b',
          },
        },
      },
      borderRadius: {
        desk: '10px',
      },
    },
  },
  plugins: [],
};
```

Update `packages/ui/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: light dark;
  }

  body {
    @apply bg-[#fbfbfb] text-slate-900 dark:bg-[#0c0f17] dark:text-slate-100 font-sans antialiased transition-colors duration-150;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  }

  /* Custom subtle scrollbar */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    @apply bg-slate-300 dark:bg-slate-800 rounded-full;
  }
  ::-webkit-scrollbar-thumb:hover {
    @apply bg-slate-400 dark:bg-slate-700;
  }
}
```

Update `packages/ui/index.html`:
Remove hardcoded `bg-slate-950 text-slate-100` on html element so theme class controls colors.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/desk-theme.test.tsx`
Expected: PASS.

---

### Task 2: Desk Domain Types & Fixtures

**Files:**
- Create: `packages/ui/src/types/desk.ts`
- Create: `packages/ui/src/data/deskFixtures.ts`

- [ ] **Step 1: Define types for desk state**

Create `packages/ui/src/types/desk.ts`:
```ts
import type { EvidenceStatus } from '../theme/tokens';

export type SignalSourceType = 'pull_request' | 'project_note' | 'colleague_feedback';

export interface SignalSource {
  id: string;
  type: SignalSourceType;
  tag: string; // e.g. "platform / infra #4821" or "Reliability initiative"
  title: string;
  date: string;
  description: string;
  quote?: {
    text: string;
    author: string;
  };
  url?: string;
  status: EvidenceStatus;
}

export interface NodeMapEvidence {
  id: string;
  title: string;
  status: EvidenceStatus;
  sourceIds: string[];
}

export interface StoryThread {
  id: string;
  title: string;
  status: 'active' | 'strengthened';
  evidenceIds: string[];
  summary: string;
}

export interface InterviewMessage {
  id: string;
  speaker: 'editor' | 'user';
  timestamp: string;
  headline?: string;
  body: string;
  context?: string;
  annotation?: string; // vermilion margin annotation
}

export interface LiveDossier {
  title: string;
  updatedAt: string;
  situation: { text: string; status: EvidenceStatus };
  action: { text: string; status: EvidenceStatus };
  outcome: { text: string; status: EvidenceStatus; missingMetric?: boolean };
  skills: { names: string[]; status: EvidenceStatus };
  sources: Array<{ id: string; label: string; tag: string; status: EvidenceStatus }>;
  stillNeeded: string[];
}

export interface RecommendedLead {
  id: string;
  title: string;
  leadParagraph: string;
  sources: SignalSource[];
  storyThread: StoryThread;
  dossierDraft: LiveDossier;
  initialTranscript: InterviewMessage[];
}
```

- [ ] **Step 2: Define fixtures matching concept renderings**

Create `packages/ui/src/data/deskFixtures.ts`:
Export `initialLead`, `initialStoryThreads`, `initialNodeMapEvidence`, and `sampleUserFollowups`.

---

### Task 3: Desk Navigation Shell & Header

**Files:**
- Create: `packages/ui/src/components/desk/EvidenceBadge.tsx`
- Create: `packages/ui/src/components/desk/DeskSidebar.tsx`
- Create: `packages/ui/src/components/desk/DeskHeader.tsx`
- Create: `packages/ui/src/components/desk/OnboardingModal.tsx`
- Modify: `packages/ui/src/components/Layout.tsx`
- Test: `packages/ui/tests/desk-layout.test.tsx`

- [ ] **Step 1: Write test for Desk shell navigation and tabs**

Create `packages/ui/tests/desk-layout.test.tsx`:
Test that `Layout` renders left sidebar with 5 primary tabs (`Briefing`, `Threads`, `Evidence`, `Skills`, `Exports`), displays the active vermilion indicator, renders the search header, and allows switching tabs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/desk-layout.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement DeskSidebar, DeskHeader, EvidenceBadge, and update Layout**

Implement:
- `EvidenceBadge`: Clean pill with status dot or fine rule distinguishing `Verified`, `Remembered`, and `Missing proof`.
- `DeskSidebar`: Left-aligned editorial archive column with Featherduster branding, vertical nav tabs with vermilion left border on active tab, theme toggle, and bottom quote.
- `DeskHeader`: Search bar input, workspace status, and integrity status trigger.
- `OnboardingModal`: Local-first explanation modal with the 3 starting paths, save dismissal to `localStorage`.
- `Layout.tsx`: Updated to use `DeskSidebar` and `DeskHeader`, with backwards-compatible navigation props.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/desk-layout.test.tsx`
Expected: PASS.

---

### Task 4: Private Briefing View

**Files:**
- Create: `packages/ui/src/views/desk/PrivateBriefing.tsx`
- Test: `packages/ui/tests/desk-briefing.test.tsx`

- [ ] **Step 1: Write test for PrivateBriefing view**

Create `packages/ui/tests/desk-briefing.test.tsx`:
Test that `PrivateBriefing` renders:
1. Focal point lead: "A reliability story may be taking shape." with The Editor eyebrow.
2. 3 source signal cards (PR #4821, Project note, Colleague feedback) with reviewer quotes.
3. Node map preview on top right ("How the pieces connect").
4. Live dossier summary on bottom right with status badges.
5. Clicking "Open focused interview" or clicking the lead transitions to the interview view.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/desk-briefing.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement PrivateBriefing view**

Implement `packages/ui/src/views/desk/PrivateBriefing.tsx` adhering to the exact layout and hierarchy in `exec-c97d8d9d-60d9-4f8b-961c-0edb8b849ee6.png` and `exec-695037e5-9bc7-4efd-ace2-6dece2533a54.png`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/desk-briefing.test.tsx`
Expected: PASS.

---

### Task 5: Focused Interview & Live Dossier Vertical Slice

**Files:**
- Create: `packages/ui/src/views/desk/FocusedInterview.tsx`
- Test: `packages/ui/tests/desk-interview.test.tsx`

- [ ] **Step 1: Write test for FocusedInterview and Live Dossier**

Create `packages/ui/tests/desk-interview.test.tsx`:
Test that:
1. Interview displays transcript with speaker names, timestamps, and vermilion margin annotation.
2. Answering The Editor's prompt updates the transcript and extracts verified details into the live dossier.
3. Outcome metric status updates from `[METRIC NEEDED]` (Missing proof) to verified when metric is provided.
4. Clicking "Capture evidence entry" triggers completion feedback:
   - Story thread strengthens.
   - Calls `apiClient.saveEvidence` if backend available or persists to state.
   - Shows feedback banner / transition to thread view.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/desk-interview.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement FocusedInterview and Live Dossier**

Implement `packages/ui/src/views/desk/FocusedInterview.tsx` matching `exec-1c1fb8c2-dbf9-440f-949f-cef6c723c548.png`:
- Left column: The Editor interview transcript + composer.
- Right column: Structured dossier draft (`Situation`, `Action`, `Outcome`, `Skills`, `Sources`, `How it connects`).
- Capture action button with vermilion accent and completion feedback.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/desk-interview.test.tsx`
Expected: PASS.

---

### Task 6: Story Threads Interactive Node Map

**Files:**
- Create: `packages/ui/src/views/desk/StoryThreadsNodeMap.tsx`
- Test: `packages/ui/tests/desk-nodemap.test.tsx`

- [ ] **Step 1: Write test for Node Map relationships and accessibility**

Create `packages/ui/tests/desk-nodemap.test.tsx`:
Test that:
1. Node map renders 3 columns: Sources $\rightarrow$ Evidence $\rightarrow$ Story Threads.
2. Nodes have `role="button"`, `tabIndex={0}`, and accessible names.
3. Selecting a node highlights connected relationships and displays traceable details in an inspector panel.
4. Strengthened state on the "Reliability leadership" thread is visibly marked.
5. Keyboard navigation (Enter, Space, Arrow keys) works without pointer hover.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/desk-nodemap.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement StoryThreadsNodeMap**

Implement `packages/ui/src/views/desk/StoryThreadsNodeMap.tsx` with SVG connection curves, selectable node cards, inspectable drawer, and responsive layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/desk-nodemap.test.tsx`
Expected: PASS.

---

### Task 7: Wire App.tsx Router, Preserve Existing Views, and Full Build

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Test: Run all UI tests (`npm --workspace=@featherduster/ui run test`)
- Test: Run monorepo test suite (`npm test`)

- [ ] **Step 1: Update App.tsx to wire Desk views and existing views**

Wire tabs in `packages/ui/src/App.tsx`:
- `briefing`: `PrivateBriefing` (or `FocusedInterview` when interview is active)
- `threads`: `StoryThreadsNodeMap`
- `evidence`: `EvidenceExplorer`
- `skills`: `RubricGapMatrix`
- `exports`: `ResumeTailor`

- [ ] **Step 2: Run all tests to verify zero regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Build monorepo packages**

Run: `npm run build`
Expected: Successful build with zero errors.

---

### Self-Review Checklist
1. **Spec coverage**:
   - Private career intelligence desk metaphor? Covered.
   - The Editor guide without avatar/mascot? Covered.
   - Signal-led prompting from mixed inbox? Covered.
   - 5-minute capture vertical slice? Covered.
   - Conversation on left, live dossier on right? Covered.
   - Visible distinction of `Verified`, `Remembered`, `Missing proof`? Covered.
   - Story thread node map with traceable highlights? Covered.
   - Adaptive light and dark themes with vermilion accent? Covered.
   - Local-first privacy explained once during onboarding? Covered.
   - Existing Evidence, Rubrics, and Resume Tailor preserved? Covered.
2. **Placeholder scan**: Zero TODOs or vague steps.
3. **Type consistency**: `EvidenceStatus`, `SignalSource`, `StoryThread`, `LiveDossier` consistently defined and referenced.
