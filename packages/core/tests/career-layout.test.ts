import { describe, expect, it } from 'vitest';
import { compileTemplateResume } from '../src/jobs/template.js';
import { DEFAULT_STARTER_RESUME } from '../src/schemas/resume.js';
import { reorderAccomplishments, assertReadableLayout } from '../src/jobs/career-layout.js';

const profile = { id: 'career-signature', name: 'Career Signature', format: 'latex' as const, page_budget: 1, preamble: '\\documentclass{article}\n% trusted original preamble', body: '{{profile}}{{summary}}{{experiences}}{{skills}}{{education}}' };

describe('Career Signature template', () => {
  it('uses the approved serif layout without changing resume content', () => {
    const spec = structuredClone(DEFAULT_STARTER_RESUME);
    spec.experiences[0].bullets[0].text = 'Built typed API clients.';
    const result = compileTemplateResume(profile, spec);
    expect(result.source).toContain('\\usepackage{lmodern}');
    expect(result.source).not.toContain('sourcesanspro');
    expect(result.source).not.toContain('\\resumeSubheading');
    expect(result.source).toContain('\\textbf{' + spec.profile.name + '}');
    expect(result.source).toContain(spec.profile.title);
    expect(result.source.indexOf('section*{Education}')).toBeLessThan(result.source.indexOf('section*{Technical Skills}'));
    expect(result.expectedText).toContain(spec.profile.name);
    expect(result.expectedText).toContain(spec.experiences[0].bullets[0].text);
  });

  it('retains escaping, redaction, confidentiality and exact expected-text checks', () => {
    const spec = structuredClone(DEFAULT_STARTER_RESUME);
    spec.summary = '\\input{evil} & % (ev-042)';
    spec.experiences[0].bullets[0].text = 'Built typed API clients.';
    const result = compileTemplateResume(profile, spec);
    expect(result.source).toContain('\\textbackslash{}input\\{evil\\}');
    expect(result.source).not.toContain('ev-042');
    expect(result.expectedText.join(' ')).not.toContain('ev-042');
    expect(() => compileTemplateResume(profile, spec, { banned_keywords: ['evil'], replacements: [], strip_patterns: [] })).toThrow(/privacy/);
  });

  it('reorders accomplishments emitting valid proposal while preserving LaTeX readability thresholds', () => {
    const proposal = reorderAccomplishments(0, [2, 0, 1], 3);
    expect(proposal.type).toBe('bullet.reorder');
    expect(proposal.target.experience_index).toBe(0);
    expect(proposal.order).toEqual([2, 0, 1]);

    expect(() => assertReadableLayout('\\documentclass[letterpaper,9pt]{article}')).toThrow(/readability threshold/);
    expect(() => assertReadableLayout('\\documentclass[letterpaper,10pt]{article}\n\\tiny{Small text}')).toThrow(/readability threshold/);
    expect(() => assertReadableLayout('\\documentclass[letterpaper,10pt]{article}\n\\small{Readable text}')).not.toThrow();
  });
});
