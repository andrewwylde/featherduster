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
 * Compiles a ResumeSpec into clean ATS-friendly plaintext/markdown.
 * Automatically redacts citation tags (ev-###), internal ticket IDs,
 * and sensitive terms via redactText.
 */
export function compileMarkdownResume(spec: ResumeSpec, rules?: PrivacyRulesConfig): string {
  const sections: string[] = [];

  // Header
  const name = redact(spec.profile.name, rules);
  const title = redact(spec.profile.title, rules);

  const contactItems: string[] = [];
  contactItems.push(redact(spec.profile.email, rules));
  if (spec.profile.phone) {
    contactItems.push(redact(spec.profile.phone, rules));
  }
  if (spec.profile.location) {
    contactItems.push(redact(spec.profile.location, rules));
  }

  if (spec.profile.links) {
    for (const [, url] of Object.entries(spec.profile.links)) {
      if (url) {
        contactItems.push(redact(url, rules));
      }
    }
  }

  sections.push(`# ${name}\n${title}\n\n${contactItems.join(' | ')}`);

  // Summary
  if (spec.summary && spec.summary.trim()) {
    const cleanSummary = redact(spec.summary, rules);
    sections.push(`## Summary\n${cleanSummary}`);
  }

  // Experience
  if (spec.experiences && spec.experiences.length > 0) {
    const expLines: string[] = ['## Experience'];
    for (const exp of spec.experiences) {
      const company = redact(exp.company, rules);
      const role = redact(exp.role, rules);
      const location = exp.location ? redact(exp.location, rules) : '';
      const dateLoc = location
        ? `${exp.startDate} - ${exp.endDate} | ${location}`
        : `${exp.startDate} - ${exp.endDate}`;

      expLines.push(`### ${role} - ${company}\n${dateLoc}`);

      for (const bullet of exp.bullets) {
        const cleanBullet = redact(bullet.text, rules);
        expLines.push(`- ${cleanBullet}`);
      }
    }
    sections.push(expLines.join('\n\n'));
  }

  // Education
  if (spec.education && spec.education.length > 0) {
    const eduLines: string[] = ['## Education'];
    for (const edu of spec.education) {
      const institution = redact(edu.institution, rules);
      const degree = redact(edu.degree, rules);
      const details = edu.details ? redact(edu.details, rules) : '';

      const line = details ? `${edu.year}\n${details}` : `${edu.year}`;
      eduLines.push(`### ${degree} - ${institution}\n${line}`);
    }
    sections.push(eduLines.join('\n\n'));
  }

  // Skills
  if (spec.skills && spec.skills.length > 0) {
    const skillLines: string[] = ['## Skills'];
    for (const group of spec.skills) {
      const category = redact(group.category, rules);
      const skillList = group.skills.map((s) => redact(s, rules)).join(', ');
      skillLines.push(`- **${category}**: ${skillList}`);
    }
    sections.push(skillLines.join('\n'));
  }

  return sections.join('\n\n').trim() + '\n';
}
