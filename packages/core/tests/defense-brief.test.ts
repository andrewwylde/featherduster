import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceStore,
  compileDefenseBrief,
  compileHtmlDefenseBrief,
  calculatePageBudget,
  ResumeSpec,
} from '../src/index.js';

describe('Defense Brief & Page Budget Compilers', () => {
  let store: EvidenceStore;
  let sampleSpec: ResumeSpec;

  beforeEach(() => {
    store = new EvidenceStore();
    store.add({
      entry: {
        id: 'ev-042',
        date: '2026-03-12',
        company: 'CloudMatrix',
        title: 'Zero-Downtime Partition Sharding',
        summary: 'Architected dynamic consistent hashing controller eliminating partition hotspots.',
        impact: 'Reduced p99 tail latency from 850ms to 42ms across 14M active tenant accounts.',
        confidence: 'verified',
        in_flight: false,
        metrics: [
          { name: 'p99 latency reduction', value: '95% (808ms)', status: 'verified' },
        ],
        internal_references: [
          { type: 'ticket', ref: 'AUTH-892' },
          { type: 'pr', ref: '#2914' },
        ],
      },
      narrative: 'Implemented consistent hashing ring with virtual nodes. Ran shadow traffic for 48 hours.',
      filePath: 'evidence/cloudmatrix/ev-042.md',
    });

    sampleSpec = {
      profile: {
        name: 'Alex Mercer',
        title: 'Staff Software Engineer',
        email: 'alex@example.com',
        phone: '+1 555-0199',
        location: 'San Francisco, CA',
        links: { github: 'https://github.com/alex' },
      },
      summary: 'Staff distributed systems architect specializing in high-throughput data infrastructure.',
      experiences: [
        {
          company: 'CloudMatrix',
          role: 'Staff Engineer',
          startDate: '2024',
          endDate: 'Present',
          location: 'San Francisco, CA',
          bullets: [
            {
              text: 'Architected dynamic consistent hashing controller eliminating partition hotspots (ev-042).',
              citations: ['ev-042'],
            },
            {
              text: 'Mentored 6 junior engineers on distributed systems debugging and telemetry.',
            },
          ],
        },
      ],
      education: [
        { institution: 'UC Berkeley', degree: 'B.S. in Electrical Engineering & Computer Science', year: '2019' },
      ],
      skills: [
        { category: 'Languages', skills: ['Go', 'Rust', 'TypeScript', 'Python'] },
        { category: 'Systems', skills: ['Kafka', 'Distributed Systems', 'Raft'] },
      ],
    };
  });

  describe('compileDefenseBrief', () => {
    it('compiles a structured defense brief with role context and keyword alignment', () => {
      const output = compileDefenseBrief(sampleSpec, store, {
        targetCompany: 'Netflix',
        targetRole: 'Staff Platform Engineer',
        matchedKeywords: ['Kafka', 'Distributed Systems', 'Go'],
        missingKeywords: ['eBPF', 'gRPC'],
      });

      expect(output).toContain('# 🛡️ Interview Defense Brief: Alex Mercer');
      expect(output).toContain('**Target Role:** Staff Platform Engineer at Netflix');
      expect(output).toContain('`Kafka` · `Distributed Systems` · `Go`');
      expect(output).toContain('eBPF');
      expect(output).toContain('CloudMatrix — Staff Engineer');
      expect(output).toContain('Zero-Downtime Partition Sharding');
      expect(output).toContain('AUTH-892');
      expect(output).toContain('#2914');
      expect(output).toContain('95% (808ms)');
      expect(output).toContain('Implemented consistent hashing ring');
      expect(output).toContain('Anticipated Interview Deep-Dives');
      expect(output).toContain('⚠️ *No explicit citation attached.*');
      expect(output).toContain('50% coverage');
    });

    it('handles specs with missing citations gracefully', () => {
      const output = compileDefenseBrief(sampleSpec, store);
      expect(output).toContain('Interview Defense Brief: Alex Mercer');
      expect(output).toContain('Dossier Audit Statistics');
    });
  });

  describe('compileHtmlDefenseBrief', () => {
    it('compiles styled, print-ready HTML defense brief with all sections and metadata', () => {
      const html = compileHtmlDefenseBrief(sampleSpec, store, {
        targetCompany: 'Netflix',
        targetRole: 'Staff Platform Engineer',
        matchedKeywords: ['Kafka', 'Distributed Systems', 'Go'],
        missingKeywords: ['eBPF', 'gRPC'],
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Interview Defense Brief - Alex Mercer</title>');
      expect(html).toContain('STRICTLY CONFIDENTIAL · INTERVIEW DEFENSE DOSSIER');
      expect(html).toContain('Staff Platform Engineer at Netflix');
      expect(html).toContain('Kafka');
      expect(html).toContain('eBPF');
      expect(html).toContain('CloudMatrix — Staff Engineer');
      expect(html).toContain('Zero-Downtime Partition Sharding');
      expect(html).toContain('ev-042');
      expect(html).toContain('✅ Verified');
      expect(html).toContain('AUTH-892');
      expect(html).toContain('#2914');
      expect(html).toContain('95% (808ms)');
      expect(html).toContain('Anticipated Interview Deep-Dives');
      expect(html).toContain('Technical Trade-offs:');
      expect(html).toContain('Failure Modes:');
      expect(html).toContain('Metric Attribution:');
      expect(html).toContain('Dossier Audit Statistics');
      expect(html).toContain('50%');
      expect(html).toContain('@media print');
    });

    it('escapes special characters and prevents HTML injection', () => {
      const injectedSpec: ResumeSpec = {
        ...sampleSpec,
        profile: {
          ...sampleSpec.profile,
          name: '<script>alert("pwned")</script>',
        },
      };

      const html = compileHtmlDefenseBrief(injectedSpec, store);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
    });
  });

  describe('calculatePageBudget', () => {
    it('calculates page budget and returns optimal status for reasonable resume', () => {
      const budget = calculatePageBudget(sampleSpec);
      expect(budget.totalLines).toBeGreaterThan(10);
      expect(budget.totalLines).toBeLessThan(budget.maxBudget);
      expect(budget.status).toBe('optimal');
      expect(budget.percentage).toBeLessThan(92);
      expect(budget.breakdown.header).toBeGreaterThan(0);
      expect(budget.breakdown.experiences).toBeGreaterThan(0);
    });

    it('detects overflow when many experiences and bullets are added', () => {
      const heavySpec: ResumeSpec = {
        ...sampleSpec,
        experiences: Array.from({ length: 8 }).map((_, idx) => ({
          company: `Company ${idx}`,
          role: 'Senior Engineer',
          startDate: '2020',
          endDate: '2022',
          bullets: [
            { text: 'Engineered high throughput distributed data pipelines with sub-millisecond tail latency and fault-tolerant partitions across multi-cloud regions.' },
            { text: 'Spearheaded automated regression testing and live invariant verification framework for mission critical production clusters.' },
            { text: 'Collaborated across cross-functional product teams to design scalable domain boundary APIs and event driven microservice contracts.' },
          ],
        })),
      };

      const budget = calculatePageBudget(heavySpec);
      expect(budget.totalLines).toBeGreaterThan(50);
      expect(budget.status).toBe('overflow');
      expect(budget.percentage).toBeGreaterThan(100);

      // Squeeze should reduce lines
      const squeezed = calculatePageBudget(heavySpec, { squeeze: true });
      expect(squeezed.totalLines).toBeLessThan(budget.totalLines);
    });
  });
});
