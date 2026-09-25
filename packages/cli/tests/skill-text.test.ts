import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTailoringSkill } from '../src/tailoring/skill-text.js';

describe('skill-text', () => {
  let tmpDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-text-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadTailoringSkill', () => {
    it('loads bundled skill when workspace does not have custom skill', () => {
      const result = loadTailoringSkill(workspaceDir);
      expect(result.skill).toBeTruthy();
      expect(result.jdRubric).toBeTruthy();
      expect(result.source).toBe('bundled');
    });

    it('returns object with skill, jdRubric, and source properties', () => {
      const result = loadTailoringSkill(workspaceDir);
      expect(result).toHaveProperty('skill');
      expect(result).toHaveProperty('jdRubric');
      expect(result).toHaveProperty('source');
      expect(typeof result.skill).toBe('string');
      expect(typeof result.jdRubric).toBe('string');
      expect(['workspace', 'bundled']).toContain(result.source);
    });

    it('prefers workspace skill over bundled skill', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume'
      );
      fs.mkdirSync(skillPath, { recursive: true });
      const customSkill = 'Custom SKILL.md content';
      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), customSkill);

      const result = loadTailoringSkill(workspaceDir);
      expect(result.skill).toContain(customSkill);
      expect(result.source).toBe('workspace');
    });

    it('includes core principles in skill when available', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume'
      );
      fs.mkdirSync(skillPath, { recursive: true });

      const coreRefsPath = path.join(workspaceDir, '.featherduster', 'skills', 'career-growth', 'references');
      fs.mkdirSync(coreRefsPath, { recursive: true });

      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), 'Main skill content');
      fs.writeFileSync(path.join(coreRefsPath, 'core-principles.md'), 'Core principles content');

      const result = loadTailoringSkill(workspaceDir);
      expect(result.skill).toContain('Main skill content');
      expect(result.skill).toContain('### Shared Core Principles');
      expect(result.skill).toContain('Core principles content');
    });

    it('includes bundled core principles even when workspace has no custom principles', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume'
      );
      fs.mkdirSync(skillPath, { recursive: true });
      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), 'Main skill content');

      const result = loadTailoringSkill(workspaceDir);
      expect(result.skill).toContain('Main skill content');
      // Falls back to bundled principles
      expect(result.skill).toContain('### Shared Core Principles');
    });

    it('loads jdRubric from workspace references', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume',
        'references'
      );
      fs.mkdirSync(skillPath, { recursive: true });

      const customRubric = 'Custom JD extraction rubric';
      fs.writeFileSync(path.join(skillPath, 'jd-extraction-rubric.md'), customRubric);
      fs.writeFileSync(
        path.join(
          workspaceDir,
          '.featherduster',
          'skills',
          'career-growth',
          'career-growth-tailor-resume',
          'SKILL.md'
        ),
        'Skill content'
      );

      const result = loadTailoringSkill(workspaceDir);
      expect(result.jdRubric).toBe(customRubric);
    });

    it('handles non-existent workspace directory gracefully', () => {
      const nonExistentDir = path.join(tmpDir, 'nonexistent', 'deep', 'path');
      const result = loadTailoringSkill(nonExistentDir);
      expect(result.skill).toBeTruthy();
      expect(result.source).toBe('bundled');
    });

    it('skips missing SKILL.md and falls back to bundled', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume'
      );
      fs.mkdirSync(skillPath, { recursive: true });
      // Create directory but no SKILL.md

      const result = loadTailoringSkill(workspaceDir);
      expect(result.source).toBe('bundled');
      expect(result.skill).toBeTruthy();
    });

    it('separates skill and principles with double newline', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume'
      );
      fs.mkdirSync(skillPath, { recursive: true });

      const coreRefsPath = path.join(workspaceDir, '.featherduster', 'skills', 'career-growth', 'references');
      fs.mkdirSync(coreRefsPath, { recursive: true });

      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), 'Skill');
      fs.writeFileSync(path.join(coreRefsPath, 'core-principles.md'), 'Principles');

      const result = loadTailoringSkill(workspaceDir);
      expect(result.skill).toMatch(/Skill\n\n### Shared Core Principles\n\nPrinciples/);
    });

    it('returns empty jdRubric when file cannot be read', () => {
      const skillPath = path.join(
        workspaceDir,
        '.featherduster',
        'skills',
        'career-growth',
        'career-growth-tailor-resume'
      );
      fs.mkdirSync(skillPath, { recursive: true });
      fs.writeFileSync(path.join(skillPath, 'SKILL.md'), 'Skill');

      const result = loadTailoringSkill(workspaceDir);
      expect(typeof result.jdRubric).toBe('string');
    });
  });
});
