import { ResumeSpec } from '../schemas/resume.js';
import { PrivacyRulesConfig } from '../schemas/privacy.js';
import { redactText } from '../integrity/redaction-engine.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) {
    return '#';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function redactAndEscape(text: string, rules?: PrivacyRulesConfig): string {
  return escapeHtml(redact(text, rules));
}

/**
 * Compiles a ResumeSpec into standalone, CSS-paginated 1-page HTML markup
 * with embedded print styling.
 */
export function compileHtmlPrintResume(spec: ResumeSpec, rules?: PrivacyRulesConfig): string {
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
        const safeHref = escapeHtml(sanitizeUrl(cleanUrl));
        const safeText = escapeHtml(cleanUrl);
        contactItems.push(`<a href="${safeHref}">${safeText}</a>`);
      }
    }
  }

  let summaryHtml = '';
  if (spec.summary && spec.summary.trim()) {
    const cleanSummary = redactAndEscape(spec.summary, rules);
    summaryHtml = `
    <section class="section">
      <div class="section-title">Summary</div>
      <p class="summary-text">${cleanSummary}</p>
    </section>`;
  }

  let experienceHtml = '';
  if (spec.experiences && spec.experiences.length > 0) {
    const expItems = spec.experiences
      .map((exp) => {
        const company = redactAndEscape(exp.company, rules);
        const role = redactAndEscape(exp.role, rules);
        const location = exp.location ? redactAndEscape(exp.location, rules) : '';
        const dateLoc = location
          ? `${escapeHtml(exp.startDate)} – ${escapeHtml(exp.endDate)} | ${location}`
          : `${escapeHtml(exp.startDate)} – ${escapeHtml(exp.endDate)}`;

        const bulletsHtml = exp.bullets
          .map((b) => `<li>${redactAndEscape(b.text, rules)}</li>`)
          .join('\n            ');

        return `
      <div class="entry">
        <div class="entry-header">
          <div><span class="entry-title">${role}</span>, <span class="entry-subtitle">${company}</span></div>
          <div class="entry-date">${dateLoc}</div>
        </div>
        <ul class="bullets">
          ${bulletsHtml}
        </ul>
      </div>`;
      })
      .join('\n');

    experienceHtml = `
    <section class="section">
      <div class="section-title">Experience</div>
      ${expItems}
    </section>`;
  }

  let educationHtml = '';
  if (spec.education && spec.education.length > 0) {
    const eduItems = spec.education
      .map((edu) => {
        const institution = redactAndEscape(edu.institution, rules);
        const degree = redactAndEscape(edu.degree, rules);
        const details = edu.details ? redactAndEscape(edu.details, rules) : '';
        const year = escapeHtml(String(edu.year));

        return `
      <div class="entry">
        <div class="entry-header">
          <div><span class="entry-title">${degree}</span>, <span class="entry-subtitle">${institution}</span></div>
          <div class="entry-date">${year}</div>
        </div>
        ${details ? `<div class="entry-details">${details}</div>` : ''}
      </div>`;
      })
      .join('\n');

    educationHtml = `
    <section class="section">
      <div class="section-title">Education</div>
      ${eduItems}
    </section>`;
  }

  let skillsHtml = '';
  if (spec.skills && spec.skills.length > 0) {
    const skillGroups = spec.skills
      .map((group) => {
        const cat = redactAndEscape(group.category, rules);
        const skillList = group.skills.map((s) => redactAndEscape(s, rules)).join(', ');
        return `<div class="skill-group"><span class="skill-category">${cat}:</span> ${skillList}</div>`;
      })
      .join('\n      ');

    skillsHtml = `
    <section class="section">
      <div class="section-title">Skills</div>
      ${skillGroups}
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} - Resume</title>
  <style>
    @page {
      size: letter;
      margin: 0.5in;
    }
    @media print {
      body {
        width: 100%;
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 9.5pt;
      line-height: 1.35;
      color: #111827;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 0.5in;
      background-color: #ffffff;
    }
    header {
      text-align: center;
      margin-bottom: 10pt;
    }
    h1.name {
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 2pt;
      color: #111827;
    }
    .title {
      font-size: 10.5pt;
      font-weight: 500;
      color: #374151;
      margin-bottom: 4pt;
    }
    .contact-line {
      font-size: 8.5pt;
      color: #4b5563;
    }
    .contact-line a {
      color: inherit;
      text-decoration: none;
    }
    .section {
      margin-bottom: 8pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 10pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #9ca3af;
      padding-bottom: 1.5pt;
      margin-bottom: 5pt;
      color: #111827;
    }
    .summary-text {
      font-size: 9pt;
      line-height: 1.35;
      color: #374151;
    }
    .entry {
      margin-bottom: 5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 9.5pt;
      margin-bottom: 1.5pt;
    }
    .entry-title {
      font-weight: 700;
      color: #111827;
    }
    .entry-subtitle {
      font-style: italic;
      color: #374151;
    }
    .entry-date {
      font-size: 8.5pt;
      color: #4b5563;
      white-space: nowrap;
    }
    .entry-details {
      font-size: 8.5pt;
      font-style: italic;
      color: #4b5563;
      margin-bottom: 2pt;
    }
    ul.bullets {
      margin: 1.5pt 0 3pt 14pt;
      padding: 0;
    }
    ul.bullets li {
      font-size: 8.5pt;
      margin-bottom: 1.5pt;
      line-height: 1.35;
      color: #1f2937;
    }
    .skill-group {
      font-size: 8.5pt;
      margin-bottom: 2pt;
      line-height: 1.35;
    }
    .skill-category {
      font-weight: 700;
      color: #111827;
    }
  </style>
</head>
<body>
  <header>
    <h1 class="name">${name}</h1>
    <div class="title">${title}</div>
    <div class="contact-line">${contactItems.join(' &bull; ')}</div>
  </header>
${summaryHtml}
${experienceHtml}
${educationHtml}
${skillsHtml}
</body>
</html>
`;
}
