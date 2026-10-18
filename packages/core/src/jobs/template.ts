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
  const join = (values: (string | undefined)[], sep: string) => values.map(leaf).filter(Boolean).join(sep);
  const section = (title: string, body: string) => body ? `\\section*{${title}}\n${body}` : '';
  const list = (items: string[]) => items.length ? `\\begin{itemize}[leftmargin=0.18in,noitemsep,topsep=2pt]\n${items.map(b => `  \\item ${b}`).join('\n')}\n\\end{itemize}` : '';
  const head = (left: string, right: string) => `\\noindent ${left}${right ? ` \\hfill {\\small ${right}}` : ''}\\par`;
  const bold = (s: string) => s ? `\\textbf{${s}}` : '';
  const ital = (s: string) => s ? `\\textit{${s}}` : '';
  const parts: Record<typeof slots[number], string> = {
    profile: (() => {
      const name = leaf(spec.profile.name);
      const title = leaf(spec.profile.title);
      const contact = join([spec.profile.email, spec.profile.phone, spec.profile.location, ...Object.values(spec.profile.links ?? {})], ' $|$ ');
      return `\\begin{center}\n  {\\Huge \\textbf{${name}}}\\\\[2pt]\n  {\\large ${title}}\\\\[2pt]\n  {\\small ${contact}}\n\\end{center}`;
    })(),
    summary: section('Summary', leaf(spec.summary)),
    experiences: section('Experience', spec.experiences.map(e => {
      const left = [bold(leaf(e.role)), ital(leaf(e.company))].filter(Boolean).join(' $|$ ');
      const dates = [leaf(e.startDate), leaf(e.endDate)].filter(Boolean).join(' -- ');
      const right = [dates, leaf(e.location)].filter(Boolean).join(' $|$ ');
      const bullets = e.bullets.map(b => leaf(b.text)).filter(Boolean);
      return head(left, right) + '\n' + list(bullets.map(b => `{\\small ${b}}`));
    }).join('\n\\vspace{4pt}\n')),
    education: section('Education', spec.education.map(e => {
      const left = [bold(leaf(e.degree)), ital(leaf(e.institution))].filter(Boolean).join(' $|$ ');
      const details = leaf(e.details);
      return head(left, leaf(String(e.year))) + (details ? `\n{\\small \\textit{${details}}}\\par` : '');
    }).join('\n\\vspace{3pt}\n')),
    skills: section('Technical Skills', list(spec.skills.map(g => {
      const cat = leaf(g.category);
      const skills = join(g.skills, ', ');
      return [cat ? `\\textbf{${cat}:}` : '', skills].filter(Boolean).join(' ');
    }).filter(Boolean))),
  };
  if (!expectedText.length) throw new Error('Resume has no public text');
  return {
    // Preserve extractable ligatures and avoid discretionary word splits. The PDF
    // verifier still requires every expected fragment, with no fuzzy matching.
    source: `${profile.preamble}\n\\usepackage{lmodern}\n\\usepackage{enumitem}\n\\usepackage{titlesec}\n\\titleformat{\\section}{\\vspace{-4pt}\\scshape\\raggedright\\large}{}{0em}{}[\\titlerule\\vspace{-4pt}]\n\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\hyphenpenalty=10000\n\\exhyphenpenalty=10000\n\\emergencystretch=\\linewidth\n\\begin{document}\n${profile.body.replace(/\{\{([^{}]*)\}\}/g, (_, key: typeof slots[number]) => parts[key])}\n\\end{document}\n`,
    expectedText,
  };
}
