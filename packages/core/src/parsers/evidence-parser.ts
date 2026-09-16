import matter, { GrayMatterFile } from 'gray-matter';
import yaml from 'js-yaml';
import { z } from 'zod';
import { EvidenceEntry, EvidenceEntrySchema } from '../schemas/evidence.js';

export class EvidenceParseError extends Error {
  readonly filePath?: string;
  readonly zodIssues?: z.ZodIssue[];

  constructor(
    message: string,
    options?: { filePath?: string; zodIssues?: z.ZodIssue[]; cause?: unknown }
  ) {
    super(message);
    this.name = 'EvidenceParseError';
    this.filePath = options?.filePath;
    this.zodIssues = options?.zodIssues;
    if (options?.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, EvidenceParseError.prototype);
  }
}

export interface ParsedEvidence {
  entry: EvidenceEntry;
  narrative: string;
}

/**
 * Parses markdown with YAML frontmatter, validates the frontmatter against
 * EvidenceEntrySchema, extracts the markdown body as narrative, and returns
 * the structured entry and narrative.
 */
export function parseEvidenceMarkdown(content: string, filePath?: string): ParsedEvidence {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    throw new EvidenceParseError(
      `Missing YAML frontmatter delimiters${filePath ? ` in ${filePath}` : ''}`,
      { filePath }
    );
  }

  let parsed: GrayMatterFile<any>;
  try {
    parsed = matter(content);
  } catch (err: any) {
    throw new EvidenceParseError(
      `Failed to parse YAML frontmatter${filePath ? ` in ${filePath}` : ''}: ${err.message}`,
      { filePath, cause: err }
    );
  }

  let rawData = parsed.data;
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new EvidenceParseError(
      `Invalid frontmatter structure${filePath ? ` in ${filePath}` : ''}: expected key-value mapping`,
      { filePath }
    );
  }

  // Handle YAML parsing unquoted dates as Date objects
  if (rawData.date instanceof Date) {
    const yyyy = rawData.date.getUTCFullYear();
    const mm = String(rawData.date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(rawData.date.getUTCDate()).padStart(2, '0');
    rawData = { ...rawData, date: `${yyyy}-${mm}-${dd}` };
  }

  const parseResult = EvidenceEntrySchema.safeParse(rawData);
  if (!parseResult.success) {
    const issueMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new EvidenceParseError(
      `Validation error${filePath ? ` in ${filePath}` : ''}: ${issueMessages}`,
      { filePath, zodIssues: parseResult.error.issues }
    );
  }

  return {
    entry: parseResult.data,
    narrative: parsed.content.trim(),
  };
}

/**
 * Formats the frontmatter cleanly as YAML and attaches the markdown body,
 * ensuring round-trip idempotency (parse -> serialize -> parse).
 */
export function serializeEvidenceMarkdown(entry: EvidenceEntry, narrative: string): string {
  const validatedEntry = EvidenceEntrySchema.parse(entry);
  const trimmedNarrative = narrative.trim();
  const body = trimmedNarrative ? `\n${trimmedNarrative}\n` : '';
  return matter.stringify(body, validatedEntry);
}

/**
 * Parses an evidence ledger document (e.g. evidence-ledger.md, evidence-ledger.yaml),
 * which stores multiple accomplishment records in an embedded YAML code block
 * (```yaml ... entries: [...] ```) or directly as a YAML document.
 */
export function parseEvidenceLedger(content: string, filePath?: string): ParsedEvidence[] {
  const yamlMatch =
    content.match(/```(?:yaml|yml)([\s\S]*?)```/) || content.match(/```([\s\S]*?)```/);
  const yamlText = yamlMatch ? yamlMatch[1] : content;

  let doc: any;
  try {
    doc = yaml.load(yamlText);
  } catch (err: any) {
    throw new EvidenceParseError(
      `Failed to parse YAML ledger${filePath ? ` in ${filePath}` : ''}: ${err.message}`,
      { filePath, cause: err }
    );
  }

  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries)) {
    return [];
  }

  // Determine company name: from meta or directory structure (e.g. companies/<name>/...)
  let inferredCompany = 'general';
  if (doc.meta?.employer) {
    inferredCompany = String(doc.meta.employer)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
  } else if (doc.meta?.company) {
    inferredCompany = String(doc.meta.company)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
  }

  if (filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const compMatch = normalizedPath.match(/companies\/([^/]+)/i);
    if (compMatch) {
      inferredCompany = compMatch[1].toLowerCase();
    }
  }

  const results: ParsedEvidence[] = [];

  for (const raw of doc.entries) {
    if (!raw || typeof raw !== 'object' || !raw.id) continue;

    let dateStr = '2026-01-01';
    if (raw.date instanceof Date) {
      const yyyy = raw.date.getUTCFullYear();
      const mm = String(raw.date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(raw.date.getUTCDate()).padStart(2, '0');
      dateStr = `${yyyy}-${mm}-${dd}`;
    } else if (raw.date) {
      dateStr = String(raw.date).split('T')[0];
    }

    let confidence: 'verified' | 'provisional' | 'retracted' = 'verified';
    const rawConf = String(raw.confidence || '').toLowerCase();
    if (rawConf === 'high' || rawConf === 'verified') {
      confidence = 'verified';
    } else if (rawConf === 'medium' || rawConf === 'low' || rawConf === 'provisional') {
      confidence = 'provisional';
    } else if (rawConf === 'retracted') {
      confidence = 'retracted';
    }

    const title = raw.title || raw.summary?.slice(0, 80) || String(raw.id);
    const summary = raw.summary || '';
    const impact = raw.impact || '';
    const themes = Array.isArray(raw.theme_ids)
      ? raw.theme_ids
      : Array.isArray(raw.themes)
        ? raw.themes
        : [];

    const metrics = Array.isArray(raw.metrics) ? [...raw.metrics] : [];
    if (
      metrics.length === 0 &&
      (summary.includes('[METRIC NEEDED]') || impact.includes('[METRIC NEEDED]'))
    ) {
      metrics.push({
        name: 'Impact metric',
        value: '[METRIC NEEDED]',
        status: 'missing',
      });
    }

    const internal_references = Array.isArray(raw.internal_references)
      ? [...raw.internal_references]
      : [];
    if (internal_references.length === 0 && raw.url) {
      internal_references.push({
        type: raw.source || 'url',
        ref: String(raw.url),
      });
    }

    const entryData = {
      id: String(raw.id).trim(),
      date: dateStr,
      company: raw.company || inferredCompany,
      title,
      summary,
      impact,
      themes,
      confidence,
      in_flight: Boolean(raw.in_flight),
      metrics,
      internal_references,
    };

    const parseResult = EvidenceEntrySchema.safeParse(entryData);
    if (parseResult.success) {
      const narrative =
        raw.narrative || (summary ? summary + (impact ? '\n\n' + impact : '') : '');
      results.push({
        entry: parseResult.data,
        narrative,
      });
    }
  }

  return results;
}
