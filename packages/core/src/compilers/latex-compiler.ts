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

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(?:javascript|vbscript|data|file|run):/i.test(trimmed)) {
    return '#';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function escapeLatexUrl(url: string): string {
  return url
    .replace(/\\/g, '\\textbackslash ')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/~/g, '\\~{}')
    .replace(/&/g, '\\&')
    .replace(/_/g, '\\_');
}

function redactAndEscape(text: string, rules?: PrivacyRulesConfig): string {
  return escapeLatex(redact(text, rules));
}

/**
 * Compiles a ResumeSpec into clean LaTeX source code.
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
        const safeUrl = sanitizeUrl(cleanUrl);
        const displayUrl = cleanUrl.replace(/^https?:\/\//, '');
        contactItems.push(`\\href{${escapeLatexUrl(safeUrl)}}{${escapeLatex(displayUrl)}}`);
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
\\usepackage{xcolor}

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

/**
 * Unescapes characters that were escaped for LaTeX formatting.
 */
export function unescapeLatex(str: string): string {
  return str
    .replace(/\\([%&_\$#{}^~])/g, '$1')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\href\{[^}]+\}\{([^}]+)\}/g, '$1')
    .replace(/\\(?:textbf|textit|small|large|Huge|scshape|noindent)\{([^}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses LaTeX resume source code into a structured ResumeSpec.
 * Supports both standard \resumeSubheading formats and compileLatexResume formats.
 */
export function parseLatexResume(content: string): ResumeSpec | null {
  const docMatch = content.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  const docText = docMatch ? docMatch[1] : content;

  let name = '';
  let email = '';
  let phone = '';
  let github = '';
  let linkedin = '';
  let website = '';

  const centerMatch = docText.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/);
  const headerText = centerMatch ? centerMatch[1] : docText.slice(0, 1000);

  const nameMatch =
    headerText.match(/\\textbf\{(?:\\Huge\s*)?(?:\\scshape\s*)?([^}]+)\}/) ||
    headerText.match(/\\Huge\s*\\textbf\{([^}]+)\}/);
  if (nameMatch) name = unescapeLatex(nameMatch[1]);

  const emailMatch = headerText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) email = emailMatch[1];

  const phoneMatch = headerText.match(/(\+?[0-9][0-9\s-]{8,18}[0-9])/);
  if (phoneMatch) phone = phoneMatch[1].trim();

  const hrefs = Array.from(headerText.matchAll(/\\href\{([^}]+)\}/g)).map((m) => m[1]);
  for (const h of hrefs) {
    if (h.includes('github.com')) github = h;
    else if (h.includes('linkedin.com')) linkedin = h;
    else if (!website && !h.includes('@')) website = h;
  }

  // Summary
  let summary = '';
  const sumMatch =
    docText.match(/\\section\{(?:Professional\s+)?Summary\}[\s\S]*?\\small\{\\item\{([\s\S]*?)\}\}/i) ||
    docText.match(
      /\\section\{(?:Professional\s+)?Summary\}\s*(?:\\noindent\s*)?([\s\S]*?)(?:\\section\{|\\end\{document\}|$)/i
    );
  if (sumMatch) {
    summary = unescapeLatex(
      sumMatch[1]
        .replace(/\\begin\{itemize\}[\s\S]*?\\item\s*/, '')
        .replace(/\\end\{itemize\}.*/, '')
    );
  }

  // Experience
  const expSectionMatch = docText.match(
    /\\section\{(?:Work\s+)?Experience\}([\s\S]*?)(?:\\section\{|\\end\{document\}|$)/i
  );
  const experiences: ResumeSpec['experiences'] = [];
  if (expSectionMatch) {
    const expText = expSectionMatch[1];

    if (expText.includes('\\resumeSubheading')) {
      const subheadings = Array.from(
        expText.matchAll(
          /\\resumeSubheading\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}([\s\S]*?)(?=(?:\\resumeSubheading|\\resumeSubHeadingListEnd|$))/g
        )
      );
      for (const sh of subheadings) {
        const a1 = unescapeLatex(sh[1]);
        const a2 = unescapeLatex(sh[2]);
        const a3 = unescapeLatex(sh[3]);
        const a4 = unescapeLatex(sh[4]);
        const itemBody = sh[5];

        let company = a3;
        let role = a1;
        let startDate = a2;
        let endDate = '';
        let location: string | undefined = a4;

        if (/\b(?:20\d\d|19\d\d|Present)\b/i.test(a4)) {
          company = a1;
          location = a2;
          role = a3;
          const dateParts = a4.split(/--|–|-/).map((s) => s.trim());
          startDate = dateParts[0] || '';
          endDate = dateParts[1] || '';
        } else {
          const dateParts = a2.split(/--|–|-/).map((s) => s.trim());
          startDate = dateParts[0] || '';
          endDate = dateParts[1] || '';
        }

        const bullets: Array<{ text: string; citations?: string[] }> = [];
        const itemMatches = Array.from(
          itemBody.matchAll(
            /\\resumeItem\{([\s\S]*?)\}(?=\s*(?:\\resumeItem|\s*\\resumeItemListEnd|$))/g
          )
        );
        for (const im of itemMatches) {
          const bText = unescapeLatex(im[1]);
          if (bText) {
            const cits = Array.from(bText.matchAll(/\b([a-z]{2,8}-[0-9]{3})\b/gi)).map((m) =>
              m[1].toLowerCase()
            );
            bullets.push({ text: bText, citations: cits.length > 0 ? cits : undefined });
          }
        }

        experiences.push({
          company,
          role,
          location: location || undefined,
          startDate,
          endDate: endDate || 'Present',
          bullets,
        });
      }
    } else {
      const expBlocks = expText.split(/(?=\\noindent\s*\\textbf)/);
      for (const block of expBlocks) {
        const headerMatch = block.match(
          /\\noindent\s*\\textbf\{([^}]+)\}\s*(?:\$\|\$|\|)\s*\\textit\{([^}]+)\}\s*\\hfill\s*\{\\small\s*([^}]+)\}/
        );
        if (headerMatch) {
          const role = unescapeLatex(headerMatch[1]);
          const company = unescapeLatex(headerMatch[2]);
          const dateLoc = unescapeLatex(headerMatch[3]);
          let dates = dateLoc;
          let location: string | undefined = undefined;
          if (dateLoc.includes('$|$') || dateLoc.includes('|')) {
            const parts = dateLoc.split(/\$\|\$|\|/).map((s) => s.trim());
            dates = parts[0];
            location = parts[1];
          }
          const dateParts = dates.split(/--|–|-/).map((s) => s.trim());
          const bullets: Array<{ text: string; citations?: string[] }> = [];
          const itemMatches = Array.from(
            block.matchAll(/\\item\s+([\s\S]*?)(?=(?:\\item|\\end\{itemize\}|$))/g)
          );
          for (const im of itemMatches) {
            const bText = unescapeLatex(im[1]);
            if (bText) {
              const cits = Array.from(bText.matchAll(/\b([a-z]{2,8}-[0-9]{3})\b/gi)).map((m) =>
                m[1].toLowerCase()
              );
              bullets.push({ text: bText, citations: cits.length > 0 ? cits : undefined });
            }
          }
          experiences.push({
            company,
            role,
            location,
            startDate: dateParts[0] || dates,
            endDate: dateParts[1] || 'Present',
            bullets,
          });
        }
      }
    }
  }

  // Skills
  const skills: ResumeSpec['skills'] = [];
  const skillsSectionMatch = docText.match(
    /\\section\{(?:Technical\s+|Programming\s+)?Skills\}([\s\S]*?)(?:\\section\{|\\end\{document\}|$)/i
  );
  if (skillsSectionMatch) {
    const rawSkillsText = skillsSectionMatch[1];
    const skillLines = Array.from(
      rawSkillsText.matchAll(/(?:\\item\s+)?\\textbf\{([^}]+)\}(?:\{:\s*|\s*:\s*|:\s*|\s+)([^\\}\n]+)/g)
    );
    for (const sl of skillLines) {
      const category = unescapeLatex(sl[1]).replace(/:$/, '').trim();
      const rawList = unescapeLatex(sl[2]);
      const list = rawList
        .split(/,/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (category && list.length > 0) {
        skills.push({ category, skills: list });
      }
    }
  }

  // Education
  const education: ResumeSpec['education'] = [];
  const eduSectionMatch = docText.match(
    /\\section\{Education\}([\s\S]*?)(?:\\section\{|\\end\{document\}|$)/i
  );
  if (eduSectionMatch) {
    const eduText = eduSectionMatch[1];
    if (eduText.includes('\\resumeSubheading')) {
      const eduSubheadings = Array.from(
        eduText.matchAll(
          /\\resumeSubheading\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}/g
        )
      );
      for (const sh of eduSubheadings) {
        const inst = unescapeLatex(sh[1]);
        const loc = unescapeLatex(sh[2]);
        const deg = unescapeLatex(sh[3]);
        const dates = unescapeLatex(sh[4]);
        const allYears = Array.from(dates.matchAll(/\b(20\d\d|19\d\d)\b/g)).map((m) => m[1]);
        const year = allYears.length > 0 ? allYears[allYears.length - 1] : dates;
        education.push({
          institution: inst,
          degree: deg,
          year,
        });
      }
    } else {
      const eduMatches = Array.from(
        eduText.matchAll(
          /\\noindent\s*\\textbf\{([^}]+)\}\s*(?:\$\|\$|\|)\s*\\textit\{([^}]+)\}\s*\\hfill\s*\{\\small\s*([^}]+)\}/g
        )
      );
      for (const em of eduMatches) {
        const rawDates = unescapeLatex(em[3]);
        const allYears = Array.from(rawDates.matchAll(/\b(20\d\d|19\d\d)\b/g)).map((m) => m[1]);
        const year = allYears.length > 0 ? allYears[allYears.length - 1] : rawDates;
        education.push({
          degree: unescapeLatex(em[1]),
          institution: unescapeLatex(em[2]),
          year,
        });
      }
    }
  }

  return {
    profile: {
      name: name || 'Candidate',
      title: experiences[0]?.role || 'Software Engineer',
      email: email || '',
      phone: phone || undefined,
      location: experiences[0]?.location || undefined,
      links: {
        github: github || undefined,
        linkedin: linkedin || undefined,
        website: website || undefined,
      },
    },
    summary: summary || undefined,
    experiences,
    skills,
    education,
  };
}
