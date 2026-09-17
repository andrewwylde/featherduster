import type { NavTab } from './components/Layout';

const routeByTab: Record<NavTab, string> = {
  briefing: '/briefing',
  threads: '/threads',
  evidence: '/evidence',
  skills: '/skills',
  exports: '/exports',
  rubrics: '/skills',
  tailor: '/tailor',
};

const tabByRoute: Record<string, NavTab> = {
  '/': 'briefing',
  '/briefing': 'briefing',
  '/threads': 'threads',
  '/evidence': 'evidence',
  '/skills': 'skills',
  '/rubrics': 'skills',
  '/exports': 'exports',
  '/tailor': 'tailor',
};

export function pathForTab(tab: NavTab): string {
  return routeByTab[tab];
}

export function tabForPath(pathname: string): NavTab {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalized.startsWith('/tailor/')) return 'tailor';
  return tabByRoute[normalized] ?? 'briefing';
}

/** Run slug for `/tailor/<slug>` paths, else null. */
export function tailoringSlugForPath(pathname: string): string | null {
  const match = /^\/tailor\/([a-z0-9][a-z0-9-]{0,79})\/?$/.exec(pathname);
  return match ? match[1] : null;
}
