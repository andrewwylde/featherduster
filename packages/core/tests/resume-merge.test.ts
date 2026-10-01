import { describe, expect, it } from 'vitest';
import { mergeField, previewResumeMerge } from '../src/tailoring/resume-merge.js';
import { DEFAULT_STARTER_RESUME } from '../src/schemas/resume.js';

describe('three-way resume merge', () => {
  it('merges independent scalar edits and optional fields canonically', () => {
    expect(mergeField(undefined, undefined, 'new')).toEqual({ conflict: false, value: 'new' });
    expect(mergeField({ a: 1, b: undefined }, { a: 1 }, { a: 2 })).toEqual({ conflict: false, value: { a: 2 } });
    const base = structuredClone(DEFAULT_STARTER_RESUME), local = structuredClone(base), upstream = structuredClone(base);
    local.summary = 'Tailored'; upstream.profile.title = 'Updated';
    const result = previewResumeMerge(base, local, upstream);
    expect(result.merged.summary).toBe('Tailored'); expect(result.merged.profile.title).toBe('Updated'); expect(result.conflicts).toEqual([]);
  });
  it('reports stable field conflicts and resolves only the selected field', () => {
    const base = structuredClone(DEFAULT_STARTER_RESUME), local = { ...base, summary: 'Local' }, upstream = { ...base, summary: 'Upstream' };
    const result = previewResumeMerge(base, local, upstream);
    expect(result.conflicts).toEqual([{ id: '/summary', path: '/summary', base: base.summary, local: 'Local', upstream: 'Upstream' }]);
    expect(previewResumeMerge(base, local, upstream, { '/summary': 'upstream' }).merged.summary).toBe('Upstream');
    expect(mergeField('base', 'local', 'upstream').conflict).toBe(true);
  });
  it('leaves unchanged arrays intact and maps index targets by unique structure', () => {
    const base = structuredClone(DEFAULT_STARTER_RESUME), upstream = structuredClone(base);
    upstream.experiences.reverse();
    const result = previewResumeMerge(base, base, upstream);
    expect(result.merged).toEqual(upstream);
    expect(result.targetMap['/experiences/0/bullets/1']).toBe('/experiences/1/bullets/1');
  });
  it('combines unique additions without guessing edited identities', () => {
    const base = { values: ['a', 'b'] }, local = { values: ['a', 'b', 'c'] }, upstream = { values: ['a', 'b', 'd'] };
    expect(previewResumeMerge(base, local, upstream).merged.values).toEqual(['a', 'b', 'c', 'd']);
    const conflict = previewResumeMerge(base, { values: ['edited', 'b'] }, { values: ['b'] });
    expect(conflict.conflicts[0].path).toBe('/values');
  });
  it('does not map ambiguous duplicate bullets even when arrays are unchanged', () => {
    const base = { experiences: [{ bullets: [{ text: 'same' }, { text: 'same' }] }] };
    expect(previewResumeMerge(base, base, base).targetMap['/experiences/0/bullets/0']).toBeUndefined();
  });
  it('conflicts concurrent different reorders at their array', () => {
    expect(previewResumeMerge({ values: ['a', 'b', 'c'] }, { values: ['b', 'a', 'c'] }, { values: ['a', 'c', 'b'] }).conflicts[0].path).toBe('/values');
  });
  it('never interprets an edited member at the same index as a reliable target', () => {
    const base = { values: [{ text: 'old' }] }, upstream = { values: [{ text: 'new' }] };
    expect(previewResumeMerge(base, base, upstream).targetMap['/values/0']).toBeUndefined();
  });
  it('retains safe insertion anchors when merging unique additions', () => {
    expect(previewResumeMerge({ values: ['a', 'b'] }, { values: ['local', 'a', 'b'] }, { values: ['a', 'upstream', 'b'] }).merged.values).toEqual(['local', 'a', 'upstream', 'b']);
  });
});
