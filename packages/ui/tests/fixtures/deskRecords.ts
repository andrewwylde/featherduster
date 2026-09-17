import type { EvidenceEntry, EvidenceRecord } from '@featherduster/core';

/** Test-only evidence records. Never import from packages/ui/src. */
export function makeRecord(overrides: Partial<EvidenceEntry> = {}, narrative = ''): EvidenceRecord {
  const entry: EvidenceEntry = {
    id: 'ev-001',
    date: '2026-01-10',
    company: 'acme',
    title: 'Test entry',
    summary: 'Summary.',
    impact: 'Impact.',
    themes: ['platform'],
    confidence: 'verified',
    in_flight: false,
    metrics: [],
    internal_references: [],
    ...overrides,
  };
  return { ...entry, entry, narrative, filePath: `/ws/evidence/acme/${entry.id}.md` };
}

export const testRecords: EvidenceRecord[] = [
  makeRecord({
    id: 'ev-001',
    date: '2026-01-10',
    title: 'Gateway rewrite',
    themes: ['platform', 'performance'],
    internal_references: [{ type: 'pr', ref: '#12' }],
  }),
  makeRecord({
    id: 'ev-002',
    date: '2026-03-02',
    title: 'Queue migration',
    themes: ['platform'],
    confidence: 'provisional',
    internal_references: [{ type: 'pr', ref: '#12' }, { type: 'linear', ref: 'PLAT-9' }],
  }),
  makeRecord({
    id: 'ev-003',
    date: '2026-02-14',
    title: 'Latency work',
    themes: ['platform'],
    impact: 'Cut p99 by [METRIC NEEDED].',
  }),
  makeRecord({ id: 'ev-004', date: '2026-04-01', title: 'Old retracted', themes: ['platform'], confidence: 'retracted' }),
  makeRecord({ id: 'ev-005', date: '2025-12-01', title: 'No themes', themes: [] }),
];
