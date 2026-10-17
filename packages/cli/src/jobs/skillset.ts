import * as C from '@featherduster/core';
import type { CorpusService } from '../corpus/service.js';
import { sourceFingerprint } from '../corpus/load.js';
import { fingerprint } from './files.js';
import { RepositoryError } from './repository.js';

/** Working mapping, not a separately confirmed compendium file: selected evidence
 * plus explicitly saved support applicable to this job. No resume or rubric input. */
export function selectJobSkillset(view: ReturnType<CorpusService['read']>, evidenceIds?: string[]) {
  const all = view.evidence.getAll();
  const ids = evidenceIds ?? all.map(record => record.id);
  if (new Set(ids).size !== ids.length) throw new RepositoryError('invalid_relationship', 'Select each evidence source only once');
  const evidence = ids.map(id => {
    const record = all.find(record => record.id === id);
    if (!record) throw new RepositoryError('invalid_relationship', `Unknown evidence: ${id}`);
    return record;
  });
  const selected = new Set(ids);
  const support = view.support.filter(item => item.sources.every(source => selected.has(source.evidence_id)));
  const sources = view.records.filter(record => selected.has(record.source.id));
  if (evidence.some(record => !sources.some(source => source.source.id === record.id))) {
    throw new RepositoryError('invalid_relationship', 'Selected evidence has no source provenance');
  }
  const knowledge: C.CorpusSnapshot = { ...view.snapshot, materialized: {
    support,
    sources: sources.map(record => ({ entry: record.source.entry, narrative: record.source.narrative })),
  } };
  // Include both raw and effective versions: amendments and source edits must
  // invalidate future assessments, while old captured inputs remain immutable.
  const provenance = {
    schema_version: 1 as const,
    mapping: 'selected-corpus-and-saved-scoped-support' as const,
    sources: evidence.map(record => ({
      evidence_id: record.id,
      source_fingerprint: sources.find(source => source.source.id === record.id)!.fingerprint,
      effective_fingerprint: sourceFingerprint(record),
    })).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)),
    support: [...support].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  return { evidence, knowledge, provenance, fingerprint: fingerprint(JSON.stringify(provenance)) };
}
