import { canonicalJson } from './draft-state.js';

export type MergeChoice = 'local' | 'upstream';
export type MergeFieldResult<T> = { value: T; conflict: false } | { base: T; local: T; upstream: T; conflict: true };
export interface ResumeMergeConflict { id: string; path: string; base: unknown; local: unknown; upstream: unknown }
export const mergeEqual = (a: unknown, b: unknown): boolean => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);
export function mergeField<T>(base: T, local: T, upstream: T): MergeFieldResult<T> {
  if (mergeEqual(local, upstream) || mergeEqual(base, upstream)) return { value: local, conflict: false };
  if (mergeEqual(base, local)) return { value: upstream, conflict: false };
  return { base, local, upstream, conflict: true };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const segment = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
/** Full structural identity only. Local manual IDs are never source identities. */
export function uniqueMemberMap(before: unknown[], after: unknown[]): Map<number, number> {
  const old = before.map(canonicalJson), next = after.map(canonicalJson), result = new Map<number, number>();
  old.forEach((key, index) => { if (old.indexOf(key) === old.lastIndexOf(key) && next.indexOf(key) >= 0 && next.indexOf(key) === next.lastIndexOf(key)) result.set(index, next.indexOf(key)); });
  return result;
}
export function resumeTargetMap(base: unknown, next: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (old: unknown, current: unknown, from: string, to: string) => {
    if (Array.isArray(old) && Array.isArray(current)) {
      for (const [a, b] of uniqueMemberMap(old, current)) { result[`${from}/${a}`] = `${to}/${b}`; visit(old[a], current[b], `${from}/${a}`, `${to}/${b}`); }
    } else if (object(old) && object(current)) {
      for (const key of Object.keys(old)) if (key in current) visit(old[key], current[key], `${from}/${segment(key)}`, `${to}/${segment(key)}`);
    }
  };
  visit(base, next, '', '');
  return result;
}
/** Unresolved values remain local for preview; callers must resolve every conflict before commit. */
export function previewResumeMerge<T>(base: T, local: T, upstream: T, resolutions: Record<string, MergeChoice> = {}): { merged: T; conflicts: ResumeMergeConflict[]; targetMap: Record<string, string> } {
  const conflicts: ResumeMergeConflict[] = [];
  const conflict = (b: unknown, l: unknown, u: unknown, path: string) => {
    conflicts.push({ id: path, path, base: b, local: l, upstream: u });
    return resolutions[path] === 'upstream' ? u : l;
  };
  const visit = (b: unknown, l: unknown, u: unknown, path: string): unknown => {
    const simple = mergeField(b, l, u);
    if (!simple.conflict) return simple.value;
    if (object(b) && object(l) && object(u)) return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(u)])].sort().map(key => [key, visit(b[key], l[key], u[key], `${path}/${segment(key)}`)]));
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(u)) {
      const keys = b.map(canonicalJson), lk = l.map(canonicalJson), uk = u.map(canonicalJson);
      const unique = (items: string[]) => new Set(items).size === items.length;
      if (!unique(keys) || !unique(lk) || !unique(uk)) return conflict(b, l, u, path);
      const localMissing = keys.some(k => !lk.includes(k)), upstreamMissing = keys.some(k => !uk.includes(k));
      // A removal plus a novel member might be an edit. Do not infer replacement identity.
      if ((localMissing && lk.some(k => !keys.includes(k))) || (upstreamMissing && uk.some(k => !keys.includes(k)))) return conflict(b, l, u, path);
      const retained = keys.filter(k => lk.includes(k) && uk.includes(k));
      const localOrder = lk.filter(k => retained.includes(k)), upstreamOrder = uk.filter(k => retained.includes(k));
      const order = mergeField(retained, localOrder, upstreamOrder);
      if (order.conflict) return conflict(b, l, u, path);
      const all = [...order.value];
      for (const branch of [lk, uk]) branch.forEach((key, i) => {
        if (keys.includes(key) || all.includes(key)) return;
        const anchor = branch.slice(i + 1).find(next => all.includes(next));
        all.splice(anchor === undefined ? all.length : all.indexOf(anchor), 0, key);
      });
      return all.map(k => l[lk.indexOf(k)] ?? u[uk.indexOf(k)]);
    }
    return conflict(b, l, u, path);
  };
  const merged = structuredClone(visit(base, local, upstream, '') as T);
  return { merged, conflicts, targetMap: resumeTargetMap(base, merged) };
}
