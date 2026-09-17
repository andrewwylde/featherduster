import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL_REL = path.join('career-growth', 'career-growth-tailor-resume');

function bundledSkillsDir(): string {
  // src/tailoring -> src/templates/skills ; dist/tailoring -> dist/templates/skills
  return path.resolve(here, '..', 'templates', 'skills');
}

function readFirst(candidates: string[]): string {
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return fs.readFileSync(file, 'utf-8');
    } catch {
      // try next
    }
  }
  return '';
}

export interface TailoringSkillText {
  /** SKILL.md + shared core principles, for the system prompt. */
  skill: string;
  /** JD extraction rubric, passed as gate 0 input. */
  jdRubric: string;
  source: 'workspace' | 'bundled';
}

/**
 * Loads the tailoring skill from the workspace (so user edits apply), falling back
 * to the copy bundled with the CLI.
 */
export function loadTailoringSkill(workspaceDir: string): TailoringSkillText {
  const workspaceSkills = path.join(workspaceDir, '.featherduster', 'skills');
  const roots = [workspaceSkills, bundledSkillsDir()];
  const pick = (rel: string) => readFirst(roots.map((r) => path.join(r, rel)));

  const skillMd = pick(path.join(SKILL_REL, 'SKILL.md'));
  const principles = pick(path.join('career-growth', 'references', 'core-principles.md'));
  const jdRubric = pick(path.join(SKILL_REL, 'references', 'jd-extraction-rubric.md'));
  const source = fs.existsSync(path.join(workspaceSkills, SKILL_REL, 'SKILL.md')) ? 'workspace' : 'bundled';

  const skill = [skillMd.trim(), principles.trim() ? `### Shared Core Principles\n\n${principles.trim()}` : '']
    .filter(Boolean)
    .join('\n\n');
  return { skill, jdRubric, source };
}
