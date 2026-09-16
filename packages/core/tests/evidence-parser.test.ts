import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseEvidenceMarkdown,
  parseEvidenceLedger,
  serializeEvidenceMarkdown,
  EvidenceStore,
  EvidenceParseError,
  EvidenceEntry,
} from '../src/index';

describe('Evidence Markdown Parser', () => {
  const validEntry: EvidenceEntry = {
    id: 'ev-042',
    date: '2026-04-12',
    company: 'cloudmatrix',
    title: 'Zero-Downtime Session Migration',
    summary: 'Architected token rotation protocol eliminating session invalidations during DB switch.',
    impact: 'Reduced user re-auth events by 99.4% across 140k active daily sessions.',
    themes: ['distributed-systems', 'reliability', 'auth'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 're-auth reduction', value: '99.4%', status: 'verified' },
    ],
    internal_references: [
      { type: 'linear', ref: 'AUTH-892' },
      { type: 'datadog', ref: 'MON-108' },
    ],
  };

  const sampleMarkdown = `---
id: ev-042
date: "2026-04-12"
company: cloudmatrix
title: Zero-Downtime Session Migration
summary: Architected token rotation protocol eliminating session invalidations during DB switch.
impact: Reduced user re-auth events by 99.4% across 140k active daily sessions.
themes:
  - distributed-systems
  - reliability
  - auth
confidence: verified
in_flight: false
metrics:
  - name: re-auth reduction
    value: "99.4%"
    status: verified
internal_references:
  - type: linear
    ref: AUTH-892
  - type: datadog
    ref: MON-108
---

### Narrative & Context
During the tenant database migration, auth tokens were being invalidated when connecting to the new cluster.

### Key Decisions
- Implemented a dual-key HMAC token rotation window.
- Ran load tests simulating 50k concurrent requests.
`;

  describe('parseEvidenceMarkdown', () => {
    it('parses valid markdown with frontmatter and narrative body', () => {
      const result = parseEvidenceMarkdown(sampleMarkdown);

      expect(result.entry.id).toBe('ev-042');
      expect(result.entry.company).toBe('cloudmatrix');
      expect(result.entry.title).toBe('Zero-Downtime Session Migration');
      expect(result.entry.confidence).toBe('verified');
      expect(result.entry.in_flight).toBe(false);
      expect(result.entry.themes).toEqual(['distributed-systems', 'reliability', 'auth']);
      expect(result.entry.metrics).toHaveLength(1);
      expect(result.entry.metrics[0]).toEqual({
        name: 're-auth reduction',
        value: '99.4%',
        status: 'verified',
      });
      expect(result.entry.internal_references).toHaveLength(2);

      expect(result.narrative).toContain('### Narrative & Context');
      expect(result.narrative).toContain('Implemented a dual-key HMAC token rotation window.');
    });

    it('handles unquoted YAML dates (e.g. 2026-04-12)', () => {
      const markdownWithUnquotedDate = sampleMarkdown.replace('date: "2026-04-12"', 'date: 2026-04-12');
      const result = parseEvidenceMarkdown(markdownWithUnquotedDate);
      expect(result.entry.date).toBe('2026-04-12');
    });

    it('defaults metrics and internal_references to empty arrays when omitted', () => {
      const minimalMarkdown = `---
id: ev-001
date: "2026-01-01"
company: apex-labs
title: Minimal Evidence
summary: A minimal entry.
impact: Low impact.
themes:
  - tooling
confidence: provisional
in_flight: true
---

Minimal narrative.
`;
      const result = parseEvidenceMarkdown(minimalMarkdown);
      expect(result.entry.metrics).toEqual([]);
      expect(result.entry.internal_references).toEqual([]);
      expect(result.narrative).toBe('Minimal narrative.');
    });

    it('handles empty markdown narrative body', () => {
      const noBodyMarkdown = `---
id: ev-002
date: "2026-01-02"
company: apex-labs
title: No Body
summary: No body here.
impact: None.
themes:
  - testing
confidence: verified
in_flight: false
---
`;
      const result = parseEvidenceMarkdown(noBodyMarkdown);
      expect(result.entry.id).toBe('ev-002');
      expect(result.narrative).toBe('');
    });
  });

  describe('parseEvidenceMarkdown error handling', () => {
    it('throws EvidenceParseError when YAML frontmatter is missing required fields', () => {
      const missingId = `---
date: "2026-04-12"
company: cloudmatrix
title: Missing ID
summary: Summary
impact: Impact
themes:
  - auth
confidence: verified
in_flight: false
---

Narrative
`;
      expect(() => parseEvidenceMarkdown(missingId)).toThrow(EvidenceParseError);
      expect(() => parseEvidenceMarkdown(missingId)).toThrow(/id/i);
    });

    it('throws EvidenceParseError when confidence value is invalid enum', () => {
      const invalidConfidence = sampleMarkdown.replace('confidence: verified', 'confidence: unsupported_value');
      expect(() => parseEvidenceMarkdown(invalidConfidence)).toThrow(EvidenceParseError);
      expect(() => parseEvidenceMarkdown(invalidConfidence)).toThrow(/confidence/i);
    });

    it('throws EvidenceParseError on malformed YAML syntax', () => {
      const malformedYaml = `---
id: ev-042
date: [unclosed bracket
---

Narrative
`;
      expect(() => parseEvidenceMarkdown(malformedYaml)).toThrow(EvidenceParseError);
    });

    it('throws EvidenceParseError when markdown has no frontmatter delimiters', () => {
      const noFrontmatter = '# Just a markdown file without frontmatter';
      expect(() => parseEvidenceMarkdown(noFrontmatter)).toThrow(EvidenceParseError);
    });

    it('includes filePath in error message when provided', () => {
      const missingCompany = `---
id: ev-003
date: "2026-01-01"
title: Missing Company
summary: Summary
impact: Impact
themes:
  - test
confidence: verified
in_flight: false
---
`;
      const testPath = 'companies/cloudmatrix/evidence/ev-003.md';
      expect(() => parseEvidenceMarkdown(missingCompany, testPath)).toThrow(/companies\/cloudmatrix\/evidence\/ev-003\.md/);
    });
  });

  describe('serializeEvidenceMarkdown and round-trip idempotency', () => {
    it('serializes an entry and narrative into YAML frontmatter markdown', () => {
      const narrative = '### Narrative\nImplemented feature.';
      const serialized = serializeEvidenceMarkdown(validEntry, narrative);

      expect(serialized).toMatch(/^---\n/);
      expect(serialized).toContain('id: ev-042');
      expect(serialized).toContain('company: cloudmatrix');
      expect(serialized).toContain('confidence: verified');
      expect(serialized).toContain('### Narrative\nImplemented feature.');
    });

    it('handles empty narrative serialization cleanly', () => {
      const serialized = serializeEvidenceMarkdown(validEntry, '');
      expect(serialized).toMatch(/^---\n/);
      expect(serialized).toContain('id: ev-042');

      const parsed = parseEvidenceMarkdown(serialized);
      expect(parsed.entry).toEqual(validEntry);
      expect(parsed.narrative).toBe('');
    });

    it('guarantees round-trip idempotency (parse -> serialize -> parse)', () => {
      const firstParse = parseEvidenceMarkdown(sampleMarkdown);
      const serialized = serializeEvidenceMarkdown(firstParse.entry, firstParse.narrative);
      const secondParse = parseEvidenceMarkdown(serialized);

      expect(secondParse.entry).toEqual(firstParse.entry);
      expect(secondParse.narrative).toBe(firstParse.narrative);

      // Multiple cycles produce identical output
      const secondSerialized = serializeEvidenceMarkdown(secondParse.entry, secondParse.narrative);
      expect(secondSerialized).toBe(serialized);
    });

    it('throws when trying to serialize an invalid entry', () => {
      const invalidEntry = { ...validEntry, id: '' } as any;
      delete invalidEntry.id;
      expect(() => serializeEvidenceMarkdown(invalidEntry, 'Narrative')).toThrow();
    });
  });

  describe('parseEvidenceLedger', () => {
    const sampleLedgerMarkdown = `# Evidence Ledger — Engineering Career

Some markdown intro paragraph before the YAML block.

\`\`\`yaml
meta:
  employer: CloudMatrix Inc.
  period_start: 2024-01-01
themes:
  - id: core-platform
    label: Core Platform
entries:
  - id: ev-001
    date: 2025-11-22
    theme_ids:
      - core-platform
    summary: "Standardized CI pipeline with automated integration tests."
    impact: "Reduced build failure rate by 80% across 40 engineers."
    url: "https://github.com/cloudmatrix/platform/pull/81"
    confidence: high
    in_flight: false

  - id: ev-002
    date: 2026-03-15
    theme_ids:
      - core-platform
    summary: "Built dynamic query caching."
    impact: "Accelerated dashboard load by [METRIC NEEDED]."
    confidence: medium
    in_flight: true
\`\`\`
`;

    it('parses embedded YAML ledger block with multiple entries', () => {
      const records = parseEvidenceLedger(sampleLedgerMarkdown, 'companies/cloudmatrix/evidence/evidence-ledger.md');
      expect(records).toHaveLength(2);

      const first = records[0];
      expect(first.entry.id).toBe('ev-001');
      expect(first.entry.company).toBe('cloudmatrix');
      expect(first.entry.confidence).toBe('verified');
      expect(first.entry.themes).toEqual(['core-platform']);
      expect(first.entry.internal_references).toEqual([
        { type: 'url', ref: 'https://github.com/cloudmatrix/platform/pull/81' },
      ]);
      expect(first.narrative).toContain('Standardized CI pipeline');

      const second = records[1];
      expect(second.entry.id).toBe('ev-002');
      expect(second.entry.confidence).toBe('provisional');
      expect(second.entry.in_flight).toBe(true);
      expect(second.entry.metrics).toHaveLength(1);
      expect(second.entry.metrics[0].value).toBe('[METRIC NEEDED]');
    });

    it('infers company from meta when filePath is not specified', () => {
      const records = parseEvidenceLedger(sampleLedgerMarkdown);
      expect(records[0].entry.company).toBe('cloudmatrix-inc-');
    });

    it('handles raw YAML format without markdown code fence', () => {
      const rawYaml = `meta:
  employer: apex-labs
entries:
  - id: apex-001
    summary: "API Gateway modularization."
    confidence: verified
`;
      const records = parseEvidenceLedger(rawYaml);
      expect(records).toHaveLength(1);
      expect(records[0].entry.id).toBe('apex-001');
      expect(records[0].entry.company).toBe('apex-labs');
    });

    it('returns empty array when content has no entries array', () => {
      const noEntries = '# Just a markdown note\nNo yaml here.';
      expect(parseEvidenceLedger(noEntries)).toEqual([]);
    });
  });
});

