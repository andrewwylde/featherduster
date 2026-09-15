import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceStore,
  EvidenceEntry,
  PrivacyRulesConfig,
  lintCitations,
  validateMetrics,
  redactText,
} from '../src/index';

describe('Integrity & Redaction Engine', () => {
  let store: EvidenceStore;

  const verifiedEntry: EvidenceEntry = {
    id: 'ev-001',
    date: '2026-01-15',
    company: 'acme-corp',
    title: 'Core Database Migration',
    summary: 'Migrated primary cluster from Mongo to Postgres.',
    impact: 'Reduced p99 latency by 45%.',
    themes: ['database', 'performance'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 'latency reduction', value: '45%', status: 'verified' },
    ],
    internal_references: [
      { type: 'jira', ref: 'DB-101' },
    ],
  };

  const provisionalEntry: EvidenceEntry = {
    id: 'ev-002',
    date: '2026-02-20',
    company: 'acme-corp',
    title: 'Distributed Caching Layer',
    summary: 'Introduced Redis caching for hot user profiles.',
    impact: 'Estimated 30% reduction in database read load.',
    themes: ['caching', 'infrastructure'],
    confidence: 'provisional',
    in_flight: true,
    metrics: [
      { name: 'read load reduction', value: '30%', status: 'unverified' },
    ],
    internal_references: [
      { type: 'linear', ref: 'AUTH-892' },
    ],
  };

  const retractedEntry: EvidenceEntry = {
    id: 'ev-003',
    date: '2026-03-01',
    company: 'acme-corp',
    title: 'Experimental Graph Query Engine',
    summary: 'Prototyped GraphQL federation layer.',
    impact: 'Rolled back due to memory overhead and schema synchronization limits.',
    themes: ['graphql', 'experimental'],
    confidence: 'retracted',
    in_flight: false,
    metrics: [],
    internal_references: [
      { type: 'linear', ref: 'WA-AU-018' },
    ],
  };

  const unverifiedMetricEntry: EvidenceEntry = {
    id: 'ev-004',
    date: '2026-03-15',
    company: 'acme-corp',
    title: 'Async Event Pipeline',
    summary: 'Implemented Kafka consumer groups for notifications.',
    impact: 'Throughput increased significantly [METRIC NEEDED].',
    themes: ['events', 'streaming'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 'notification latency', value: '[METRIC NEEDED]', status: 'pending' },
    ],
    internal_references: [],
  };

  beforeEach(() => {
    store = new EvidenceStore();
    store.add(verifiedEntry, 'Verified entry narrative');
    store.add(provisionalEntry, 'Provisional entry narrative');
    store.add(retractedEntry, 'Retracted entry narrative');
    store.add(unverifiedMetricEntry, 'Unverified metric narrative');
  });

  describe('lintCitations', () => {
    it('returns isClean true and empty arrays when text contains no citations', () => {
      const text = 'Led engineering team delivering reliable cloud architecture.';
      const result = lintCitations(text, store);

      expect(result).toEqual({
        validCitations: [],
        danglingCitations: [],
        isClean: true,
      });
    });

    it('extracts valid citations wrapped in parentheses e.g. (ev-001)', () => {
      const text = 'Completed primary database migration (ev-001) successfully.';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual(['ev-001']);
      expect(result.danglingCitations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('extracts valid citations without parentheses e.g. ev-001', () => {
      const text = 'Refer to evidence ev-001 and ev-002 for project background.';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual(['ev-001', 'ev-002']);
      expect(result.danglingCitations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('identifies dangling citations not in EvidenceStore', () => {
      const text = 'Pioneered zero-knowledge auth protocol (ev-999).';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual([]);
      expect(result.danglingCitations).toEqual(['ev-999']);
      expect(result.isClean).toBe(false);
    });

    it('handles mixed valid and dangling citations', () => {
      const text = 'Built migration engine (ev-001), experimental caching (ev-002), and missing item (ev-404).';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual(['ev-001', 'ev-002']);
      expect(result.danglingCitations).toEqual(['ev-404']);
      expect(result.isClean).toBe(false);
    });

    it('deduplicates citations referenced multiple times', () => {
      const text = 'Database migration (ev-001) was crucial. Again, ev-001 resolved latency. Also missing ev-999 and (ev-999).';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual(['ev-001']);
      expect(result.danglingCitations).toEqual(['ev-999']);
      expect(result.isClean).toBe(false);
    });

    it('matches citations case-insensitively and normalizes to lowercase', () => {
      const text = 'Referencing (EV-001) and EV-002.';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual(['ev-001', 'ev-002']);
      expect(result.danglingCitations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('does not match non-citation tokens', () => {
      const text = 'Check dev-001, whatever-001, ev-12, ev-1234, and previous-ev-001.';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual([]);
      expect(result.danglingCitations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('extracts multiple citations in a single parenthetical list', () => {
      const text = 'Combined architecture initiative (ev-001, ev-002).';
      const result = lintCitations(text, store);

      expect(result.validCitations).toEqual(['ev-001', 'ev-002']);
      expect(result.danglingCitations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('marks all citations as dangling when store is empty', () => {
      const emptyStore = new EvidenceStore();
      const text = 'Referencing (ev-001) in an empty store.';
      const result = lintCitations(text, emptyStore);

      expect(result.validCitations).toEqual([]);
      expect(result.danglingCitations).toEqual(['ev-001']);
      expect(result.isClean).toBe(false);
    });
  });

  describe('validateMetrics', () => {
    it('returns isClean true and empty issues for text without issues', () => {
      const text = 'Led project to improve system reliability (ev-001).';
      const result = validateMetrics(text, store);

      expect(result.isClean).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('detects explicit [METRIC NEEDED] tokens with line numbers', () => {
      const text = 'Line 1: High availability setup.\nLine 2: Reduced server costs by [METRIC NEEDED].';
      const result = validateMetrics(text);

      expect(result.isClean).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        type: 'missing_metric',
        line: 2,
      });
      expect(result.issues[0].message).toContain('[METRIC NEEDED]');
    });

    it('detects multiple [METRIC NEEDED] tokens across multiple lines', () => {
      const text = '[METRIC NEEDED] on first line\nSecond line clean\n[METRIC NEEDED] on third line';
      const result = validateMetrics(text);

      expect(result.isClean).toBe(false);
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].line).toBe(1);
      expect(result.issues[1].line).toBe(3);
    });

    it('flags claims citing provisional evidence with provisional_evidence issue', () => {
      const text = 'Rolled out caching layer across clusters (ev-002).';
      const result = validateMetrics(text, store);

      expect(result.isClean).toBe(false);
      const provisionalIssue = result.issues.find((i) => i.type === 'provisional_evidence');
      expect(provisionalIssue).toBeDefined();
      expect(provisionalIssue?.line).toBe(1);
      expect(provisionalIssue?.message).toContain('ev-002');
    });

    it('flags claims citing retracted evidence with retracted_evidence issue', () => {
      const text = 'Evaluated graph query prototype (ev-003).';
      const result = validateMetrics(text, store);

      expect(result.isClean).toBe(false);
      const retractedIssue = result.issues.find((i) => i.type === 'retracted_evidence');
      expect(retractedIssue).toBeDefined();
      expect(retractedIssue?.line).toBe(1);
      expect(retractedIssue?.message).toContain('ev-003');
    });

    it('flags claims citing evidence entries that have unverified or pending metrics', () => {
      const text = 'Implemented async event pipeline (ev-004).';
      const result = validateMetrics(text, store);

      expect(result.isClean).toBe(false);
      const metricIssue = result.issues.find((i) => i.type === 'missing_metric');
      expect(metricIssue).toBeDefined();
      expect(metricIssue?.line).toBe(1);
      expect(metricIssue?.message).toContain('ev-004');
    });

    it('handles store without matching citation without crashing', () => {
      const text = 'Citing unknown evidence (ev-999).';
      const result = validateMetrics(text, store);

      expect(result.isClean).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('combines multiple issue types across multiple lines', () => {
      const text = [
        'Migrated database with 45% latency improvement (ev-001).',
        'Added Redis caching layer (ev-002).',
        'Shipped notifications with latency of [METRIC NEEDED].',
        'Tested GraphQL federation layer (ev-003).',
      ].join('\n');

      const result = validateMetrics(text, store);

      expect(result.isClean).toBe(false);
      expect(result.issues.some((i) => i.type === 'provisional_evidence' && i.line === 2)).toBe(true);
      expect(result.issues.some((i) => i.type === 'missing_metric' && i.line === 3)).toBe(true);
      expect(result.issues.some((i) => i.type === 'retracted_evidence' && i.line === 4)).toBe(true);
    });

    it('works correctly when store is omitted', () => {
      const text = 'Scalability improvements yielded [METRIC NEEDED] gains.';
      const result = validateMetrics(text);

      expect(result.isClean).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('missing_metric');
    });
  });

  describe('redactText', () => {
    const defaultRules: PrivacyRulesConfig = {
      strip_patterns: ['AUTH-\\d+', 'WA-AU-\\d+', 'DB-\\d+'],
      replacements: [
        { search: 'Fortune 50 Bank X', replace: 'a global tier-1 financial institution' },
        { search: 'Acme Corp', replace: 'a high-growth B2B SaaS platform' },
      ],
      banned_keywords: ['Project Titan', 'confidential', 'internal-only'],
    };

    it('returns unchanged text and isClean true when no rules match and no violations exist', () => {
      const text = 'Designed distributed database architecture for high availability.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe(text);
      expect(result.violations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('strips citation tags like (ev-042) and normalizes spacing cleanly', () => {
      const text = 'Engineered token rotation protocol (ev-042) eliminating invalidations.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Engineered token rotation protocol eliminating invalidations.');
      expect(result.violations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('strips citation tags at sentence boundaries without leaving spaces before punctuation', () => {
      const text = 'Architected zero-downtime database switch (ev-001).';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Architected zero-downtime database switch.');
      expect(result.isClean).toBe(true);
    });

    it('strips citation tags at the beginning of lines', () => {
      const text = '(ev-001) Led database migration across multiple availability zones.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Led database migration across multiple availability zones.');
      expect(result.isClean).toBe(true);
    });

    it('strips citation tags without parentheses e.g. ev-001', () => {
      const text = 'Delivered under ev-001 for high reliability.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Delivered under for high reliability.');
      expect(result.isClean).toBe(true);
    });

    it('strips ticket IDs according to strip_patterns', () => {
      const text = 'Resolved incident in AUTH-892 and verified via WA-AU-018 in production.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Resolved incident in and verified via in production.');
      expect(result.isClean).toBe(true);
    });

    it('strips parenthesized ticket IDs cleanly', () => {
      const text = 'Fixed session invalidation bug (AUTH-892) before customer launch.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Fixed session invalidation bug before customer launch.');
      expect(result.isClean).toBe(true);
    });

    it('replaces confidential client or partner names using replacements dictionary', () => {
      const text = 'Deployed authentication system for Fortune 50 Bank X with 99.99% uptime.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Deployed authentication system for a global tier-1 financial institution with 99.99% uptime.');
      expect(result.isClean).toBe(true);
    });

    it('handles case-insensitive replacements', () => {
      const text = 'Contracted with fortune 50 bank x on fraud detection.';
      const result = redactText(text, defaultRules);

      expect(result.redactedText).toBe('Contracted with a global tier-1 financial institution on fraud detection.');
      expect(result.isClean).toBe(true);
    });

    it('detects banned_keywords and includes them in violations with isClean false', () => {
      const text = 'Architected the core system under Project Titan with confidential specs.';
      const result = redactText(text, defaultRules);

      expect(result.isClean).toBe(false);
      expect(result.violations).toContain('Project Titan');
      expect(result.violations).toContain('confidential');
    });

    it('does not flag banned keywords if they were safely replaced by a replacement rule', () => {
      const customRules: PrivacyRulesConfig = {
        strip_patterns: [],
        replacements: [
          { search: 'Project Titan', replace: 'Platform Overhaul' },
        ],
        banned_keywords: ['Project Titan'],
      };

      const text = 'Lead engineer for Project Titan delivery.';
      const result = redactText(text, customRules);

      expect(result.redactedText).toBe('Lead engineer for Platform Overhaul delivery.');
      expect(result.violations).toEqual([]);
      expect(result.isClean).toBe(true);
    });

    it('handles multiline documents with combined stripping, replacement, and violations', () => {
      const multilineText = [
        '## Executive Summary (ev-001)',
        'Delivered scalable auth for Fortune 50 Bank X under ticket DB-101.',
        'This initiative contained confidential trade secrets.',
      ].join('\n');

      const result = redactText(multilineText, defaultRules);

      expect(result.redactedText).toContain('## Executive Summary');
      expect(result.redactedText).not.toContain('ev-001');
      expect(result.redactedText).toContain('a global tier-1 financial institution');
      expect(result.redactedText).not.toContain('DB-101');
      expect(result.violations).toEqual(['confidential']);
      expect(result.isClean).toBe(false);
    });
  });
});
