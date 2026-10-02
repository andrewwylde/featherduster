import { EvidenceRecord, EvidenceQueryFilters } from './index-store.js';

export interface VectorSearchResult {
  record: EvidenceRecord;
  score: number;
  matchedTokens: string[];
  matchedThemes: string[];
}

export interface VectorSearchOptions {
  limit?: number;
  minScore?: number;
  filters?: EvidenceQueryFilters;
}

export interface SerializedVectorIndex {
  dimensions: number;
  docCount: number;
  idf: Record<string, number>;
  entries: Array<{
    id: string;
    vector: number[];
  }>;
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'arent', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could',
  'couldnt', 'did', 'didn', 'didnt', 'do', 'does', 'doesn', 'doesnt', 'doing',
  'dont', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell',
  'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in', 'into', 'is',
  'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my',
  'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or',
  'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
  'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some',
  'such', 'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll', 'theyre',
  'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'wasnt', 'we', 'wed', 'well', 'were', 'werent', 'weve',
  'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who',
  'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you',
  'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves'
]);

/**
 * 32-bit FNV-1a hash algorithm for deterministic token feature hashing.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Simplifies common technical English word endings for lexical matching.
 */
function stemWord(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/(?:ing|edly|ingly|ed|es|s|ly|tion|ment|able|ity)$/i, '')
    .trim();
}

/**
 * Tokenizes text into normalized lexical terms and subword n-grams.
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const tokens: string[] = [];
  for (const w of words) {
    tokens.push(w);
    const stemmed = stemWord(w);
    if (stemmed.length > 2 && stemmed !== w) {
      tokens.push(stemmed);
    }
  }

  // Add 2-word collocations / bigrams for compound technical terms
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]}_${words[i + 1]}`);
  }

  return tokens;
}

/**
 * Computes cosine similarity between two dense vectors: dot(u, v) / (|u| * |v|).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  // Bound to [0, 1] for intuitive relevance ranking
  return Math.max(0, Math.min(1, similarity));
}

/**
 * 100% Air-Gapped Local Vector Index for Evidence Ledger Entries.
 * Employs deterministic FNV-1a signed feature hashing and BM25-IDF weighting.
 */
export class EvidenceVectorIndex {
  readonly dimensions: number;
  private readonly vectors = new Map<string, number[]>();
  private readonly records = new Map<string, EvidenceRecord>();
  private readonly docFrequency = new Map<string, number>();
  private docCount = 0;

  constructor(dimensions: number = 256) {
    this.dimensions = dimensions;
  }

  get size(): number {
    return this.vectors.size;
  }

  /**
   * Generates a dense unit-normalized embedding vector for an arbitrary text input.
   */
  embedText(text: string, customWeights?: Map<string, number>): number[] {
    const tokens = tokenizeText(text);
    const vector = new Array<number>(this.dimensions).fill(0);
    if (tokens.length === 0) return vector;

    // Calculate term frequencies
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    // Accumulate weighted hashed projections
    for (const [token, count] of tf.entries()) {
      const fieldMultiplier = customWeights?.get(token) || 1.0;
      const df = this.docFrequency.get(token) || 1;
      const totalDocs = Math.max(1, this.docCount);
      // Smoothed BM25-IDF
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5)) + 1.0;
      const weight = (1 + Math.log(count)) * idf * fieldMultiplier;

      const idx = fnv1a(token) % this.dimensions;
      const sign = (fnv1a(token + ':sign') & 1) === 1 ? 1 : -1;