describe('EvidenceStore', () => {
  const entryA: EvidenceEntry = {
    id: 'ev-001',
    date: '2026-01-15',
    company: 'cloudmatrix',
    title: 'Authentication Session Hardening',
    summary: 'Prevented session hijacking and improved cookie security.',
    impact: 'Protected 100k active sessions with zero security regressions.',
    themes: ['security', 'auth'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 'active sessions', value: '100k', status: 'verified' },
    ],
    internal_references: [{ type: 'linear', ref: 'SEC-101' }],
  };

  const entryB: EvidenceEntry = {
    id: 'ev-002',
    date: '2026-03-20',
    company: 'cloudmatrix',
    title: 'High-Throughput Analytics Engine',
    summary: 'Built analytics query path connecting Flight SQL to donut charts.',
    impact: 'Accelerated dashboard load time by [METRIC NEEDED].',
    themes: ['frontend', 'query-layer'],
    confidence: 'provisional',
    in_flight: true,
    metrics: [
      { name: 'latency improvement', value: '[METRIC NEEDED]', status: 'METRIC NEEDED' },
    ],
    internal_references: [{ type: 'linear', ref: 'ANALYTICS-404' }],
  };

  const entryC: EvidenceEntry = {
    id: 'ev-003',
    date: '2025-10-10',
    company: 'apex-labs',
    title: 'Plugin System Refactor',
    summary: 'Modularized Gateway plugin configuration loading in TypeScript.',
    impact: 'Decreased startup time by 40%.',
    themes: ['dx', 'tooling'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 'startup time reduction', value: '40%', status: 'verified' },
    ],
    internal_references: [],
  };

  let store: EvidenceStore;

  beforeEach(() => {
    store = new EvidenceStore();
    store.add(entryA, 'Narrative for authentication hardening', 'companies/cloudmatrix/ev-001.md');
    store.add(entryB, 'Narrative for analytics engine query path', 'companies/cloudmatrix/ev-002.md');
    store.add(entryC, 'Narrative for apex plugin system', 'companies/apex-labs/ev-003.md');
  });

  describe('basic collection operations', () => {
    it('adds and retrieves entries by ID', () => {
      const record = store.get('ev-001');
      expect(record).toBeDefined();
      expect(record?.entry.id).toBe('ev-001');
      expect(record?.id).toBe('ev-001');
      expect(record?.narrative).toBe('Narrative for authentication hardening');
      expect(record?.filePath).toBe('companies/cloudmatrix/ev-001.md');
    });

    it('returns undefined for non-existent ID', () => {
      expect(store.get('ev-999')).toBeUndefined();
    });

    it('supports add with single record object argument', () => {
      const entryD: EvidenceEntry = {
        id: 'ev-004',
        date: '2026-05-01',
        company: 'cloudmatrix',
        title: 'New Feature',
        summary: 'Feature summary',
        impact: 'Feature impact',
        themes: ['frontend'],
        confidence: 'verified',
        in_flight: false,
        metrics: [],
        internal_references: [],
      };
      store.add({ entry: entryD, narrative: 'Feature narrative', filePath: 'path/ev-004.md' });
      expect(store.get('ev-004')?.title).toBe('New Feature');
    });

    it('removes entries by ID', () => {
      expect(store.size).toBe(3);
      const removed = store.remove('ev-002');
      expect(removed).toBe(true);
      expect(store.size).toBe(2);
      expect(store.get('ev-002')).toBeUndefined();

      // Removing already deleted ID returns false
      expect(store.remove('ev-002')).toBe(false);
    });

    it('reports correct size and getAll list', () => {
      expect(store.size).toBe(3);
      const all = store.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.id).sort()).toEqual(['ev-001', 'ev-002', 'ev-003']);
    });

    it('clears all entries', () => {
      store.clear();
      expect(store.size).toBe(0);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('query filters', () => {
    it('returns all entries when no filters are provided', () => {
      const results = store.query();
      expect(results).toHaveLength(3);
    });

    it('filters by company (case-insensitive)', () => {
      const cloudmatrixEntries = store.query({ company: 'cloudmatrix' });
      expect(cloudmatrixEntries).toHaveLength(2);
      expect(cloudmatrixEntries.map((e) => e.id)).toEqual(['ev-001', 'ev-002']);

      const apexEntries = store.query({ company: 'APEX-LABS' });
      expect(apexEntries).toHaveLength(1);
      expect(apexEntries[0].id).toBe('ev-003');
    });

    it('filters by theme', () => {
      const authEntries = store.query({ theme: 'auth' });
      expect(authEntries).toHaveLength(1);
      expect(authEntries[0].id).toBe('ev-001');

      const dxEntries = store.query({ theme: 'dx' });
      expect(dxEntries).toHaveLength(1);
      expect(dxEntries[0].id).toBe('ev-003');

      const missingTheme = store.query({ theme: 'nonexistent' });
      expect(missingTheme).toHaveLength(0);
    });

    it('filters by confidence level', () => {
      const verified = store.query({ confidence: 'verified' });
      expect(verified).toHaveLength(2);
      expect(verified.map((e) => e.id)).toEqual(['ev-001', 'ev-003']);

      const provisional = store.query({ confidence: 'provisional' });
      expect(provisional).toHaveLength(1);
      expect(provisional[0].id).toBe('ev-002');
    });

    it('filters by inFlight flag', () => {
      const inFlightTrue = store.query({ inFlight: true });
      expect(inFlightTrue).toHaveLength(1);
      expect(inFlightTrue[0].id).toBe('ev-002');

      const inFlightFalse = store.query({ inFlight: false });
      expect(inFlightFalse).toHaveLength(2);
      expect(inFlightFalse.map((e) => e.id)).toEqual(['ev-001', 'ev-003']);
    });

    it('filters by hasMissingMetrics', () => {
      const missingMetrics = store.query({ hasMissingMetrics: true });
      expect(missingMetrics).toHaveLength(1);
      expect(missingMetrics[0].id).toBe('ev-002');

      const verifiedMetrics = store.query({ hasMissingMetrics: false });
      expect(verifiedMetrics).toHaveLength(2);
      expect(verifiedMetrics.map((e) => e.id)).toEqual(['ev-001', 'ev-003']);
    });

    it('combines multiple filters conjunctively', () => {
      const combined = store.query({
        company: 'cloudmatrix',
        confidence: 'verified',
        inFlight: false,
      });
      expect(combined).toHaveLength(1);
      expect(combined[0].id).toBe('ev-001');

      const emptyMatch = store.query({
        company: 'apex-labs',
        theme: 'security',
      });
      expect(emptyMatch).toHaveLength(0);
    });
  });

  describe('full-text search and keyword matching', () => {
    it('searches by keyword in title', () => {
      const results = store.query({ search: 'Authentication' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-001');
    });

    it('searches by keyword in summary', () => {
      const results = store.query({ search: 'Flight SQL' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-002');
    });

    it('searches by keyword in impact', () => {
      const results = store.query({ search: 'startup time' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-003');
    });

    it('searches by keyword in narrative body', () => {
      const results = store.query({ search: 'analytics engine query path' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-002');
    });

    it('performs case-insensitive matching', () => {
      const results = store.query({ search: 'MODULARIZED' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-003');
    });

    it('supports standalone search method', () => {
      const results = store.search('session hijacking');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-001');
    });

    it('combines full-text search with structured filters', () => {
      const results = store.query({
        search: 'session',
        company: 'cloudmatrix',
        confidence: 'verified',
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ev-001');

      // Search matches ev-001, but company filter excludes it
      const noResults = store.query({
        search: 'session',
        company: 'apex-labs',
      });
      expect(noResults).toHaveLength(0);
    });

    it('returns empty array when search query matches nothing', () => {
      const results = store.query({ search: 'blockchain quantum computing' });
      expect(results).toHaveLength(0);
    });
  });
});
