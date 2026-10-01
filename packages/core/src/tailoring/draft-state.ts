import type { DraftRecord } from './drafts.js';

/** Stable JSON for fingerprints; absent object properties match JSON.stringify semantics. */
export function canonicalJson(value: unknown): string {
  const parents = new Set<object>();
  const serialize = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || item === null) throw new TypeError('Expected JSON-compatible data');
    if (parents.has(item)) throw new TypeError('Cannot canonicalize circular data');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected a plain JSON object');
    parents.add(item);
    try {
      if (Array.isArray(item)) return `[${Array.from(item, (entry) => entry === undefined ? 'null' : serialize(entry)).join(',')}]`;
      const object = item as Record<string, unknown>;
      return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined).map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`).join(',')}}`;
    } finally {
      parents.delete(item);
    }
  };
  return serialize(value);
}

/** Only run edits require an explicit Apply; navigation and autosave metadata do not. */
export function hasUnappliedChanges(record: DraftRecord): boolean {
  if (record.kind !== 'run') return false;
  for (const step of ['analysis', 'alignment', 'proposals'] as const) {
    if (canonicalJson(record.payload[step] ?? null) !== canonicalJson(record.appliedContent[step] ?? null)) return true;
  }
  return Object.entries(record.payload.proposalTextById).some(([id, pending]) => {
    const proposal = record.payload.proposals?.proposals.find((candidate) => candidate.id === id);
    return !proposal || pending !== (proposal.edited_after ?? proposal.after);
  });
}
