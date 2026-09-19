import type { NavTab } from './components/Layout';

/** The manual canvas is a mode of the tailor tab, not a run slug. */
export const CANVAS_PATH = '/tailor/canvas';

/** Reserved `/tailor/*` segments that never name a run. */
const RESERVED_TAILOR_SEGMENTS = new Set(['canvas']);

const routeByTab: Record<NavTab, string> = {
  briefing: '/briefing',
  threads: '/threads',
  evidence: '/evidence',
  skills: '/skills',
  tailor: '/tailor',
  settings: '/settings',
};

const tabByRoute: Record<string, NavTab> = {
  '/': 'briefing',
  '/briefing': 'briefing',
  '/threads': 'threads',
  '/evidence': 'evidence',
  '/skills': 'skills',
  '/rubrics': 'skills',
  '/tailor': 'tailor',
  '/settings': 'settings',
};

/** Paths that moved when tailoring and exports merged into one tab. */
const legacyRoutes: Record<string, string> = {
  '/exports': CANVAS_PATH,
};

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** Canonical path for a legacy URL, or null when the path is already current. */
export function redirectForPath(pathname: string): string | null {
  return legacyRoutes[normalize(pathname)] ?? null;
}

export function pathForTab(tab: NavTab): string {
  return routeByTab[tab];
}

export function tabForPath(pathname: string): NavTab {
  const normalized = normalize(pathname);
  if (legacyRoutes[normalized]) return tabForPath(legacyRoutes[normalized]);
  if (normalized.startsWith('/tailor/')) return 'tailor';
  return tabByRoute[normalized] ?? 'briefing';
}

/** Run slug for `/tailor/<slug>` paths, else null. */
export function tailoringSlugForPath(pathname: string): string | null {
  const match = /^\/tailor\/([a-z0-9][a-z0-9-]{0,79})\/?$/.exec(pathname);
  if (!match) return null;
  return RESERVED_TAILOR_SEGMENTS.has(match[1]) ? null : match[1];
}

/** Which of the tailor tab's three modes a path selects. */
export type TailorView =
  | { mode: 'list' }
  | { mode: 'run'; slug: string }
  | { mode: 'canvas' };

export function tailorViewForPath(pathname: string): TailorView {
  const normalized = normalize(pathname);
  const canonical = legacyRoutes[normalized] ?? normalized;
  if (canonical === CANVAS_PATH) return { mode: 'canvas' };
  const slug = tailoringSlugForPath(canonical);
  return slug ? { mode: 'run', slug } : { mode: 'list' };
}
