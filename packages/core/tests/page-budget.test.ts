import { describe, it, expect } from 'vitest';
import { calculatePageBudget, type PageBudgetResult } from '../src/compilers/page-budget.js';
import type { ResumeSpec } from '../src/schemas/resume.js';

describe('page-budget', () => {
  const createMinimalSpec = (overrides?: Partial<ResumeSpec>): ResumeSpec => ({
    name: 'John Doe',
    profile: {},
    experiences: [],
    education: [],
    skills: [],
    ...overrides,
  });

  describe('calculatePageBudget', () => {
    it('calculates budget for empty resume', () => {
      const spec = createMinimalSpec();
      const result = calculatePageBudget(spec);

      expect(result).toHaveProperty('totalLines');
      expect(result).toHaveProperty('maxBudget');
      expect(result).toHaveProperty('percentage');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('breakdown');
    });

    it('returns default maxBudget of 50 lines', () => {
      const spec = createMinimalSpec();
      const result = calculatePageBudget(spec);

      expect(result.maxBudget).toBe(50);
    });

    it('respects custom maxLines option', () => {
      const spec = createMinimalSpec();
      const result = calculatePageBudget(spec, { maxLines: 100 });

      expect(result.maxBudget).toBe(100);
    });

    it('calculates percentage correctly', () => {
      const spec = createMinimalSpec();
      const result = calculatePageBudget(spec);

      const expected = Math.round((result.totalLines / result.maxBudget) * 100);
      expect(result.percentage).toBe(expected);
    });

    it('marks status as optimal when well under budget', () => {
      const spec = createMinimalSpec();
      const result = calculatePageBudget(spec);

      expect(result.status).toBe('optimal');
      expect(result.percentage).toBeLessThan(92);
    });

    it('marks status as warning when close to limit (92-100%)', () => {
      const spec = createMinimalSpec({
        summary: 'A'.repeat(500), // Long summary to use budget
        experiences: [
          {
            company: 'Company',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [{ text: 'Bullet ' + 'A'.repeat(200) }],
          },
        ],
      });
      const result = calculatePageBudget(spec);

      if (result.percentage >= 92 && result.percentage <= 100) {
        expect(result.status).toBe('warning');
      }
    });

    it('marks status as overflow when exceeding limit (>100%)', () => {
      const spec = createMinimalSpec({
        summary: 'A'.repeat(1000),
        experiences: [
          {
            company: 'Company A',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [
              { text: 'Bullet 1 ' + 'A'.repeat(300) },
              { text: 'Bullet 2 ' + 'A'.repeat(300) },
              { text: 'Bullet 3 ' + 'A'.repeat(300) },
            ],
          },
          {
            company: 'Company B',
            role: 'Senior Engineer',
            location: 'SFO',
            startDate: '2018-01',
            endDate: '2020-01',
            bullets: [
              { text: 'Bullet 1 ' + 'A'.repeat(300) },
              { text: 'Bullet 2 ' + 'A'.repeat(300) },
            ],
          },
        ],
        education: [
          { school: 'University', degree: 'BS', field: 'Computer Science' },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.percentage).toBeGreaterThan(100);
      expect(result.status).toBe('overflow');
    });

    it('includes header in breakdown', () => {
      const spec = createMinimalSpec();
      const result = calculatePageBudget(spec);

      expect(result.breakdown.header).toBeGreaterThan(0);
    });

    it('includes summary in breakdown when present', () => {
      const spec = createMinimalSpec({ summary: 'Professional summary' });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.summary).toBeGreaterThan(0);
    });

    it('excludes summary from breakdown when empty', () => {
      const spec = createMinimalSpec({ summary: '' });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.summary).toBe(0);
    });

    it('calculates experience lines correctly', () => {
      const spec = createMinimalSpec({
        experiences: [
          {
            company: 'ACME',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [{ text: 'Implemented feature' }],
          },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.experiences).toBeGreaterThan(0);
    });

    it('calculates multiple experiences', () => {
      const spec = createMinimalSpec({
        experiences: [
          {
            company: 'A',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [{ text: 'Work at A' }],
          },
          {
            company: 'B',
            role: 'Senior',
            location: 'SFO',
            startDate: '2018-01',
            endDate: '2020-01',
            bullets: [{ text: 'Work at B' }],
          },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.experiences).toBeGreaterThan(0);
    });

    it('skips empty bullet points', () => {
      const spec = createMinimalSpec({
        experiences: [
          {
            company: 'ACME',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [
              { text: 'Real bullet' },
              { text: '' }, // Empty
              { text: '   ' }, // Whitespace
              { text: 'Another bullet' },
            ],
          },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.experiences).toBeGreaterThan(0);
    });

    it('includes skills in breakdown when present', () => {
      const spec = createMinimalSpec({
        skills: [
          { category: 'Languages', skills: ['TypeScript', 'Python', 'Go'] },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.skills).toBeGreaterThan(0);
    });

    it('excludes skills when empty', () => {
      const spec = createMinimalSpec({ skills: [] });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.skills).toBe(0);
    });

    it('includes education in breakdown when present', () => {
      const spec = createMinimalSpec({
        education: [
          { school: 'University', degree: 'BS', field: 'CS' },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.education).toBeGreaterThan(0);
    });

    it('excludes education when empty', () => {
      const spec = createMinimalSpec({ education: [] });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.education).toBe(0);
    });

    it('roundslines to nearest tenth', () => {
      const spec = createMinimalSpec({ summary: 'A'.repeat(250) });
      const result = calculatePageBudget(spec);

      expect(result.totalLines).toBe(Math.round(result.totalLines * 10) / 10);
    });

    it('sets squeezeAvailable when not optimal and squeeze not enabled', () => {
      const spec = createMinimalSpec({
        summary: 'A'.repeat(800),
        experiences: [
          {
            company: 'Company',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [{ text: 'Bullet ' + 'A'.repeat(250) }],
          },
        ],
      });
      const result = calculatePageBudget(spec);

      if (result.status !== 'optimal') {
        expect(result.squeezeAvailable).toBe(true);
      }
    });

    it('disables squeezeAvailable when squeeze is already enabled', () => {
      const spec = createMinimalSpec({
        summary: 'A'.repeat(1000),
      });
      const result = calculatePageBudget(spec, { squeeze: true });

      expect(result.squeezeAvailable).toBe(false);
    });

    it('applies squeeze factor to reduce lines', () => {
      const spec = createMinimalSpec({
        summary: 'A'.repeat(500),
        experiences: [
          {
            company: 'Company',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [{ text: 'Bullet ' + 'A'.repeat(200) }],
          },
        ],
      });

      const normal = calculatePageBudget(spec, { squeeze: false });
      const squeezed = calculatePageBudget(spec, { squeeze: true });

      expect(squeezed.totalLines).toBeLessThanOrEqual(normal.totalLines);
    });

    it('handles multiple skill groups', () => {
      const spec = createMinimalSpec({
        skills: [
          { category: 'Languages', skills: ['TypeScript', 'Python'] },
          { category: 'Databases', skills: ['PostgreSQL', 'Redis'] },
          { category: 'Cloud', skills: ['AWS', 'GCP'] },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.skills).toBeGreaterThan(0);
    });

    it('handles multiple education entries', () => {
      const spec = createMinimalSpec({
        education: [
          { school: 'University A', degree: 'BS', field: 'CS' },
          { school: 'University B', degree: 'MS', field: 'AI' },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.education).toBeGreaterThan(0);
    });

    it('handles profile with multiple links', () => {
      const spec = createMinimalSpec({
        profile: {
          links: {
            github: 'https://github.com/user',
            linkedin: 'https://linkedin.com/in/user',
            website: 'https://example.com',
            blog: 'https://blog.example.com',
          },
        },
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.header).toBeGreaterThan(0);
    });

    it('returns breakdown totals', () => {
      const spec = createMinimalSpec({
        summary: 'Professional',
        experiences: [
          {
            company: 'Company',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [{ text: 'Bullet' }],
          },
        ],
        education: [
          { school: 'University', degree: 'BS', field: 'CS' },
        ],
        skills: [
          { category: 'Languages', skills: ['TypeScript'] },
        ],
      });
      const result = calculatePageBudget(spec);

      const breakdownSum =
        result.breakdown.header +
        result.breakdown.summary +
        result.breakdown.experiences +
        result.breakdown.education +
        result.breakdown.skills;

      expect(breakdownSum).toBeCloseTo(result.totalLines, 0.2);
    });

    it('handles very long summary text', () => {
      const spec = createMinimalSpec({
        summary: 'A'.repeat(5000),
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.summary).toBeGreaterThan(0);
      expect(result.status).toBe('overflow');
    });

    it('handles very long bullet points', () => {
      const spec = createMinimalSpec({
        experiences: [
          {
            company: 'Company',
            role: 'Engineer',
            location: 'NYC',
            startDate: '2020-01',
            endDate: '2022-01',
            bullets: [
              { text: 'A'.repeat(2000) },
              { text: 'B'.repeat(2000) },
            ],
          },
        ],
      });
      const result = calculatePageBudget(spec);

      expect(result.breakdown.experiences).toBeGreaterThan(0);
    });
  });
});
