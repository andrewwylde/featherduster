export type ATSSchema = 'greenhouse' | 'lever' | 'generic';

export type ATSIssueType =
  | 'missing_section'
  | 'multi_column_distortion'
  | 'malformed_header'
  | 'keyword_gap'
  | 'parsing_anomaly';

export interface ATSIssue {
  type: ATSIssueType;
  message: string;
  section?: string;
  severity: 'error' | 'warning';
  line?: number;
}

export interface ATSAnalysisResult {
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'poor';
  isClean: boolean;
  issues: ATSIssue[];
  sectionsFound: string[];
  sectionsMissing: string[];
  keywordMatches: number;
  keywordTotal: number;
  schema: ATSSchema;
}

export interface ParsedSection {
  name: string;
  canonicalName: string;
  rawHeader: string;
  content: string;
  line: number;
}

export const STANDARD_SECTIONS: Record<string, string[]> = {
  Summary: ['summary', 'professional summary', 'executive summary', 'profile', 'about', 'overview'],
  Experience: ['experience', 'work experience', 'professional experience', 'employment history', 'work history'],
  Education: ['education', 'academic background', 'academic history', 'degrees'],
  Skills: ['skills', 'technical skills', 'core competencies', 'technologies', 'tools & technologies'],
};

export const DEFAULT_ATS_KEYWORDS: Record<ATSSchema, string[]> = {
  greenhouse: ['architecture', 'leadership', 'distributed', 'performance', 'latency', 'testing', 'ci/cd', 'agile'],
  lever: ['infrastructure', 'scalability', 'cross-functional', 'optimization', 'metrics', 'monitoring', 'cloud'],
  generic: ['development', 'engineering', 'design', 'implementation', 'collaboration', 'production', 'systems'],
};

/**
 * Match a raw header string against canonical standard sections.
 */
function matchStandardSection(rawName: string): string | null {
  const normalized = rawName.trim().toLowerCase().replace(/^#+\s*/, '').replace(/[:\-_]+$/, '');
  for (const [canonical, aliases] of Object.entries(STANDARD_SECTIONS)) {
    if (canonical.toLowerCase() === normalized || aliases.some((a) => a === normalized || normalized.includes(a))) {
      return canonical;
    }
  }
  return null;
}

/**
 * Extract headers from text, noting whether they are clean markdown headers or malformed.
 */
export function extractSectionHeaders(text: string): { headers: string[]; issues: ATSIssue[] } {
  const lines = text.split('\n');
  const headers: string[] = [];
  const issues: ATSIssue[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;

    // Standard markdown headers (## Experience, # Skills, etc.)
    const mdMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (mdMatch) {
      headers.push(mdMatch[1].trim());
      continue;
    }

    // Underlined headers (Header\n--- or Header\n===)
    if (idx + 1 < lines.length && /^[=-]{3,}$/.test(lines[idx + 1].trim()) && line.length < 50 && !line.startsWith('-')) {
      headers.push(line);
      continue;
    }

    // Malformed: ALL CAPS standalone line with no markdown header syntax
    if (/^[A-Z\s]{4,30}$/.test(line) && !line.startsWith('-') && !line.startsWith('*')) {
      const matched = matchStandardSection(line);
      if (matched) {
        headers.push(line);
        issues.push({
          type: 'malformed_header',
          message: `Header '${line}' appears in ALL CAPS without markdown header prefix ('## ${line}'). ATS parsers may fail to recognize this section boundary.`,
          section: matched,
          severity: 'warning',
          line: idx + 1,
        });
      }
    }
  }

  return { headers, issues };
}

/**
 * Detect multi-column layout artifacts that cause ATS text interleaving.
 */
export function detectMultiColumnDistortion(text: string): { distorted: boolean; issues: ATSIssue[] } {
  const lines = text.split('\n');
  const issues: ATSIssue[] = [];

  // Check 1: Table markdown syntax in resume body (ATS flattens tables and mixes cells)
  const tableRows = lines.filter((l) => /^\s*\|.+\|\s*$/.test(l));
  if (tableRows.length >= 3) {
    issues.push({
      type: 'multi_column_distortion',
      message: 'Markdown table detected. Multi-column tables are frequently flattened into scrambled lines by Greenhouse/Lever parsers.',
      severity: 'warning',
    });
  }

  // Check 2: Clusters of abnormally short bullet lines suggesting side-by-side column wrapping
  let shortBulletStreak = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = lines[idx].trim();
    if (/^[-*•]\s+/.test(trimmed) && trimmed.length < 32) {
      shortBulletStreak++;
      if (shortBulletStreak >= 4) {
        issues.push({
          type: 'multi_column_distortion',
          message: 'Cluster of abnormally short bullet items (<32 chars) detected, indicative of side-by-side column distortion.',
          severity: 'warning',
          line: idx + 1,
        });
        break;
      }
    } else if (trimmed.length > 0) {
      shortBulletStreak = 0;
    }
  }

  return { distorted: issues.length > 0, issues };
}

/**
 * Score keyword occurrences across plain-text resume.
 */
