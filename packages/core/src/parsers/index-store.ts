import {
  EvidenceEntry,
  ConfidenceLevel,
  MetricEntry,
  InternalReference,
} from '../schemas/evidence.js';

export interface EvidenceRecord {
  entry: EvidenceEntry;
  narrative: string;
  filePath?: string;
  id: string;
  date: string;
  company: string;
  title: string;
  summary: string;
  impact: string;
  themes: string[];
  confidence: ConfidenceLevel;
  in_flight: boolean;
  metrics: MetricEntry[];
  internal_references: InternalReference[];
}

export interface EvidenceQueryFilters {
  company?: string;
  theme?: string;
  themes?: string[];
  confidence?: ConfidenceLevel | string;
  hasMissingMetrics?: boolean;
  inFlight?: boolean;
  in_flight?: boolean;
  search?: string;
  query?: string;
}

/**
 * Checks if an evidence entry has missing metrics, unverified metric placeholders,
 * or explicit [METRIC NEEDED] tags.
 */
export function hasMissingMetrics(entry: EvidenceEntry, narrative = ''): boolean {
  const hasMetricNeeded = entry.metrics.some((m) => {
    const status = m.status.toLowerCase();
    return (
      status === 'metric needed' ||
      status.includes('needed') ||
      status === 'unverified' ||
      status === 'pending' ||
      m.value.includes('METRIC NEEDED') ||
      m.name.includes('METRIC NEEDED')
    );
  });
  if (hasMetricNeeded) return true;

  const placeholderPattern = /\[METRIC NEEDED\]|METRIC NEEDED/i;
  if (
    placeholderPattern.test(entry.impact) ||
    placeholderPattern.test(entry.summary) ||
    placeholderPattern.test(entry.title) ||
    placeholderPattern.test(narrative)
  ) {
    return true;
  }

  return false;
}

/**
 * Matches a query string against the title, summary, impact, narrative,
 * and additional metadata fields of an evidence record.
 */
export function matchesSearch(record: EvidenceRecord, searchTerm: string): boolean {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  if (!normalizedSearch) return true;

  const corpus = [
    record.entry.title,
    record.entry.summary,
    record.entry.impact,
    record.narrative,
    record.entry.id,
    record.entry.company,
    ...record.entry.themes,
    ...record.entry.metrics.map((m) => `${m.name} ${m.value} ${m.status}`),
    ...record.entry.internal_references.map((r) => `${r.type} ${r.ref}`),
  ]
    .join(' ')
    .toLowerCase();

  if (corpus.includes(normalizedSearch)) {
    return true;
  }

  const keywords = normalizedSearch.split(/\s+/).filter(Boolean);
  if (keywords.length > 1 && keywords.every((kw) => corpus.includes(kw))) {
    return true;
  }

  return false;
}

/**
 * In-memory collection and query store for evidence entries.
 */
export class EvidenceStore {
  private readonly entries = new Map<string, EvidenceRecord>();

  constructor(
    initialEntries?: Array<
      | { entry: EvidenceEntry; narrative: string; filePath?: string }
      | EvidenceRecord
    >
  ) {
    if (initialEntries) {
      for (const item of initialEntries) {
        this.add(item);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Adds an evidence entry to the store.
   */
  add(entry: EvidenceEntry, narrative?: string, filePath?: string): EvidenceRecord;
  add(record: { entry: EvidenceEntry; narrative?: string; filePath?: string }): EvidenceRecord;
  add(
    entryOrRecord:
      | EvidenceEntry
      | { entry: EvidenceEntry; narrative?: string; filePath?: string },
    narrative = '',
    filePath?: string
  ): EvidenceRecord {
    let entry: EvidenceEntry;
    let body = narrative;
    let path = filePath;

    if ('entry' in entryOrRecord && typeof entryOrRecord.entry === 'object') {
      entry = entryOrRecord.entry;
      body = entryOrRecord.narrative ?? '';
      path = entryOrRecord.filePath;
    } else {
      entry = entryOrRecord as EvidenceEntry;
    }

    const record: EvidenceRecord = {
      ...entry,
      entry,
      narrative: body,
      filePath: path,
    };

    this.entries.set(entry.id, record);
    return record;
  }

  /**
   * Retrieves an evidence entry by ID.
   */
  get(id: string): EvidenceRecord | undefined {
    return this.entries.get(id);
  }

  /**
   * Checks whether an evidence entry exists by ID.
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Removes an evidence entry by ID.
   */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Returns all stored evidence records.
   */
  getAll(): EvidenceRecord[] {
    return Array.from(this.entries.values());
  }

  /**
   * Clears all stored evidence entries.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Queries evidence entries with optional filters and full-text keyword search.
   */
  query(filters?: EvidenceQueryFilters): EvidenceRecord[] {
    if (!filters) {
      return Array.from(this.entries.values());
    }

    return Array.from(this.entries.values()).filter((record) => {
      const { entry, narrative } = record;

      if (filters.company && entry.company.toLowerCase() !== filters.company.toLowerCase()) {
        return false;
      }

      if (
        filters.theme &&
        !entry.themes.some((t) => t.toLowerCase() === filters.theme!.toLowerCase())
      ) {
        return false;
      }

      if (
        filters.themes &&
        filters.themes.length > 0 &&
        !filters.themes.some((ft) =>
          entry.themes.some((t) => t.toLowerCase() === ft.toLowerCase())
        )
      ) {
        return false;
      }

      if (
        filters.confidence &&
        entry.confidence.toLowerCase() !== filters.confidence.toLowerCase()
      ) {
        return false;
      }

      const inFlightFilter = filters.inFlight !== undefined ? filters.inFlight : filters.in_flight;
      if (inFlightFilter !== undefined && entry.in_flight !== inFlightFilter) {
        return false;
      }

      if (filters.hasMissingMetrics !== undefined) {
        const missing = hasMissingMetrics(entry, narrative);
        if (missing !== filters.hasMissingMetrics) {
          return false;
        }
      }

      const searchTerm = filters.search ?? filters.query;
      if (searchTerm && !matchesSearch(record, searchTerm)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Convenience search method for keyword queries.
   */
  search(searchTerm: string, filters?: Omit<EvidenceQueryFilters, 'search' | 'query'>): EvidenceRecord[] {
    return this.query({ ...filters, search: searchTerm });
  }
}
