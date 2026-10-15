import { describe, expect, it } from 'vitest';
import { compileTemplateResume, LatexTemplateProfileSchema } from '../src/jobs/template.js';
import { DEFAULT_STARTER_RESUME } from '../src/schemas/resume.js';
const raw = { id: 'test', name: 'Test', format: 'latex', preamble: '\\documentclass{article}', body: '{{skills}}{{education}}{{experiences}}{{summary}}{{profile}}' };
describe('trusted templates', () => {
  it('validates slots and page budgets', () => {
    expect(LatexTemplateProfileSchema.parse(raw).page_budget).toBe(1);
    for (const page_budget of [0, 1.5]) expect(() => LatexTemplateProfileSchema.parse({ ...raw, page_budget })).toThrow();
    for (const body of ['{{profile}}', raw.body + '{{unknown}}', raw.body + '{{skills}}']) expect(() => LatexTemplateProfileSchema.parse({ ...raw, body })).toThrow();
    expect(() => LatexTemplateProfileSchema.parse({ ...raw, preamble: '\\begin{document}' })).toThrow();
  });
  it('escapes every displayed leaf, strips citations and preserves inputs', () => {
    const spec = structuredClone(DEFAULT_STARTER_RESUME);
    spec.summary = '\\input{evil} % & _ $ # ^ ~ {{skills}} (ev-042)';
    const before = JSON.stringify(spec);
    const result = compileTemplateResume(LatexTemplateProfileSchema.parse(raw), spec);
    expect(result.source).toContain('\\textbackslash{}input\\{evil\\}');
    expect(result.source).toContain('\\{\\{skills\\}\\}');
    expect(result.source).not.toContain('ev-042');
    expect(result.expectedText).toContain(spec.profile.email);
    expect(result.expectedText).toContain(spec.education[0].details);
    expect(JSON.stringify(spec)).toBe(before);
    expect(result.source.indexOf('Skills')).toBeLessThan(result.source.indexOf('Experience'));
  });
  it('emits searchable glyph mappings and keeps words intact for exact PDF verification', () => {
    const spec = structuredClone(DEFAULT_STARTER_RESUME);
    spec.summary = 'Configuration filters, feature flags, and management signoff.';
    const result = compileTemplateResume(LatexTemplateProfileSchema.parse(raw), spec);
    expect(result.source).toContain('\\usepackage{lmodern}');
    expect(result.source).toContain('\\input{glyphtounicode}');
    expect(result.source).toContain('\\pdfgentounicode=1');
    expect(result.source).toContain('\\hyphenpenalty=10000');
    expect(result.expectedText).toContain(spec.summary);
  });
  it('blocks banned terms including dates and redacts link values', () => {
    const spec = structuredClone(DEFAULT_STARTER_RESUME);
    const profile = LatexTemplateProfileSchema.parse(raw);
    expect(() => compileTemplateResume(profile, spec, { banned_keywords: ['Present'], strip_patterns: [], replacements: [] })).toThrow(/privacy/);
    const result = compileTemplateResume(profile, spec, { banned_keywords: [], strip_patterns: [], replacements: [{ search: 'alexmercer', replace: 'public' }] });
    expect(result.source).not.toContain('alexmercer');
    expect(result.expectedText.join(' ')).not.toContain('alexmercer');
  });
});
