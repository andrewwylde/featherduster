import { EvidenceStore, matchesSearch } from '../parsers/index-store.js';
import type { EvidenceQueryFilters, EvidenceRecord } from '../parsers/index-store.js';
import { CorpusSnapshotSchema } from './schemas.js';
import type { CorpusSnapshot, CorpusScope, CorpusUpdate, SkillSupport } from './schemas.js';

export interface CorpusContext {
  job_id?: string;
  employer?: string;
  project?: string;
  role?: string;
}
export interface CorpusVersioning {
  fingerprint(record: EvidenceRecord): string;
}
export interface EffectiveCorpus {
  evidence: EvidenceStore;
  rebindings?: { update_id: string; evidence_id: string; from: string; to: string }[];
  support: SkillSupport[];
  issues: { update_id: string; code: 'source_changed' | 'source_missing' | 'quote_missing' | 'conflict'; message: string }[];
}
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

function scopeMatches(scope: CorpusScope, context: CorpusContext): boolean {
  if (scope.kind === 'workspace') return true;
  return (scope.kind === 'job' ? context.job_id : context[scope.kind]) === scope.key;
}
export function applicableSkillSupport(support: SkillSupport[], context: CorpusContext): SkillSupport[] {
  return support.filter(s => scopeMatches(s.scope, context));
}
function sameScope(a: CorpusScope, b: CorpusScope): boolean {
  return a.kind === b.kind && (a.kind === 'workspace' || (b.kind !== 'workspace' && a.key === b.key));
}
function sameRelationship(a: SkillSupport, b: SkillSupport): boolean {
  return normalized(a.skill) === normalized(b.skill) && normalized(a.facet) === normalized(b.facet)
    && sameScope(a.scope, b.scope)
    && a.sources.map(s => s.evidence_id).sort().join('\0') === b.sources.map(s => s.evidence_id).sort().join('\0');
}
function hasQuote(record: EvidenceRecord, quote: string): boolean {
  // Match a literal passage in one source field, not across synthetic field boundaries.
  return [record.title, record.summary, record.impact, record.narrative].some(value => value.includes(quote));
}

