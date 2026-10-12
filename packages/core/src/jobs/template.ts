import { z } from 'zod';
import type { ResumeSpec } from '../schemas/resume.js';
import type { PrivacyRulesConfig } from '../schemas/privacy.js';
import { redactText } from '../integrity/redaction-engine.js';
import { escapeLatex } from '../compilers/latex-compiler.js';

const slots = ['profile', 'summary', 'experiences', 'education', 'skills'] as const;
/** These templates are executable code: validation does not establish trust. */
export const LatexTemplateProfileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  format: z.literal('latex'),
  preamble: z.string().min(1),
  body: z.string(),
  page_budget: z.number().int().positive().default(1),
}).strict().superRefine((p, ctx) => {
  const found = [...p.body.matchAll(/\{\{([^{}]*)\}\}/g)].map(m => m[1]);
  if (found.length !== slots.length || slots.some(s => found.filter(x => x === s).length !== 1) || /\{\{|\}\}/.test(p.body.replace(/\{\{([^{}]*)\}\}/g, ''))) {
    ctx.addIssue({ code: 'custom', message: 'Body must contain each supported slot exactly once' });
  }
  if (/\\(?:begin|end)\s*\{document\}/.test(p.preamble + p.body) || /\{\{/.test(p.preamble)) {
    ctx.addIssue({ code: 'custom', message: 'Document delimiters and preamble slots are not allowed' });
  }
});
export type LatexTemplateProfile = z.infer<typeof LatexTemplateProfileSchema>;

export function compileTemplateResume(template: LatexTemplateProfile, spec: ResumeSpec, rules?: PrivacyRulesConfig) {
  const profile = LatexTemplateProfileSchema.parse(template);
  const expectedText: string[] = [];
  const leaf = (value?: string) => {
    if (!value) return '';
    const normalized = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
    const result = redactText(normalized, rules ?? { strip_patterns: [], replacements: [], banned_keywords: [] });
    if (!result.isClean) throw new Error('Resume contains unresolved privacy violations');
    const text = result.redactedText.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) expectedText.push(text);
    return escapeLatex(text);
  };
  const line = (values: (string | undefined)[]) => values.map(leaf).filter(Boolean).join(' \\textbar{} ');
  const section = (title: string, body: string) => body ? `\\section*{${title}}\n${body}` : '';
  const parts: Record<typeof slots[number], string> = {
    profile: line([spec.profile.name, spec.profile.title, spec.profile.email, spec.profile.phone, spec.profile.location, ...Object.values(spec.profile.links ?? {})]),
    summary: section('Summary', leaf(spec.summary)),
    experiences: section('Experience', spec.experiences.map(e => {
      const header = line([e.role, e.company, e.location, e.startDate, e.endDate]);
      const bullets = e.bullets.map(b => leaf(b.text)).filter(Boolean);
      return header + (bullets.length ? `\n\\begin{itemize}\n${bullets.map(b => `\\item ${b}`).join('\n')}\n\\end{itemize}` : '\\par');
    }).join('\n')),
    education: section('Education', spec.education.map(e => line([e.degree, e.institution, String(e.year), e.details])).filter(Boolean).join('\\par\n')),
    skills: section('Skills', spec.skills.map(g => line([g.category, ...g.skills])).filter(Boolean).join('\\par\n')),
  };
  if (!expectedText.length) throw new Error('Resume has no public text');
  return {
    source: `${profile.preamble}\n\\begin{document}\n${profile.body.replace(/\{\{([^{}]*)\}\}/g, (_, key: typeof slots[number]) => parts[key])}\n\\end{document}\n`,
    expectedText,
  };
}
