import { TAILORING_STEPS, type TailoringStep } from '@featherduster/core';
import type { NavTab } from './components/Layout';

/** The manual canvas is a mode of the tailor tab, not a run slug. */
export const CANVAS_PATH = '/tailor/canvas';

/** Reserved `/tailor/*` segments that never name a run. */
const RESERVED_TAILOR_SEGMENTS = new Set(['canvas', 'drafts']);

const routeByTab: Record<NavTab, string> = {
  briefing: '/briefing',
  threads: '/threads',
  evidence: '/evidence',
  skills: '/skills',
  tailor: '/tailor',
  settings: '/settings',
  jobs: '/jobs',
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
  '/jobs': 'jobs',
};

/** Paths that moved when tailoring and exports merged into one tab. */
const legacyRoutes: Record<string, string> = {
  '/exports': CANVAS_PATH,
};

function normalize(pathname: string): string {
  const path = new URL(pathname, 'http://local').pathname;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
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
  if (normalized.startsWith('/jobs/')) return 'jobs';
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
  | { mode: 'run'; slug: string; step?: TailoringStep }
  | { mode: 'draft'; draftId: string }
  | { mode: 'unavailable' }
  | { mode: 'canvas' };

export function tailorViewForPath(pathname: string): TailorView {
  const normalized = normalize(pathname);
  const canonical = legacyRoutes[normalized] ?? normalized;
  if (canonical === CANVAS_PATH) return { mode: 'canvas' };
  if (canonical === '/tailor/drafts' || canonical.startsWith('/tailor/drafts/')) {
    const match = /^\/tailor\/drafts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(canonical);
    return match ? { mode: 'draft', draftId: match[1] } : { mode: 'unavailable' };
  }
  const slug = tailoringSlugForPath(canonical);
  const step = new URL(pathname, 'http://local').searchParams.get('step');
  return slug ? { mode: 'run', slug, ...(TAILORING_STEPS.includes(step as TailoringStep) ? { step: step as TailoringStep } : {}) } : { mode: 'list' };
}

export const jobSections = { posting: 'Posting', inputs: 'Inputs', fit: 'Fit', resume: 'Resume', cover_letter: 'Cover letter', interview_brief: 'Interview brief', answers: 'Answers', history: 'History' } as const;
export type JobSection = keyof typeof jobSections | 'proposals';
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function preparationBatchForPath(path: string): { batchId: string; section: 'review' | 'questions' } | null {
  const match = new RegExp(`^/jobs/preparation-batches/(${uuidPattern})/(review|questions)$`, 'i').exec(normalize(path));
  return match ? { batchId: match[1], section: match[2] as 'review' | 'questions' } : null;
}
export function jobsViewForPath(path: string): { id: string; section: JobSection } | null {
  const match = new RegExp(`^/jobs/(${uuidPattern})(?:/(posting|inputs|proposals|fit|resume|cover_letter|interview_brief|answers|history))?$`, 'i').exec(normalize(path));
  return match ? { id: match[1], section: (match[2] ?? 'posting').toLowerCase() as JobSection } : null;
}
export function jobDraftForPath(path: string): { jobId: string; draftId: string } | null {
  const match = new RegExp(`^/tailor/canvas/jobs/(${uuidPattern})/(${uuidPattern})$`, 'i').exec(normalize(path));
  return match ? { jobId: match[1], draftId: match[2] } : null;
}
