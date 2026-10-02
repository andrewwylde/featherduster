import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceVectorIndex,
  EvidenceStore,
  EvidenceRecord,
  cosineSimilarity,
  tokenizeText,
} from '../src/index.js';

describe('Local Air-Gapped Vector Index & Semantic Search', () => {
  let index: EvidenceVectorIndex;
  let records: EvidenceRecord[];

  beforeEach(() => {
    index = new EvidenceVectorIndex(256);
    records = [
      {
        id: 'ev-001',
        date: '2026-01-15',
        company: 'CloudMatrix',
        title: 'Distributed Token Issuance Mesh',
        summary: 'Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
        impact: 'Eliminated auth token bottlenecks across 25M active edge sessions.',
        themes: ['distributed-systems', 'auth', 'performance'],
        confidence: 'verified',
        in_flight: false,
        metrics: [{ name: 'latency', value: '8ms', status: 'verified' }],
        internal_references: [{ type: 'linear', ref: 'AUTH-101' }],
        narrative: 'Built consistent hashing ring with mutual TLS authentication and edge caching.',
        entry: {
          id: 'ev-001',
          date: '2026-01-15',
          company: 'CloudMatrix',
          title: 'Distributed Token Issuance Mesh',
          summary: 'Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
          impact: 'Eliminated auth token bottlenecks across 25M active edge sessions.',
          themes: ['distributed-systems', 'auth', 'performance'],
          confidence: 'verified',
          in_flight: false,
          metrics: [{ name: 'latency', value: '8ms', status: 'verified' }],
          internal_references: [{ type: 'linear', ref: 'AUTH-101' }],
        },
      },
      {
        id: 'ev-002',
        date: '2026-02-20',
        company: 'CloudMatrix',
        title: 'Zero-Downtime PostgreSQL Partition Sharding',
        summary: 'Implemented dynamic database sharding eliminating hotspot partition stalls.',
        impact: 'Zero data loss and zero downtime during 12TB multi-region migration.',
        themes: ['database', 'reliability', 'storage'],
        confidence: 'verified',
        in_flight: false,
        metrics: [{ name: 'data loss', value: '0', status: 'verified' }],
        internal_references: [{ type: 'linear', ref: 'DATA-202' }],
        narrative: 'Used logical replication and shadow writes to dual-write tables before cutover.',
        entry: {
          id: 'ev-002',
          date: '2026-02-20',
          company: 'CloudMatrix',
          title: 'Zero-Downtime PostgreSQL Partition Sharding',
          summary: 'Implemented dynamic database sharding eliminating hotspot partition stalls.',
          impact: 'Zero data loss and zero downtime during 12TB multi-region migration.',
          themes: ['database', 'reliability', 'storage'],
          confidence: 'verified',
          in_flight: false,
          metrics: [{ name: 'data loss', value: '0', status: 'verified' }],
          internal_references: [{ type: 'linear', ref: 'DATA-202' }],
        },
      },
      {
        id: 'ev-003',
        date: '2026-03-10',
        company: 'DevFlow',
        title: 'Continuous Deployment Pipeline Automation',
        summary: 'Redesigned Docker and Kubernetes CI/CD workflows for monorepo development.',
        impact: 'Cut build and deploy cycle times from 45 minutes down to 4 minutes.',
        themes: ['devops', 'tooling', 'kubernetes'],
        confidence: 'provisional',
        in_flight: true,
        metrics: [{ name: 'deploy time', value: '4m', status: 'verified' }],
        internal_references: [{ type: 'github', ref: '#512' }],
        narrative: 'Implemented remote Docker build cache layers and parallel test matrix runner.',
        entry: {
          id: 'ev-003',
          date: '2026-03-10',
          company: 'DevFlow',
          title: 'Continuous Deployment Pipeline Automation',
          summary: 'Redesigned Docker and Kubernetes CI/CD workflows for monorepo development.',
          impact: 'Cut build and deploy cycle times from 45 minutes down to 4 minutes.',
          themes: ['devops', 'tooling', 'kubernetes'],
          confidence: 'provisional',
          in_flight: true,
          metrics: [{ name: 'deploy time', value: '4m', status: 'verified' }],
          internal_references: [{ type: 'github', ref: '#512' }],
        },
      },
    ];
  });

  describe('tokenizeText & cosineSimilarity primitives', () => {
    it('normalizes tokens, strips stop words, and creates bigrams', () => {
      const tokens = tokenizeText('Distributed Systems and High Throughput');
      expect(tokens).toContain('distributed');
      expect(tokens).toContain('systems');
      expect(tokens).toContain('throughput');
      expect(tokens).toContain('distributed_systems');
      expect(tokens).not.toContain('and');
    });

    it('computes exact cosine similarity bounded between 0 and 1', () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);

      const vecOrthogonal = [0, 1, 0];
      expect(cosineSimilarity(vecA, vecOrthogonal)).toBe(0);

      const vecPartial = [1, 1, 0];
      expect(cosineSimilarity(vecA, vecPartial)).toBeCloseTo(0.707, 2);
    });
  });

  describe('EvidenceVectorIndex embedding & indexing', () => {
    it('generates deterministic unit-normalized embeddings of the specified dimension', () => {
      const vec1 = index.embedText('Distributed Consensus and Raft');
      const vec2 = index.embedText('Distributed Consensus and Raft');

      expect(vec1).toHaveLength(256);
      expect(vec1).toEqual(vec2);

      // Verify unit L2 norm
      const norm = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 4);
    });

    it('adds and indexes records with weighted embeddings', () => {
      index.addMany(records);
      expect(index.size).toBe(3);

      const vec = index.getVector('ev-001');
      expect(vec).toBeDefined();
      expect(vec).toHaveLength(256);
    });

    it('removes records from index and clears cleanly', () => {
      index.addMany(records);
      expect(index.remove('ev-001')).toBe(true);
      expect(index.size).toBe(2);
      expect(index.getVector('ev-001')).toBeUndefined();

      index.clear();
      expect(index.size).toBe(0);
    });
  });

  describe('Semantic nearest-neighbor retrieval for target job descriptions', () => {
    it('ranks database and migration evidence highest for database posting', () => {
      index.addMany(records);

      const targetJd = `
        We are seeking a Staff Infrastructure Engineer to lead our multi-region
        PostgreSQL database migrations, logical sharding, and high-availability storage
        with zero downtime and zero data loss.
      `;

      const results = index.search(targetJd);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Top result must be ev-002 (PostgreSQL Partition Sharding)
      expect(results[0].record.id).toBe('ev-002');
      expect(results[0].score).toBeGreaterThan(0.25);
      expect(results[0].matchedTokens.length).toBeGreaterThan(0);
      expect(results[0].matchedThemes).toContain('database');
    });

    it('ranks token and edge authentication mesh highest for security / auth posting', () => {
      index.addMany(records);

      const authJd = `
        Looking for a Senior Distributed Systems Engineer to optimize low-latency
        token authentication, edge proxy routing, and cryptographic session management.
      `;

      const results = index.search(authJd);
      expect(results[0].record.id).toBe('ev-001');
      expect(results[0].matchedThemes).toContain('auth');
    });

    it('ranks CI/CD and Kubernetes highest for platform DevOps posting', () => {
      index.addMany(records);

      const devopsJd = `
        Staff Platform Engineer: Lead developer productivity, Docker build caching,
        and automated Kubernetes deployment pipelines across our engineering teams.
      `;

      const results = index.search(devopsJd);
      expect(results[0].record.id).toBe('ev-003');
      expect(results[0].matchedThemes).toContain('kubernetes');
    });

    it('respects structured metadata filters combined with vector search', () => {
      index.addMany(records);

      // Query database, but filter by confidence=provisional (which ev-002 is NOT)
      const filteredResults = index.search('database sharding and migration', {
        filters: { confidence: 'provisional' },
      });

      // ev-002 is verified, so it must be excluded
      expect(filteredResults.some((r) => r.record.id === 'ev-002')).toBe(false);

      // Filter by company
      const devFlowResults = index.search('pipeline', {
        filters: { company: 'DevFlow' },
      });
      expect(devFlowResults.every((r) => r.record.company === 'DevFlow')).toBe(true);
    });

    it('returns empty results when query is empty or unrelated with high minScore threshold', () => {
      index.addMany(records);
      expect(index.search('')).toEqual([]);
      expect(index.search('quantum gravity astronaut lunar rover', { minScore: 0.9 })).toEqual([]);
    });
  });

  describe('Serialization and Index Rehydration', () => {
    it('serializes to JSON and rehydrates with identical vector scores', () => {
      index.addMany(records);
      const query = 'PostgreSQL database sharding zero downtime';

      const originalResults = index.search(query);

      const serialized = index.toJSON();
      expect(serialized.dimensions).toBe(256);
      expect(serialized.docCount).toBe(3);
      expect(serialized.entries).toHaveLength(3);

      const rehydrated = EvidenceVectorIndex.fromJSON(serialized, records);
      expect(rehydrated.size).toBe(3);

      const rehydratedResults = rehydrated.search(query);
      expect(rehydratedResults[0].record.id).toBe(originalResults[0].record.id);
      expect(rehydratedResults[0].score).toBeCloseTo(originalResults[0].score, 2);
    });
  });

  describe('EvidenceStore Semantic Vector Search Integration', () => {
    it('seamlessly integrates vector search directly into EvidenceStore', () => {
      const store = new EvidenceStore();
      for (const rec of records) {
        store.add(rec);
      }

      const results = store.semanticSearch('distributed token mesh p99 latency');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].record.id).toBe('ev-001');

      // Removing from store updates vector index
      store.remove('ev-001');
      const updatedResults = store.semanticSearch('distributed token mesh p99 latency');
      expect(updatedResults.some((r) => r.record.id === 'ev-001')).toBe(false);

      // Clearing store clears vector index
      store.clear();
      expect(store.semanticSearch('database').length).toBe(0);
    });
  });
});
