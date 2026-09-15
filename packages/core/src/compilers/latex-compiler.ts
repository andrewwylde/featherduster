import { ResumeSpec } from '../schemas/resume.js';
import { PrivacyRulesConfig } from '../schemas/privacy.js';
import { redactText } from '../integrity/redaction-engine.js';

function redact(text: string, rules?: PrivacyRulesConfig): string {
  const effectiveRules: PrivacyRulesConfig = rules
    ? {
        strip_patterns: rules.strip_patterns ?? [],
        replacements: rules.replacements ?? [],
        banned_keywords: rules.banned_keywords ?? [],
      }
    : { strip_patterns: [], replacements: [], banned_keywords: [] };
  return redactText(text, effectiveRules).redactedText;
}

/**
 * Escapes characters that have special syntactic meaning in LaTeX.
 */
export function escapeLatex(str: string): string {
  return str.replace(/[\\%&_$\#{}\^~]/g, (char) => {
    switch (char) {
      case '\\':
        return '\\textbackslash{}';
      case '%':
        return '\\%';
      case '&':
        return '\\&';
      case '_':
        return '\\_';
      case '$':
        return '\\$';
      case '#':
        return '\\#';
      case '{':
        return '\\{';
      case '}':
        return '\\}';
      case '^':
        return '\\textasciicircum{}';
      case '~':
        return '\\textasciitilde{}';
      default:
        return char;
    }
  });
}

function redactAndEscape(text: string, rules?: PrivacyRulesConfig): string {
  return escapeLatex(redact(text, rules));
}

/**
 * Compiles a ResumeSpec into clean LaTeX source code (.tex)
 * with standard packages (geometry, hyperref, enumitem) and 1-page margins.
 */
export function compileLatexResume(spec: ResumeSpec, rules?: PrivacyRulesConfig): string {
  const name = redactAndEscape(spec.profile.name, rules);
  const title = redactAndEscape(spec.profile.title, rules);

  const contactItems: string[] = [];
  contactItems.push(redactAndEscape(spec.profile.email, rules));
  if (spec.profile.phone) {
    contactItems.push(redactAndEscape(spec.profile.phone, rules));
  }
  if (spec.profile.location) {
    contactItems.push(redactAndEscape(spec.profile.location, rules));
  }
  if (spec.profile.links) {
    for (const [, url] of Object.entries(spec.profile.links)) {
      if (url) {
        const cleanUrl = redact(url, rules);
        const displayUrl = cleanUrl.replace(/^https?:\/\//, '');
        contactItems.push(`\\href{${cleanUrl}}{${escapeLatex(displayUrl)}}`);
      }
    }
  }

  const sections: string[] = [];

  // Preamble
  sections.push(`\\documentclass[letterpaper,10pt]{article}

\\usepackage{geometry}
\\geometry{margin=0.5in}
\\usepackage[hidelinks]{hyperref}
\\usepackage{enumitem}
\\usepackage{titlesec}

\\pagestyle{empty}

% Section formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-4pt}]

\\begin{document}

\\begin{center}
  {\\Huge \\textbf{${name}}} \\\\[2pt]
  {\\large ${title}} \\\\[2pt]
  \\small ${contactItems.join(' $|$ ')}
\\end{center}`);

  // Summary
  if (spec.summary && spec.summary.trim()) {
    const cleanSummary = redactAndEscape(spec.summary, rules);
    sections.push(`\\section{Summary}\n\\noindent ${cleanSummary}`);
  }

  // Experience
  if (spec.experiences && spec.experiences.length > 0) {
    const expBlocks = spec.experiences.map((exp) => {
      const company = redactAndEscape(exp.company, rules);
      const role = redactAndEscape(exp.role, rules);
      const location = exp.location ? redactAndEscape(exp.location, rules) : '';
      const dateLoc = location
        ? `${escapeLatex(exp.startDate)} -- ${escapeLatex(exp.endDate)} $|$ ${location}`
        : `${escapeLatex(exp.startDate)} -- ${escapeLatex(exp.endDate)}`;

      const bulletItems = exp.bullets
        .map((b) => `  \\item ${redactAndEscape(b.text, rules)}`)
        .join('\n');

      return `\\noindent \\textbf{${role}} $|$ \\textit{${company}} \\hfill {\\small ${dateLoc}}
\\begin{itemize}[leftmargin=0.18in,noitemsep,topsep=2pt]
${bulletItems}
\\end{itemize}`;
    });

    sections.push(`\\section{Experience}\n\n${expBlocks.join('\n\\vspace{4pt}\n\n')}`);
  }

  // Education
  if (spec.education && spec.education.length > 0) {
    const eduBlocks = spec.education.map((edu) => {
      const institution = redactAndEscape(edu.institution, rules);
      const degree = redactAndEscape(edu.degree, rules);
      const details = edu.details ? redactAndEscape(edu.details, rules) : '';
      const year = escapeLatex(String(edu.year));

      let block = `\\noindent \\textbf{${degree}} $|$ \\textit{${institution}} \\hfill {\\small ${year}}`;
      if (details) {
        block += `\\\\\n{\\small \\textit{${details}}}`;
      }
      return block;
    });

    sections.push(`\\section{Education}\n\n${eduBlocks.join('\n\\vspace{3pt}\n\n')}`);
  }

  // Skills
  if (spec.skills && spec.skills.length > 0) {
    const skillItems = spec.skills.map((g) => {
      const cat = redactAndEscape(g.category, rules);
      const list = g.skills.map((s) => redactAndEscape(s, rules)).join(', ');
      return `  \\item \\textbf{${cat}:} ${list}`;
    });

    sections.push(`\\section{Technical Skills}
\\begin{itemize}[leftmargin=0.18in,noitemsep,topsep=2pt]
${skillItems.join('\n')}
\\end{itemize}`);
  }

  sections.push('\\end{document}\n');

  return sections.join('\n\n').trim() + '\n';
}