export function computeKeywordScore(text: string, keywords: string[]): { matches: number; total: number } {
  if (!keywords || keywords.length === 0) {
    return { matches: 0, total: 0 };
  }

  const lower = text.toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    const cleanKw = kw.trim().toLowerCase();
    if (!cleanKw) continue;
    // Word boundary or token match
    const regex = new RegExp(`(^|[^a-z0-9])${cleanKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (regex.test(lower)) {
      matches++;
    }
  }

  return { matches, total: keywords.length };
}

/**
 * Simulate Greenhouse ATS plain-text parsing.
 */
export function simulateGreenhouseParse(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = text.split('\n');
  let currentSection = 'Header';
  let buffer: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,2}\s+(.+)$/);
    if (headerMatch) {
      if (buffer.length > 0) {
        sections[currentSection] = buffer.join('\n').trim();
        buffer = [];
      }
      currentSection = headerMatch[1].trim();
    } else {
      buffer.push(line);
    }
  }

  if (buffer.length > 0) {
    sections[currentSection] = buffer.join('\n').trim();
  }

  return sections;
}

/**
 * Simulate Lever ATS plain-text parsing.
 */
export function simulateLeverParse(text: string): Record<string, string> {
  // Lever flattens symbols and collapses consecutive line breaks
  const sanitized = text.replace(/[*#_~`]/g, '').replace(/\r/g, '');
  const lines = sanitized.split('\n');
  const sections: Record<string, string> = {};
  let current = 'Body';
  let buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const matched = matchStandardSection(trimmed);
    if (matched && trimmed.length < 35) {
      if (buffer.length > 0) {
        sections[current] = buffer.join('\n').trim();
        buffer = [];
      }
      current = matched;
    } else {
      buffer.push(line);
    }
  }

  if (buffer.length > 0) {
    sections[current] = buffer.join('\n').trim();
  }

  return sections;
}

/**
 * Full ATS Simulation and Readability Analysis.
 */
export function analyzeATS(
  text: string,
  schema: ATSSchema = 'greenhouse',
  targetKeywords?: string[],
): ATSAnalysisResult {
  const trimmed = text.trim();
  if (!trimmed) {
    const allMissing = Object.keys(STANDARD_SECTIONS);
    return {
      score: 0,
      band: 'poor',
      isClean: false,
      issues: allMissing.map((s) => ({
        type: 'missing_section',
        message: `Missing required ATS section: ${s}`,
        section: s,
        severity: 'error',
      })),
      sectionsFound: [],
      sectionsMissing: allMissing,
      keywordMatches: 0,
      keywordTotal: targetKeywords?.length ?? 0,
      schema,
    };
  }

  const issues: ATSIssue[] = [];

  // 1. Extract and check section headers
  const { headers, issues: headerIssues } = extractSectionHeaders(text);
  issues.push(...headerIssues);

  const foundSet = new Set<string>();
  for (const h of headers) {
    const canonical = matchStandardSection(h);
    if (canonical) {
      foundSet.add(canonical);
    }
  }

  const sectionsFound = Array.from(foundSet);
  const sectionsMissing = Object.keys(STANDARD_SECTIONS).filter((s) => !foundSet.has(s));

  for (const missing of sectionsMissing) {
    issues.push({
      type: 'missing_section',
      message: `Standard ATS section '${missing}' not recognized. Greenhouse and Lever parsers expect this heading.`,
      section: missing,
      severity: missing === 'Experience' || missing === 'Education' ? 'error' : 'warning',
    });
  }

  // 2. Check multi-column distortion
  const { issues: distortionIssues } = detectMultiColumnDistortion(text);
  issues.push(...distortionIssues);

  // 3. Keyword matching
  const keywords = targetKeywords && targetKeywords.length > 0 ? targetKeywords : DEFAULT_ATS_KEYWORDS[schema];
  const { matches: keywordMatches, total: keywordTotal } = computeKeywordScore(text, keywords);

  if (keywordTotal > 0 && keywordMatches / keywordTotal < 0.4) {
    issues.push({
      type: 'keyword_gap',
      message: `Low ATS keyword match: only ${keywordMatches}/${keywordTotal} core role terms found.`,
      severity: 'warning',
    });
  }

  // 4. Calculate score
  let score = 100;

  // Section penalties
  for (const missing of sectionsMissing) {
    score -= missing === 'Experience' ? 25 : missing === 'Education' ? 20 : 15;
  }

  // Distortion penalties
  for (const d of distortionIssues) {
    score -= 10;
  }

  // Header formatting penalties
  for (const h of headerIssues) {
    score -= 5;
  }

  // Keyword scoring modifier
  if (keywordTotal > 0) {
    const ratio = keywordMatches / keywordTotal;
    if (ratio < 0.3) {
      score -= 15;
    } else if (ratio < 0.6) {
      score -= 5;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let band: 'excellent' | 'good' | 'fair' | 'poor' = 'poor';
  if (score >= 85) {
    band = 'excellent';
  } else if (score >= 70) {
    band = 'good';
  } else if (score >= 50) {
    band = 'fair';
  }

  return {
    score,
    band,
    isClean: issues.filter((i) => i.severity === 'error').length === 0 && distortionIssues.length === 0,
    issues,
    sectionsFound,
    sectionsMissing,
    keywordMatches,
    keywordTotal,
    schema,
  };
}