/** Resolve immutable updates against source records without modifying either input. */
export function applyCorpusSnapshot(source: EvidenceStore, snapshot: CorpusSnapshot, versioning: CorpusVersioning): EffectiveCorpus {
  const parsed = CorpusSnapshotSchema.parse(snapshot);
  const evidence = new EvidenceStore(source.getAll().map(record => ({
    entry: structuredClone(record.entry), narrative: record.narrative, filePath: record.filePath,
  })));
  const rebindings: NonNullable<EffectiveCorpus['rebindings']> = [];
  const issues: EffectiveCorpus['issues'] = [];
  const issue = (update: CorpusUpdate, code: EffectiveCorpus['issues'][number]['code'], message: string) => {
    issues.push({ update_id: update.id, code, message });
  };
  const inactive = new Set<string>();
  const updates = [...parsed.updates].sort((a, b) => a.revision - b.revision);
  for (const update of updates) {
    if (update.supersedes) inactive.add(update.supersedes);
    if (update.change.kind === 'withdrawal') inactive.add(update.change.update_id);
  }
  const active = updates.filter(update => !inactive.has(update.id) && update.change.kind !== 'withdrawal');
  const conflicts = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i].change;
      const b = active[j].change;
      const conflict = a.kind === 'evidence_amendment' && b.kind === 'evidence_amendment'
        ? a.value.evidence_id === b.value.evidence_id
        : a.kind === 'skill_support' && b.kind === 'skill_support'
          && sameRelationship(a.value, b.value) && a.value.support !== b.value.support;
      if (conflict) { conflicts.add(active[i].id); conflicts.add(active[j].id); }
    }
  }
  for (const update of active) {
    if (conflicts.has(update.id)) issue(update, 'conflict', 'Active corrections conflict; explicitly supersede one before reuse.');
  }
  for (const update of active) {
    if (conflicts.has(update.id) || update.change.kind !== 'evidence_amendment') continue;
    const amendment = update.change.value;
    const original = source.get(amendment.evidence_id);
    if (!original) { issue(update, 'source_missing', 'Amendment source is missing.'); continue; }
    if (original.confidence === 'retracted' || versioning.fingerprint(original) !== amendment.base_fingerprint) {
      issue(update, 'source_changed', 'Amendment source changed or was retracted.'); continue;
    }
    const entry = structuredClone(amendment.entry);
    entry.confidence = 'provisional';
    entry.in_flight = original.in_flight || entry.in_flight;
    entry.metrics = entry.metrics.map(metric => {
      const unchanged = original.metrics.find(m => m.name === metric.name && m.value === metric.value);
      return { ...metric, status: unchanged?.status ?? 'unverified' };
    });
    evidence.add(entry, amendment.narrative, original.filePath);
  }
  const support: SkillSupport[] = [];
  for (const update of active) {
    if (conflicts.has(update.id) || update.change.kind !== 'skill_support') continue;
    const relationship = structuredClone(update.change.value);
    let valid = true;
    for (const binding of relationship.sources) {
      const record = evidence.get(binding.evidence_id);
      if (!record) { issue(update, 'source_missing', `Missing source ${binding.evidence_id}.`); valid = false; break; }
      if (record.confidence === 'retracted') { issue(update, 'source_changed', `Retracted source ${record.id}.`); valid = false; break; }
      if (!hasQuote(record, binding.quote)) { issue(update, 'quote_missing', `Bound passage changed in ${record.id}.`); valid = false; break; }
      const fingerprint = versioning.fingerprint(record);
      if (fingerprint !== binding.evidence_fingerprint) {
        const status = binding.source_status;
        if (!status || status.confidence !== record.confidence || status.in_flight !== record.in_flight) {
          issue(update, 'source_changed', `Source status cannot be confirmed unchanged for ${record.id}.`); valid = false; break;
        }
        rebindings.push({ update_id: update.id, evidence_id: record.id, from: binding.evidence_fingerprint, to: fingerprint });
        binding.evidence_fingerprint = fingerprint;
      }
    }
    if (valid) support.push(relationship);
  }
  return { evidence, support, issues, rebindings };
}

/** Input support must first be source-verified and scope-filtered by the server. */
export function supportsTerm(term: string, citationIds: string[], evidence: EvidenceRecord[], support: SkillSupport[]): boolean {
  const matches = (relationship: SkillSupport) => relationship.permitted_terms.some(t => normalized(t) === normalized(term));
  return support.some(relationship => relationship.support === 'direct' && matches(relationship)
    && !support.some(other => other.support === 'unsupported' && sameRelationship(relationship, other) && matches(other))
    && relationship.sources.every(binding => {
      const record = evidence.find(r => r.id === binding.evidence_id);
      return citationIds.includes(binding.evidence_id) && record !== undefined && record.confidence !== 'retracted'
        && hasQuote(record, binding.quote)
        && (!binding.source_status || (binding.source_status.confidence === record.confidence && binding.source_status.in_flight === record.in_flight));
    }));
}

export interface CorpusSearchMatch {
  record: EvidenceRecord;
  literal: boolean;
  confidence: EvidenceRecord['confidence'];
  support: SkillSupport[];
}
/** Enrich search while preserving filters and returning each accomplishment only once. */
export function queryCorpus(corpus: EffectiveCorpus, filters: EvidenceQueryFilters = {}, context: CorpusContext = {}): CorpusSearchMatch[] {
  const { search, query, ...rest } = filters;
  const term = search ?? query ?? '';
  const support = applicableSkillSupport(corpus.support, context).filter(s => s.support !== 'unsupported');
  return corpus.evidence.query(rest).flatMap(record => {
    const literal = matchesSearch(record, term);
    const learned = support.filter(s => s.sources.some(source => source.evidence_id === record.id)
      && [s.skill, s.facet, ...s.permitted_terms].some(value => normalized(value).includes(normalized(term))));
    return literal || learned.length ? [{ record, literal, confidence: record.confidence, support: learned }] : [];
  });
}
