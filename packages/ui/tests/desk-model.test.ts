import { describe, it, expect } from 'vitest';
import { buildBriefing, buildDeskModel, evidenceStatus, themeLabel } from '../src/data/deskModel';
import { makeRecord, testRecords } from './fixtures/deskRecords';

describe('deskModel', () => {
  it('maps confidence and missing metrics to desk statuses', () => {
    expect(evidenceStatus(makeRecord({ confidence: 'verified' }))).toBe('verified');
    expect(evidenceStatus(makeRecord({ confidence: 'provisional' }))).toBe('remembered');
    expect(evidenceStatus(makeRecord({ impact: 'Saved [METRIC NEEDED].' }))).toBe('missing_proof');
    expect(evidenceStatus(makeRecord({ metrics: [{ name: 'x', value: '1', status: 'METRIC NEEDED' }] }))).toBe('missing_proof');
  });

  it('humanizes theme slugs', () => {
    expect(themeLabel('distributed-systems')).toBe('Distributed systems');
    expect(themeLabel('ci_infra')).toBe('Ci infra');
  });

  it('builds threads by theme, excludes retracted entries, and sorts by size', () => {
    const model = buildDeskModel(testRecords);
    expect(model.threads.map((t) => t.title)).toEqual(['Platform', 'Performance', 'Untagged']);
    const platform = model.threads[0];
    expect(platform.evidenceIds).toEqual(['ev-002', 'ev-003', 'ev-001']);
    expect(platform.summary).toBe('3 entries · 1 verified · 1 missing proof');
    expect(platform.status).toBe('active');
    expect(model.threads[1].status).toBe('strengthened');
    expect(model.recordsById.has('ev-004')).toBe(false);
  });

  it('derives deduplicated sources from internal references', () => {
    const model = buildDeskModel(testRecords);
    expect(model.sources.map((s) => s.title).sort()).toEqual(['linear PLAT-9', 'pr #12']);
    const pr = model.sources.find((s) => s.title === 'pr #12')!;
    expect(pr.type).toBe('pull_request');
    expect(pr.quote).toBeUndefined();
    const ev2 = model.evidence.find((e) => e.id === 'ev-002')!;
    expect(ev2.sourceIds).toHaveLength(2);
    expect(model.evidence.find((e) => e.id === 'ev-001')!.sourceIds).toEqual([pr.id]);
  });

  it('builds a briefing from the largest thread', () => {
    const briefing = buildBriefing(buildDeskModel(testRecords))!;
    expect(briefing.thread.title).toBe('Platform');
    expect(briefing.recent.map((r) => r.id)).toEqual(['ev-002', 'ev-003', 'ev-001']);
    expect(briefing.needsProof.map((r) => r.id)).toEqual(['ev-002', 'ev-003']);
    expect(briefing.totals).toEqual({ entries: 4, verified: 2, needsProof: 2, threads: 3 });
  });

  it('returns null briefing for an empty ledger', () => {
    expect(buildBriefing(buildDeskModel([]))).toBeNull();
  });
});
