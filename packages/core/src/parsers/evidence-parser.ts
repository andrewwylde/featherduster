import matter, { GrayMatterFile } from 'gray-matter';
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
