import type { ResumeSpec } from '../schemas/resume.js';

export const MIN_READABLE_FONT_SIZE_PT = 10;

/** Asserts that compiled LaTeX preserves readability thresholds (no dropping font sizes below readable limits like \small or 10pt). */
export function assertReadableLayout(latex: string): void {
  const unreadableCommands = [/\\tiny\b/, /\\scriptsize\b/, /\\footnotesize\b/];
  for (const pattern of unreadableCommands) {
    if (pattern.test(latex)) {
      throw new Error(`LaTeX layout drops below readability threshold: contains ${pattern.source}`);
    }
  }
  const docClassMatch = /\\documentclass(?:\[(.*?)\])?\{article\}/.exec(latex);
  if (docClassMatch && docClassMatch[1]) {
    const ptMatch = /(\d+)pt/.exec(docClassMatch[1]);
    if (ptMatch && Number(ptMatch[1]) < MIN_READABLE_FONT_SIZE_PT) {
      throw new Error(`Document font size ${ptMatch[1]}pt is below the ${MIN_READABLE_FONT_SIZE_PT}pt readability threshold`);
    }
  }
}

export interface ReorderAccomplishmentsOptions {
  experience_index: number;
  order: number[];
  total_bullets?: number;
}

export function reorderAccomplishments(
  experienceIndexOrOptions: number | ReorderAccomplishmentsOptions,
  orderOrBullets?: number[] | Array<{ text: string }>,
  totalBullets?: number,
): { id: string; type: 'bullet.reorder'; target: { experience_index: number }; order: number[]; decision: 'accepted' } {
  let experienceIndex: number;
  let order: number[];
  let total: number;

  if (typeof experienceIndexOrOptions === 'object') {
    experienceIndex = experienceIndexOrOptions.experience_index;
    order = [...experienceIndexOrOptions.order];
    total = experienceIndexOrOptions.total_bullets ?? order.length;
  } else {
    experienceIndex = experienceIndexOrOptions;
    if (Array.isArray(orderOrBullets)) {
      if (orderOrBullets.length > 0 && typeof orderOrBullets[0] === 'object') {
        order = Array.from({ length: orderOrBullets.length }, (_, i) => i);
        total = orderOrBullets.length;
      } else {
        order = [...(orderOrBullets as number[])];
        total = totalBullets ?? order.length;
      }
    } else {
      order = [];
      total = totalBullets ?? 0;
    }
  }

  const seen = new Set<number>();
  const validOrder: number[] = [];
  for (const idx of order) {
    if (idx >= 0 && idx < total && !seen.has(idx)) {
      seen.add(idx);
      validOrder.push(idx);
    }
  }
  for (let i = 0; i < total; i++) {
    if (!seen.has(i)) {
      validOrder.push(i);
    }
  }

  return {
    id: `reorder-exp-${experienceIndex}`,
    type: 'bullet.reorder',
    target: { experience_index: experienceIndex },
    order: validOrder,
    decision: 'accepted',
  };
}

/** Uses the installed, code-reviewed preamble; every public value passes the caller's privacy and escaping checks. */
export function compileCareerLayout(preamble: string, s: ResumeSpec, leaf: (value?: string, mode?: 'smallcaps' | 'target') => string): string {
  const e = (value: string | undefined) => leaf(value);
  const lines = [preamble, '\\begin{document}', '\\begin{center}',
    '\\textbf{\\Huge \\scshape ' + leaf(s.profile.name, 'smallcaps') + '} \\\\ \\vspace{1pt}',
    [s.profile.phone, s.profile.email, s.profile.location?.replace(/, US$/, '')].filter(Boolean).map(e).join(' $|$ ') + ' \\\\',
    Object.entries(s.profile.links ?? {}).sort(([a], [b]) => (a === 'linkedin' ? -1 : b === 'linkedin' ? 1 : a.localeCompare(b))).map(([, url]) => {
      if (!url) return '';
      const label = e(url.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
      return /^https?:\/\//i.test(url) ? '\\href{' + leaf(url, 'target') + '}{' + label + '}' : label;
    }).filter(Boolean).join(' $|$ '),
    '\\end{center}', '\\section{Professional Summary}', '\\begin{itemize}[label={}]',
    '\\small{\\item{' + e(s.summary) + '}}', '\\end{itemize}',
    '\\section{Work Experience}', '\\resumeSubHeadingListStart'];
  for (const x of s.experiences) {
    lines.push('\\resumeSubheading{' + e(x.role) + '}{' + e(displayDate(x.startDate)) + ' -- ' + e(displayDate(x.endDate)) + '}{' + e(x.company) + '}{' + e(x.location) + '}',
      '\\resumeItemListStart', ...x.bullets.map(b => '\\resumeItem{' + e(b.text) + '}'), '\\resumeItemListEnd');
  }
  lines.push('\\resumeSubHeadingListEnd', '\\section{Technical Skills}', '\\begin{itemize}[leftmargin=0.15in,label={}]',
    '\\small{\\item{' + s.skills.map(g => '\\textbf{' + e(g.category) + '}{: ' + g.skills.map(e).join(', ') + '}').join(' \\\\ \n') + '}}',
    '\\end{itemize}', '\\section{Education}', '\\resumeSubHeadingListStart');
  for (const x of s.education) lines.push('\\resumeSubheading{' + e(x.institution) + '}{}{' + e(x.degree) + '}{' + e(String(x.year)) + '}', ...(x.details ? ['{\\small ' + e(x.details) + '}'] : []));
  lines.push('\\resumeSubHeadingListEnd', '\\end{document}');
  const compiled = lines.join('\n');
  assertReadableLayout(compiled);
  return compiled;
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return value;
  const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  return months[Number(match[2]) - 1] + ' ' + match[1];
}
