import {
  LevelingRubric,
  LevelingRubricSchema,
  RubricLevel,
  RubricCompetency,
} from '../schemas/rubric.js';

export interface ParseRubricOptions {
  id?: string;
  title?: string;
  target_level?: string;
}

function parseLevelHeader(header: string): { id: string; name: string } {
  const trimmed = header.trim();
  // e.g. "L3: Junior / Mid" or "L4 - Senior Engineer" or "Level 5 – Staff" or "L6 — Principal"
  const delimMatch = trimmed.match(/^([A-Za-z0-9_.\-\s]+?)\s*[:\-–—]\s*(.+)$/);
  if (delimMatch) {
    return { id: delimMatch[1].trim(), name: delimMatch[2].trim() || delimMatch[1].trim() };
  }
  // e.g. "L5 (Staff / Tech Lead)"
  const parenMatch = trimmed.match(/^([A-Za-z0-9_.\-\s]+?)\s*\((.+)\)$/);
  if (parenMatch) {
    return { id: parenMatch[1].trim(), name: parenMatch[2].trim() || parenMatch[1].trim() };
  }
  // e.g. "Staff / Tech Lead (L5)"
  const revParenMatch = trimmed.match(/^(.+?)\s*\(([A-Za-z0-9_.\-\s]+)\)$/);
  if (revParenMatch) {
    return { id: revParenMatch[2].trim(), name: revParenMatch[1].trim() };
  }
  return { id: trimmed, name: trimmed };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFullCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function parseMarkdownLine(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.substring(1);
  }
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }

  // Preserve escaped pipes: replace \| with placeholder
  const placeholder = '__FD_ESCAPED_PIPE__';
  const safe = trimmed.replace(/\\\|/g, placeholder);
  const parts = safe.split('|');
  return parts.map((p) => p.replace(new RegExp(placeholder, 'g'), '|').trim());
}

function isMarkdownSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  // Check if line consists solely of |, :, -, and whitespace
  return /^[\s|:\-]+$/.test(trimmed);
}

export function parseRubricTable(
  rawText: string,
  options?: ParseRubricOptions
): LevelingRubric {
  if (!rawText || !rawText.trim()) {
    throw new Error('Cannot parse empty rubric table: input text is empty');
  }

  // Detect format: TSV, Markdown, or CSV
  let pipeCount = 0;
  let tabCount = 0;
  for (let i = 0; i < rawText.length; i++) {
    if (rawText[i] === '|') pipeCount++;
    else if (rawText[i] === '\t') tabCount++;
  }

  let format: 'tsv' | 'markdown' | 'csv' = 'markdown';
  if (pipeCount >= 2 && pipeCount >= tabCount) {
    format = 'markdown';
  } else if (tabCount > 0) {
    format = 'tsv';
  } else {
    format = 'csv';
  }

  let rawRows: string[][];
  if (format === 'csv') {
    rawRows = parseFullCsv(rawText);
  } else {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      throw new Error('Cannot parse empty rubric table: no valid lines found');
    }

    rawRows = lines
      .filter((line) => !(format === 'markdown' && isMarkdownSeparator(line)))
      .map((line) => {
        if (format === 'tsv') {
          return line.split('\t').map((c) => c.trim());
        }
        return parseMarkdownLine(line);
      });
  }

  // Filter out trailing empty cells (e.g. from extra pipes like `|||`)
  for (const cells of rawRows) {
    while (cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop();
    }
  }

  // Find header row and data rows
  let headerCells: string[] = [];
  let headerIndex = -1;

  for (let i = 0; i < rawRows.length; i++) {
    const cells = rawRows[i];
    if (cells.length >= 2) {
      headerCells = cells;
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1 || headerCells.length < 2) {
    throw new Error(
      'Invalid rubric table: table must contain at least 2 columns (a competency column and at least one level column)'
    );
  }

  // Extract levels from header (skip the first column which is "Competency" / "Dimension")
  const levelHeaders = headerCells.slice(1);
  const levels: RubricLevel[] = levelHeaders.map((hdr) => parseLevelHeader(hdr));

  const competencies: RubricCompetency[] = [];
  const seenIds = new Set<string>();

  for (let i = headerIndex + 1; i < rawRows.length; i++) {
    const cells = rawRows[i];
    const compName = cells[0]?.trim();
    if (!compName) {
      // Empty row or empty competency name, skip
      continue;
    }

    // Check if the whole row is empty
    const hasAnyContent = cells.some((c) => c.length > 0);
    if (!hasAnyContent) {
      continue;
    }

    let id = slugify(compName) || `competency-${competencies.length + 1}`;
    if (seenIds.has(id)) {
      let counter = 2;
      while (seenIds.has(`${id}-${counter}`)) {
        counter++;
      }
      id = `${id}-${counter}`;
    }
    seenIds.add(id);

    const levelsMap: Record<string, string> = {};
    levels.forEach((lvl, idx) => {
      // Level column corresponds to index idx + 1
      levelsMap[lvl.id] = cells[idx + 1]?.trim() ?? '';
    });

    competencies.push({
      id,
      name: compName,
      levels: levelsMap,
    });
  }

  if (competencies.length === 0) {
    throw new Error('Invalid rubric table: no competency rows could be parsed');
  }

  const defaultId = options?.id ?? (options?.title ? slugify(options.title) : 'imported-rubric');
  const defaultTitle = options?.title ?? 'Imported Leveling Rubric';
  const defaultTargetLevel = options?.target_level ?? levels[0]?.id ?? 'L4';

  const rubric: LevelingRubric = {
    id: defaultId,
    title: defaultTitle,
    target_level: defaultTargetLevel,
    levels,
    competencies,
  };

  return LevelingRubricSchema.parse(rubric);
}