      vector[idx] += sign * weight;
    }

    // L2-Normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i] * vector[i];
    }

    if (norm > 0) {
      const l2 = Math.sqrt(norm);
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] /= l2;
      }
    }

    return vector;
  }

  /**
   * Generates a multi-field weighted embedding vector for an evidence record.
   */
  embedRecord(record: EvidenceRecord): number[] {
    const weights = new Map<string, number>();
    const themes = record.entry.themes || [];
    const metrics = record.entry.metrics || [];

    // Heavy weight for title & themes
    const titleTokens = tokenizeText(record.entry.title || '');
    for (const t of titleTokens) weights.set(t, (weights.get(t) || 1.0) * 3.5);

    const themeTokens = tokenizeText(themes.join(' '));
    for (const t of themeTokens) weights.set(t, (weights.get(t) || 1.0) * 3.0);

    const summaryTokens = tokenizeText(record.entry.summary || '');
    for (const t of summaryTokens) weights.set(t, (weights.get(t) || 1.0) * 2.5);

    const impactTokens = tokenizeText(record.entry.impact || '');
    for (const t of impactTokens) weights.set(t, (weights.get(t) || 1.0) * 2.5);

    const metricText = metrics.map((m) => `${m.name || ''} ${m.value || ''}`).join(' ');
    const metricTokens = tokenizeText(metricText);
    for (const t of metricTokens) weights.set(t, (weights.get(t) || 1.0) * 1.8);

    const corpus = [
      record.entry.title || '',
      themes.join(' '),
      record.entry.summary || '',
      record.entry.impact || '',
      metricText,
      record.narrative || '',
    ].join('\n');

    return this.embedText(corpus, weights);
  }

  /**
   * Indexes a single evidence record.
   */
  add(record: EvidenceRecord): void {
    this.records.set(record.id, record);

    const themes = record.entry.themes || [];
    // Update document frequencies
    const uniqueTokens = new Set(
      tokenizeText(
        [
          record.entry.title || '',
          record.entry.summary || '',
          record.entry.impact || '',
          themes.join(' '),
          record.narrative || '',
        ].join(' ')
      )
    );

    for (const token of uniqueTokens) {
      this.docFrequency.set(token, (this.docFrequency.get(token) || 0) + 1);
    }
    this.docCount++;

    const vector = this.embedRecord(record);
    this.vectors.set(record.id, vector);
  }

  /**
   * Batch indexes multiple evidence records and recomputes corpus statistics.
   */
  addMany(records: EvidenceRecord[]): void {
    this.records.clear();
    this.vectors.clear();
    this.docFrequency.clear();
    this.docCount = 0;

    for (const rec of records) {
      this.records.set(rec.id, rec);
      const themes = rec.entry.themes || [];
      const uniqueTokens = new Set(
        tokenizeText(
          [
            rec.entry.title || '',
            rec.entry.summary || '',
            rec.entry.impact || '',
            themes.join(' '),
            rec.narrative || '',
          ].join(' ')
        )
      );
      for (const token of uniqueTokens) {
        this.docFrequency.set(token, (this.docFrequency.get(token) || 0) + 1);
      }
      this.docCount++;
    }

    for (const rec of records) {
      this.vectors.set(rec.id, this.embedRecord(rec));
    }
  }

  /**
   * Rebuilds the index from a collection of records.
   */
  build(records: EvidenceRecord[]): void {
    this.addMany(records);
  }

  /**
   * Removes an evidence record from the index.
   */
  remove(id: string): boolean {
    this.records.delete(id);
    return this.vectors.delete(id);
  }

  /**
   * Clears the index completely.
   */
  clear(): void {
    this.records.clear();
    this.vectors.clear();
    this.docFrequency.clear();
    this.docCount = 0;
  }

  /**
   * Retrieves the embedding vector for an indexed record.
   */
  getVector(id: string): number[] | undefined {
    return this.vectors.get(id);
  }

  /**
   * Performs semantic nearest-neighbor retrieval given a query or job description.
   */
  search(query: string, options?: VectorSearchOptions): VectorSearchResult[] {
    const trimmed = query.trim();
    if (!trimmed || this.vectors.size === 0) return [];

    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0.05;
    const filters = options?.filters;

    const queryVector = this.embedText(trimmed);
    const queryTokens = new Set(tokenizeText(trimmed));

    const results: VectorSearchResult[] = [];

    for (const [id, vector] of this.vectors.entries()) {
      const record = this.records.get(id);
      if (!record) continue;

      // Apply metadata filters if provided
      if (filters) {
        const { entry } = record;
        if (filters.company && entry.company.toLowerCase() !== filters.company.toLowerCase()) {
          continue;
        }
        const entryThemes = entry.themes || [];
        if (
          filters.theme &&
          !entryThemes.some((t) => t.toLowerCase() === filters.theme!.toLowerCase())
        ) {
          continue;
        }
        if (
          filters.themes &&
          filters.themes.length > 0 &&
          !filters.themes.some((ft) =>
            entryThemes.some((t) => t.toLowerCase() === ft.toLowerCase())
          )
        ) {
          continue;
        }
        if (
          filters.confidence &&
          entry.confidence.toLowerCase() !== filters.confidence.toLowerCase()
        ) {
          continue;
        }
        const inFlightFilter =
          filters.inFlight !== undefined ? filters.inFlight : filters.in_flight;
        if (inFlightFilter !== undefined && entry.in_flight !== inFlightFilter) {
          continue;
        }
      }

      const score = cosineSimilarity(queryVector, vector);
      if (score >= minScore) {
        // Extract matched lexical tokens for candidate defensibility explainability
        const recordThemes = record.entry.themes || [];
        const recordTokens = tokenizeText(
          [
            record.entry.title || '',
            record.entry.summary || '',
            record.entry.impact || '',
            recordThemes.join(' '),
          ].join(' ')
        );
        const matched = Array.from(queryTokens).filter((qt) => recordTokens.includes(qt));
        const matchedThemes = recordThemes.filter((th) =>
          query.toLowerCase().includes(th.toLowerCase())
        );

        results.push({
          record,
          score: Math.round(score * 1000) / 1000,
          matchedTokens: matched.slice(0, 10),
          matchedThemes,
        });
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Serializes the vector index for storage or caching.
   */
  toJSON(): SerializedVectorIndex {
    const idfRecord: Record<string, number> = {};
    for (const [token, df] of this.docFrequency.entries()) {
      idfRecord[token] = df;
    }

    const entries: Array<{ id: string; vector: number[] }> = [];
    for (const [id, vector] of this.vectors.entries()) {
      entries.push({ id, vector });
    }

    return {
      dimensions: this.dimensions,
      docCount: this.docCount,
      idf: idfRecord,
      entries,
    };
  }

  /**
   * Rehydrates an index from serialized state.
   */
  static fromJSON(json: SerializedVectorIndex, records: EvidenceRecord[]): EvidenceVectorIndex {
    const index = new EvidenceVectorIndex(json.dimensions);
    index.docCount = json.docCount;

    for (const [token, df] of Object.entries(json.idf)) {
      index.docFrequency.set(token, df);
    }

    const recordMap = new Map(records.map((r) => [r.id, r]));
    for (const entry of json.entries) {
      const rec = recordMap.get(entry.id);
      if (rec) {
        index.records.set(rec.id, rec);
        index.vectors.set(entry.id, entry.vector);
      }
    }

    return index;
  }
}
