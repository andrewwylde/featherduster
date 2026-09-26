import { hasMissingMetrics, type EvidenceRecord } from '@featherduster/core';
import type { EvidenceStatus } from '../theme/tokens';
import type { NodeMapEvidence, SignalSource, StoryThread } from '../types/desk';

/** Everything the desk views render, derived only from the user's evidence ledger. */
export interface DeskModel {
  sources: SignalSource[];
  evidence: NodeMapEvidence[];
  threads: StoryThread[];
  recordsById: Map<string, EvidenceRecord>;
}

export interface BriefingModel {
  thread: StoryThread;
  recent: EvidenceRecord[];
  needsProof: EvidenceRecord[];
  totals: { entries: number; verified: number; needsProof: number; threads: number };
}

const PR_TYPES = new Set(['pr', 'pull_request', 'pull-request', 'github']);
const UNTAGGED = 'untagged';

export function evidenceStatus(record: EvidenceRecord): EvidenceStatus {
  if (hasMissingMetrics(record.entry, record.narrative)) return 'missing_proof';
  return record.entry.confidence === 'verified' ? 'verified' : 'remembered';
}

export function themeLabel(theme: string): string {
  const words = theme.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Untagged';
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function byDateDesc(a: EvidenceRecord, b: EvidenceRecord): number {
  return b.entry.date.localeCompare(a.entry.date) || a.id.localeCompare(b.id);
}

export function buildDeskModel(records: EvidenceRecord[]): DeskModel {
  const live = records.filter((r) => r.entry.confidence !== 'retracted').sort(byDateDesc);
  const recordsById = new Map(live.map((r) => [r.id, r]));
  const sources = new Map<string, SignalSource>();

  const evidence: NodeMapEvidence[] = live.map((r) => {
    const status = evidenceStatus(r);
    const sourceIds = r.entry.internal_references.map((ref) => {
      const id = `src-${slug(`${ref.type}-${ref.ref}`)}`;
      if (!sources.has(id)) {
        sources.set(id, {
          id,
          type: PR_TYPES.has(ref.type.toLowerCase()) ? 'pull_request' : 'project_note',
          tag: ref.type,
          title: `${ref.type} ${ref.ref}`,
          date: r.entry.date,
          description: `Referenced by ${r.id}: ${r.entry.title}`,
          status,
        });
      }
      return id;
    });
    return {
      id: r.id,
      title: r.entry.title,
      status,
      sourceIds: Array.from(new Set(sourceIds)),
      challenge: r.entry.summary || `Technical challenge for ${r.entry.title}`,
      intervention: r.entry.impact ? r.entry.impact : r.entry.title,
      metric: r.entry.metrics.length > 0 && r.entry.metrics[0].value
        ? `${r.entry.metrics[0].name}: ${r.entry.metrics[0].value}`
        : (r.entry.impact || 'Production outcome'),
      themes: r.entry.themes || [],
    };
  });

  const statusById = new Map(evidence.map((e) => [e.id, e.status]));
  const byTheme = new Map<string, string[]>();
  for (const r of live) {
    const themes = r.entry.themes.map((t) => t.trim().toLowerCase()).filter(Boolean);
    for (const theme of themes.length > 0 ? Array.from(new Set(themes)) : [UNTAGGED]) {
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), r.id]);
    }
  }

  const threads: StoryThread[] = Array.from(byTheme.entries())
    .map(([theme, ids]) => {
      const verified = ids.filter((id) => statusById.get(id) === 'verified').length;
      const missing = ids.filter((id) => statusById.get(id) === 'missing_proof').length;
      return {
        id: `thread-${slug(theme)}`,
        title: themeLabel(theme),
        status: verified === ids.length ? ('strengthened' as const) : ('active' as const),
        evidenceIds: ids,
        summary: `${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} · ${verified} verified · ${missing} missing proof`,
      };
    })
    .sort((a, b) => b.evidenceIds.length - a.evidenceIds.length || a.title.localeCompare(b.title));

  return { sources: Array.from(sources.values()), evidence, threads, recordsById };
}

export function buildBriefing(model: DeskModel): BriefingModel | null {
  const thread = model.threads[0];
  if (!thread) return null;
  const threadRecords = thread.evidenceIds
    .map((id) => model.recordsById.get(id))
    .filter((r): r is EvidenceRecord => !!r);
  return {
    thread,
    recent: threadRecords.slice(0, 3),
    needsProof: threadRecords.filter((r) => evidenceStatus(r) !== 'verified').slice(0, 5),
    totals: {
      entries: model.recordsById.size,
      verified: model.evidence.filter((e) => e.status === 'verified').length,
      needsProof: model.evidence.filter((e) => e.status !== 'verified').length,
      threads: model.threads.length,
    },
  };
}
