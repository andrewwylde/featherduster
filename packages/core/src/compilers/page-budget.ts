import { ResumeSpec } from '../schemas/resume.js';

export interface PageBudgetResult {
  totalLines: number;
  maxBudget: number;
  percentage: number;
  status: 'optimal' | 'warning' | 'overflow';
  squeezeAvailable: boolean;
  breakdown: {
    header: number;
    summary: number;
    experiences: number;
    education: number;
    skills: number;
  };
}

export interface PageBudgetOptions {
  squeeze?: boolean;
  maxLines?: number;
}

/**
 * Computes an estimated vertical line-unit budget for a 1-page engineering resume layout.
 * Standard 1-page US Letter / A4 with 0.5in margins and 10pt font fits ~50-52 equivalent lines.
 */
export function calculatePageBudget(
  spec: ResumeSpec,
  options?: PageBudgetOptions
): PageBudgetResult {
  const maxBudget = options?.maxLines ?? 50;
  const isSqueeze = options?.squeeze ?? false;

  // Spacing factors: squeeze reduces vertical padding between sections & entries
  const sectionGap = isSqueeze ? 1.0 : 1.5;
  const entryGap = isSqueeze ? 0.75 : 1.0;

  // 1. Header (Name, title, contact line)
  let headerLines = 3.5;
  if (spec.profile?.links && Object.values(spec.profile.links).filter(Boolean).length > 2) {
    headerLines += 0.5;
  }
  headerLines += sectionGap;

  // 2. Summary
  let summaryLines = 0;
  if (spec.summary && spec.summary.trim().length > 0) {
    const chars = spec.summary.trim().length;
    // Estimate lines assuming ~85 characters per line
    summaryLines = Math.max(1, Math.ceil(chars / 85)) + (isSqueeze ? 1.0 : 1.5);
  }

  // 3. Work Experiences
  let expLines = 0;
  for (const exp of spec.experiences || []) {
    // Company, role, location, dates header line
    expLines += 1.5;

    for (const bullet of exp.bullets || []) {
      const text = bullet.text.trim();
      if (!text) continue;
      // Estimate line count for bullet: 90 chars per line + bullet indent
      const bulletLines = Math.max(1, Math.ceil(text.length / 90));
      expLines += bulletLines * (isSqueeze ? 1.0 : 1.15);
    }

    expLines += entryGap;
  }
  if ((spec.experiences || []).length > 0) {
    expLines += sectionGap;
  }

  // 4. Skills section
  let skillsLines = 0;
  if (spec.skills && spec.skills.length > 0) {
    skillsLines += 1.5; // Section title
    for (const group of spec.skills) {
      const skillText = `${group.category}: ${group.skills.join(', ')}`;
      skillsLines += Math.max(1, Math.ceil(skillText.length / 90));
    }
    skillsLines += sectionGap;
  }

  // 5. Education section
  let eduLines = 0;
  if (spec.education && spec.education.length > 0) {
    eduLines += 1.5; // Section title
    for (const edu of spec.education) {
      eduLines += 1.2;
    }
    eduLines += sectionGap;
  }

  const rawTotal = headerLines + summaryLines + expLines + skillsLines + eduLines;
  const totalLines = Math.round(rawTotal * 10) / 10;
  const percentage = Math.round((totalLines / maxBudget) * 100);

  let status: 'optimal' | 'warning' | 'overflow' = 'optimal';
  if (percentage > 100) {
    status = 'overflow';
  } else if (percentage >= 92) {
    status = 'warning';
  }

  return {
    totalLines,
    maxBudget,
    percentage,
    status,
    squeezeAvailable: !isSqueeze && status !== 'optimal',
    breakdown: {
      header: Math.round(headerLines * 10) / 10,
      summary: Math.round(summaryLines * 10) / 10,
      experiences: Math.round(expLines * 10) / 10,
      education: Math.round(eduLines * 10) / 10,
      skills: Math.round(skillsLines * 10) / 10,
    },
  };
}
