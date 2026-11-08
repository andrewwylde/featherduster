import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { EvidenceStore } from '@featherduster/core';
import { loadResumeSpecsFromPaths, normalizeResumeId, resolveResume, loadResumeSpecs } from '../src/server.js';
import { createJobsRuntime } from '../src/jobs/runtime.js';

describe('resume variant identities and resolution', () => {
  it('assigns unique identities to identically-named resumes across directories and extensions', () => {
    const files = [
      'resumes/tailored/main.yaml',
      'resumes/tailored/main.tex',
      'resumes/archive/main.yaml',
    ];
    const specs = loadResumeSpecsFromPaths(files, '/workspace');

    const ids = specs.map(s => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(specs[0].id).toBe('tailored/main:yaml');
    expect(specs[1].id).toBe('tailored/main:tex');
    expect(specs[2].id).toBe('archive/main:yaml');
  });

  it('normalizes resume paths with normalizeResumeId', () => {
    expect(normalizeResumeId('resumes/tailored/main.yaml', '/workspace')).toBe('tailored/main:yaml');
    expect(normalizeResumeId('resumes/tailored/main.tex', '/workspace')).toBe('tailored/main:tex');
    expect(normalizeResumeId('resumes/templates/starter.yaml', '/workspace')).toBe('templates/starter:yaml');
    expect(normalizeResumeId('resumes/archive/2025/main.json', '/workspace')).toBe('archive/2025/main:json');
  });

  it('resolves unique legacy IDs and flags ambiguous legacy IDs', () => {
    const files = [
      'resumes/tailored/main.yaml',
      'resumes/tailored/main.tex',
      'resumes/tailored/unique.yaml',
      'resumes/templates/master.yaml',
    ];
    const specs = loadResumeSpecsFromPaths(files, '/workspace');

    // Ambiguous legacy ID matching both .yaml and .tex
    const ambiguous = resolveResume(specs, 'tailored-main');
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.resume).toBeUndefined();

    // Unique legacy ID matching single .yaml
    const unique = resolveResume(specs, 'tailored-unique');
    expect(unique.ambiguous).toBe(false);
    expect(unique.resume?.id).toBe('tailored/unique:yaml');

    // Exact namespaced ID always resolves
    const exact = resolveResume(specs, 'tailored/main:tex');
    expect(exact.ambiguous).toBe(false);
    expect(exact.resume?.id).toBe('tailored/main:tex');
  });

  it('stores normalized resume metadata in captured inputs and flags ambiguity at runtime', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-runtime-test-'));
    const resumesDir = path.join(root, 'resumes', 'tailored');
    fs.mkdirSync(resumesDir, { recursive: true });
    fs.writeFileSync(path.join(resumesDir, 'main.yaml'), yaml.dump({
      profile: { name: 'Alex Mercer', title: 'Engineer', email: 'alex@example.com' },
      experiences: [], education: [], skills: []
    }));
    fs.writeFileSync(path.join(resumesDir, 'main.json'), JSON.stringify({
      profile: { name: 'Alex Mercer', title: 'Architect', email: 'alex@example.com' },
      experiences: [], education: [], skills: []
    }));

    const runtime = createJobsRuntime(root, {
      loadResumes: () => loadResumeSpecs(root),
      loadEvidence: () => new EvidenceStore(),
      loadPrivacyRules: () => ({}),
      automaticDrain: false,
    });

    const preview = await runtime.intake.preview({
      mode: 'text',
      input: 'Acme seeks a Staff Engineer to build high-scale platforms.',
      details: { company: 'Acme', role: 'Staff Engineer' }
    });
    const job = runtime.intake.commit(preview, 'save')[0].job!;

    // Resolving ambiguous legacy id 'tailored-main' throws
    expect(() => runtime.captureInputs(job.id, job.revision, { base_resume_id: 'tailored-main' }))
      .toThrow(/ambiguous/i);

    // Resolving exact normalized id 'tailored/main:yaml' succeeds
    const input = runtime.captureInputs(job.id, job.revision, { base_resume_id: 'tailored/main:yaml' });
    const context = runtime.artifacts.capturedContext(input.id);
    expect(context.resume_id).toBe('tailored/main:yaml');
    expect(context.resume_path).toBe('resumes/tailored/main.yaml');
    expect(context.resume_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

    await runtime.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
