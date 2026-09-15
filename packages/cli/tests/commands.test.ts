import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import {
  checkWorkspace,
  runCheckCommand,
} from '../src/commands/check.js';
import {
  runBuild,
} from '../src/commands/build.js';
import { WorkspaceWatcher } from '../src/watcher.js';
import {
  EvidenceEntry,
  LevelingRubric,
  ResumeSpec,
  serializeEvidenceMarkdown,
} from '@featherduster/core';

describe('CLI Commands & Watcher Tests', () => {
  let tmpWorkspace: string;

  const sampleEvidence: EvidenceEntry = {
    id: 'ev-001',
    date: '2026-01-15',
    company: 'AlphaCorp',
    title: 'Distributed Transaction Coordinator',
    summary: 'Built two-phase commit coordinator with Raft consensus.',
    impact: 'Achieved zero data loss across 10M transactions.',
    themes: ['distributed-systems'],
    confidence: 'verified',
    in_flight: false,
    metrics: [{ name: 'data loss', value: '0', status: 'verified' }],
    internal_references: [],
  };

  const sampleRubric: LevelingRubric = {
    id: 'eng-ladder',
    title: 'Engineering Ladder',
    target_level: 'L5',
    levels: [
      { id: 'L4', name: 'Senior' },
      { id: 'L5', name: 'Staff' },
    ],
    competencies: [
      {
        id: 'architecture',
        name: 'Architecture',
        levels: { L4: 'Module scope', L5: 'System scope' },
        evidence_mapped: [{ ev_id: 'ev-001', relevance: 'primary' }],
      },
    ],
  };

  const sampleSpec: ResumeSpec = {
    profile: {
      name: 'Morgan Blake',
      title: 'Staff Engineer',
      email: 'morgan@example.com',
    },
    experiences: [
      {
        company: 'AlphaCorp',
        role: 'Staff Engineer',
        startDate: '2023-01',
        endDate: 'Present',
        bullets: [
          {
            text: 'Built two-phase commit coordinator (ev-001).',
            citations: ['ev-001'],
          },
        ],
      },
    ],
    education: [
      {
        institution: 'MIT',
        degree: 'B.S.',
        year: '2018',
      },
    ],
    skills: [
      {
        category: 'Systems',
        skills: ['Rust', 'Go'],
      },
    ],
  };

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-cli-cmd-test-'));

    fs.mkdirSync(path.join(tmpWorkspace, 'evidence', 'AlphaCorp'), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, 'rubrics'), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, 'resumes', 'tailored'), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, '.featherduster'), { recursive: true });

    // Seed evidence
    const md = serializeEvidenceMarkdown(sampleEvidence, 'Detailed technical narrative.');
    fs.writeFileSync(
      path.join(tmpWorkspace, 'evidence', 'AlphaCorp', 'ev-001.md'),
      md,
      'utf-8'
    );

    // Seed rubric
    fs.writeFileSync(
      path.join(tmpWorkspace, 'rubrics', 'eng-ladder.yaml'),
      yaml.dump(sampleRubric),
      'utf-8'
    );

    // Seed resume spec
    fs.writeFileSync(
      path.join(tmpWorkspace, 'resumes', 'tailored', 'spec.json'),
      JSON.stringify(sampleSpec, null, 2),
      'utf-8'
    );

    // Seed privacy rules
    fs.writeFileSync(
      path.join(tmpWorkspace, '.featherduster', 'privacy-rules.yaml'),
      yaml.dump({
        rules: {
          strip_patterns: ['CONF-\\d+'],
          replacements: [{ search: 'AlphaCorp', replace: 'Enterprise Inc.' }],
          banned_keywords: ['TopSecretProject'],
        },
      }),
      'utf-8'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('featherduster check (integrity linter)', () => {
    it('reports clean workspace when all citations and metrics are valid', () => {
      const result = checkWorkspace(tmpWorkspace);
      expect(result.isClean).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.validCitationsCount).toBeGreaterThanOrEqual(1);
    });

    it('detects dangling citations, unverified metrics, and banned keywords', () => {
      // Add a corrupted resume markdown file
      fs.writeFileSync(
        path.join(tmpWorkspace, 'resumes', 'tailored', 'bad.md'),
        'Worked on TopSecretProject citing ev-999 with [METRIC NEEDED].\n',
        'utf-8'
      );

      const result = checkWorkspace(tmpWorkspace);
      expect(result.isClean).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);

      const types = result.issues.map((i) => i.type);
      expect(types).toContain('dangling_citation');
      expect(types).toContain('missing_metric');
      expect(types).toContain('banned_keyword');
    });

    it('runCheckCommand runs without exiting when exitOnError is false', async () => {
      const result = await runCheckCommand({
        workspace: tmpWorkspace,
        exitOnError: false,
      });
      expect(result.isClean).toBe(true);
    });
  });

  describe('featherduster build (resume and brag compiler)', () => {
    it('compiles markdown resume and saves to default export directory', async () => {
      const result = await runBuild({
        workspace: tmpWorkspace,
        format: 'markdown',
      });

      expect(result.isClean).toBe(true);
      expect(result.output).toContain('Morgan Blake');
      // Redaction applies
      expect(result.output).toContain('Enterprise Inc.');
      expect(result.output).not.toContain('AlphaCorp');
      expect(result.output).not.toContain('ev-001');

      expect(result.outputPath).toBeDefined();
      expect(fs.existsSync(result.outputPath!)).toBe(true);
    });

    it('compiles brag doc using rubric and evidence store', async () => {
      const result = await runBuild({
        workspace: tmpWorkspace,
        format: 'brag',
        rubric: 'eng-ladder',
        candidateName: 'Morgan Blake',
        period: '2026-H1',
      });

      expect(result.isClean).toBe(true);
      expect(result.output).toContain('# Performance Brag Document: Morgan Blake');
      expect(result.output).toContain('Engineering Ladder');
      expect(result.output).toContain('Architecture');
      expect(result.output).toContain('Distributed Transaction Coordinator');

      expect(result.outputPath).toBeDefined();
      expect(fs.existsSync(result.outputPath!)).toBe(true);
    });

    it('compiles HTML, Typst, and LaTeX formats cleanly', async () => {
      const resHtml = await runBuild({ workspace: tmpWorkspace, format: 'html' });
      expect(resHtml.output).toContain('<!DOCTYPE html>');

      const resTypst = await runBuild({ workspace: tmpWorkspace, format: 'typst' });
      expect(resTypst.output).toContain('#set page');

      const resLatex = await runBuild({ workspace: tmpWorkspace, format: 'latex' });
      expect(resLatex.output).toContain('\\documentclass');
    });

    it('detects violations when compiled document contains banned keywords', async () => {
      const specWithBanned: ResumeSpec = {
        ...sampleSpec,
        summary: 'Designed TopSecretProject cloud deployment.',
      };
      fs.writeFileSync(
        path.join(tmpWorkspace, 'resumes', 'tailored', 'spec.json'),
        JSON.stringify(specWithBanned, null, 2),
        'utf-8'
      );

      const result = await runBuild({
        workspace: tmpWorkspace,
        format: 'markdown',
      });

      expect(result.isClean).toBe(false);
      expect(result.violations).toContain('TopSecretProject');
    });
  });

  describe('WorkspaceWatcher', () => {
    it('initializes, subscribes, and closes cleanly without error', async () => {
      const watcher = new WorkspaceWatcher(tmpWorkspace, { debounceMs: 50 });
      let eventCount = 0;

      const unsubscribe = watcher.subscribe(() => {
        eventCount++;
      });

      watcher.start();
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
      await watcher.close();
    });
  });
});
