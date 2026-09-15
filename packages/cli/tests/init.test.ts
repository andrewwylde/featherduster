import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';
import {
  initWorkspace,
  runInitCommand,
  InitWorkspaceResult,
} from '../src/commands/init.js';
import { checkWorkspace } from '../src/commands/check.js';
import {
  parseEvidenceMarkdown,
  LevelingRubricSchema,
  WorkspaceConfigSchema,
  PrivacyRulesConfigSchema,
  SWE_IC_RUBRIC,
} from '@featherduster/core';

describe('Featherduster Workspace Init & Git Push Defense', () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-init-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('initWorkspace scaffolding', () => {
    it('scaffolds a complete clean career corpus workspace with all required files', async () => {
      const result = await initWorkspace({ workspace: tmpWorkspace });

      expect(result.success).toBe(true);
      expect(result.workspaceDir).toBe(tmpWorkspace);
      expect(result.createdFiles.length).toBeGreaterThanOrEqual(8);

      // 1. .featherduster/config.yaml
      const configPath = path.join(tmpWorkspace, '.featherduster', 'config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
      const rawConfig = yaml.load(fs.readFileSync(configPath, 'utf-8'));
      const parsedConfig = WorkspaceConfigSchema.parse(rawConfig);
      expect(parsedConfig.active_profile).toBe('sample-company');
      expect(parsedConfig.port).toBe(4173);
      expect(parsedConfig.default_export_target).toBe('markdown');

      // 2. .featherduster/privacy-rules.yaml
      const privacyPath = path.join(tmpWorkspace, '.featherduster', 'privacy-rules.yaml');
      expect(fs.existsSync(privacyPath)).toBe(true);
      const rawPrivacy: any = yaml.load(fs.readFileSync(privacyPath, 'utf-8'));
      const rulesData = rawPrivacy?.rules ?? rawPrivacy;
      const parsedPrivacy = PrivacyRulesConfigSchema.parse(rulesData);
      expect(parsedPrivacy.strip_patterns.length).toBeGreaterThan(0);
      expect(parsedPrivacy.replacements.length).toBeGreaterThan(0);
      expect(parsedPrivacy.banned_keywords.length).toBeGreaterThan(0);
      expect(parsedPrivacy.banned_keywords).toContain('CONFIDENTIAL');

      // 3. evidence/sample-company/ev-001-starter.md
      const evidencePath = path.join(
        tmpWorkspace,
        'evidence',
        'sample-company',
        'ev-001-starter.md'
      );
      expect(fs.existsSync(evidencePath)).toBe(true);
      const evContent = fs.readFileSync(evidencePath, 'utf-8');
      const parsedEv = parseEvidenceMarkdown(evContent, evidencePath);
      expect(parsedEv.entry.id).toBe('ev-001');
      expect(parsedEv.entry.company).toBe('sample-company');
      expect(parsedEv.entry.confidence).toBe('verified');
      expect(parsedEv.entry.metrics.length).toBeGreaterThanOrEqual(1);
      expect(parsedEv.narrative.length).toBeGreaterThan(0);

      // 4. rubrics/engineering-ic.yaml
      const rubricPath = path.join(tmpWorkspace, 'rubrics', 'engineering-ic.yaml');
      expect(fs.existsSync(rubricPath)).toBe(true);
      const rawRubric = yaml.load(fs.readFileSync(rubricPath, 'utf-8'));
      const parsedRubric = LevelingRubricSchema.parse(rawRubric);
      expect(parsedRubric.id).toBe(SWE_IC_RUBRIC.id);
      expect(parsedRubric.levels.length).toBe(SWE_IC_RUBRIC.levels.length);
      expect(parsedRubric.competencies.length).toBe(SWE_IC_RUBRIC.competencies.length);

      // 5. resumes/templates/starter.md
      const templatePath = path.join(tmpWorkspace, 'resumes', 'templates', 'starter.md');
      expect(fs.existsSync(templatePath)).toBe(true);
      const templateContent = fs.readFileSync(templatePath, 'utf-8');
      expect(templateContent).toContain('ev-001');

      // 6. resumes/tailored/ and resumes/exports/
      expect(fs.existsSync(path.join(tmpWorkspace, 'resumes', 'tailored'))).toBe(true);
      expect(fs.existsSync(path.join(tmpWorkspace, 'resumes', 'exports'))).toBe(true);

      // 7. companies/sample-company/profile.yaml
      const profilePath = path.join(
        tmpWorkspace,
        'companies',
        'sample-company',
        'profile.yaml'
      );
      expect(fs.existsSync(profilePath)).toBe(true);
      const rawProfile: any = yaml.load(fs.readFileSync(profilePath, 'utf-8'));
      expect(rawProfile.company).toBe('sample-company');
      expect(rawProfile.names_public).toContain('Sample Company');

      // 8. AGENT.md
      const agentMdPath = path.join(tmpWorkspace, 'AGENT.md');
      expect(fs.existsSync(agentMdPath)).toBe(true);
      const agentContent = fs.readFileSync(agentMdPath, 'utf-8');
      expect(agentContent).toContain('[METRIC NEEDED]');
      expect(agentContent).toContain('ev-###');
      expect(agentContent).toContain('Zero AI Slop');
      expect(agentContent).toContain('.featherduster/skills/');
      expect(agentContent).toContain('de-slop');
      expect(agentContent).toContain('career-growth');
      expect(agentContent).toContain('Privacy');
      expect(agentContent).toContain('featherduster');

      // 9. .githooks/pre-push
      const prePushPath = path.join(tmpWorkspace, '.githooks', 'pre-push');
      expect(fs.existsSync(prePushPath)).toBe(true);
      const prePushContent = fs.readFileSync(prePushPath, 'utf-8');
      expect(prePushContent).toContain('#!/bin/sh');
      expect(prePushContent).toContain('featherduster check');

      // 10. .featherduster/skills/ and .claude/skills/
      const deSlopSkillPath = path.join(tmpWorkspace, '.featherduster', 'skills', 'de-slop', 'SKILL.md');
      expect(fs.existsSync(deSlopSkillPath)).toBe(true);
      const deSlopContent = fs.readFileSync(deSlopSkillPath, 'utf-8');
      expect(deSlopContent).toContain('Fidelity over flair');

      const careerGrowthSkillPath = path.join(tmpWorkspace, '.featherduster', 'skills', 'career-growth', 'SKILL.md');
      expect(fs.existsSync(careerGrowthSkillPath)).toBe(true);
      const careerGrowthContent = fs.readFileSync(careerGrowthSkillPath, 'utf-8');
      expect(careerGrowthContent).toContain('career-growth');

      const claudeSkillsPath = path.join(tmpWorkspace, '.claude', 'skills', 'de-slop', 'SKILL.md');
      expect(fs.existsSync(claudeSkillsPath)).toBe(true);

      // 11. .claude/settings.json
      const claudeSettingsPath = path.join(tmpWorkspace, '.claude', 'settings.json');
      expect(fs.existsSync(claudeSettingsPath)).toBe(true);
      const claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      expect(claudeSettings.permissions?.deny).toContain('Bash(git push)');

      // 12. Integrity check on clean workspace should pass 100%
      const checkResult = checkWorkspace(tmpWorkspace);
      expect(checkResult.isClean).toBe(true);
      expect(checkResult.issues).toEqual([]);
      expect(checkResult.validCitationsCount).toBeGreaterThanOrEqual(1);
      expect(checkResult.slopMatchesCount).toBe(0);
    });

    it('configures git hooks when git repository is initialized', async () => {
      // Initialize a real git repo in the temp folder
      execSync('git init', { cwd: tmpWorkspace, stdio: 'ignore' });

      const result = await initWorkspace({ workspace: tmpWorkspace });
      expect(result.gitHooksConfigured).toBe(true);

      // Verify git config core.hooksPath is set to .githooks
      const hooksPath = execSync('git config --get core.hooksPath', {
        cwd: tmpWorkspace,
        encoding: 'utf-8',
      }).trim();
      expect(hooksPath).toBe('.githooks');
    });

    it('gracefully skips git config when workspace is not a git repo', async () => {
      // Non-git directory
      const result = await initWorkspace({ workspace: tmpWorkspace });
      expect(result.gitHooksConfigured).toBe(false);
      expect(fs.existsSync(path.join(tmpWorkspace, '.githooks', 'pre-push'))).toBe(true);
    });

    it('enforces blockPush configuration when requested', async () => {
      execSync('git init', { cwd: tmpWorkspace, stdio: 'ignore' });

      await initWorkspace({ workspace: tmpWorkspace, blockPush: true });

      const configPath = path.join(tmpWorkspace, '.featherduster', 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf-8');
      expect(configContent).toContain('block_push: true');

      const blockPushGit = execSync('git config --get featherduster.blockPush', {
        cwd: tmpWorkspace,
        encoding: 'utf-8',
      }).trim();
      expect(blockPushGit).toBe('true');
    });
  });

  describe('idempotency', () => {
    it('preserves existing user modifications when run without --force', async () => {
      // First run
      await initWorkspace({ workspace: tmpWorkspace });

      // User modifies evidence and config
      const evFile = path.join(
        tmpWorkspace,
        'evidence',
        'sample-company',
        'ev-001-starter.md'
      );
      const customEvidence = '# Custom User Narrative\nMy distinct changes';
      fs.writeFileSync(evFile, customEvidence, 'utf-8');

      const configFile = path.join(tmpWorkspace, '.featherduster', 'config.yaml');
      const customConfig = 'active_profile: my-custom-profile\ndefault_export_target: typst\nport: 9999\n';
      fs.writeFileSync(configFile, customConfig, 'utf-8');

      // Second run without force
      const result2 = await initWorkspace({ workspace: tmpWorkspace });

      expect(result2.createdFiles.length).toBe(0);
      expect(result2.skippedFiles.length).toBeGreaterThanOrEqual(8);

      // User content preserved
      expect(fs.readFileSync(evFile, 'utf-8')).toBe(customEvidence);
      expect(fs.readFileSync(configFile, 'utf-8')).toBe(customConfig);
    });

    it('overwrites existing files when --force is specified', async () => {
      // First run
      await initWorkspace({ workspace: tmpWorkspace });

      // User modifies config
      const configFile = path.join(tmpWorkspace, '.featherduster', 'config.yaml');
      fs.writeFileSync(configFile, 'corrupted_config: true\n', 'utf-8');

      // Second run with force: true
      const resultForce = await initWorkspace({ workspace: tmpWorkspace, force: true });

      expect(resultForce.createdFiles.length).toBeGreaterThanOrEqual(8);
      const restoredConfig = fs.readFileSync(configFile, 'utf-8');
      expect(restoredConfig).toContain('active_profile: sample-company');
    });
  });

  describe('runInitCommand', () => {
    it('executes runInitCommand silently and returns success', async () => {
      const result = await runInitCommand({
        workspace: tmpWorkspace,
        silent: true,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tmpWorkspace, 'AGENT.md'))).toBe(true);
    });
  });
});
