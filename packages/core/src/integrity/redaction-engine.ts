import { PrivacyRulesConfig } from '../schemas/privacy.js';

export interface RedactResult {
  redactedText: string;
  violations: string[];
  isClean: boolean;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes horizontal whitespace, eliminates empty brackets/parens,
 * removes spaces before punctuation, and trims each line while preserving
 * multiline paragraph structures.
 */
function normalizeSpacing(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let cleaned = line
        // Remove empty parens or brackets like () or []
        .replace(/\(\s*\)/g, '')
        .replace(/\[\s*\]/g, '')
        // Collapse multiple horizontal whitespace characters into a single space
        .replace(/[ \t]+/g, ' ')
        // Remove space before punctuation: . , ; : ! ? ) ] }
        .replace(/ +([.,;:!?\)\]\}])/g, '$1')
        // Remove space after opening brackets: ( [ {
        .replace(/([\(\[\{]) +/g, '$1')
        // Trim leading and trailing whitespace on the line
        .trim();
      return cleaned;
    })
    .join('\n');
}

/**
 * Checks whether a keyword exists in text as an isolated token.
 */
function hasKeywordMatch(text: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword);
  const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, 'i');
  return regex.test(text);
}

/**
 * Redacts confidential details from text by:
 * 1. Stripping citation tags (e.g. (ev-042)) and normalizing spacing.
 * 2. Stripping ticket IDs according to strip_patterns.
 * 3. Replacing confidential entities using the replacements dictionary.
 * 4. Scanning the resulting text for banned_keywords violations.
 */
export function redactText(text: string, rules: PrivacyRulesConfig): RedactResult {
  let currentText = text;

  // 1. Strip internal citation tags (e.g. (ev-042), (ev-001, ev-002), [ev-042], ev-042)
  currentText = currentText.replace(
    /(?:\s*\(|\s*\[)\s*(?:ev-[0-9]+)(?:\s*,\s*ev-[0-9]+)*\s*(?:\)|\s*\])/gi,
    ''
  );
  currentText = currentText.replace(/(?<![a-zA-Z0-9_-])ev-[0-9]+(?![a-zA-Z0-9_-])/gi, '');

  // 2. Strip internal ticket IDs according to strip_patterns
  const stripPatterns = rules.strip_patterns ?? [];
  for (const pattern of stripPatterns) {
    if (!pattern) continue;
    try {
      if (!pattern.includes('(') && !pattern.includes('[')) {
        const parenRegex = new RegExp(`(?:\\s*\\(|\\s*\\[)\\s*(?:${pattern})\\s*(?:\\)|\\s*\\])`, 'gi');
        currentText = currentText.replace(parenRegex, '');
      }
      const standaloneRegex = new RegExp(`(?<![a-zA-Z0-9_-])(?:${pattern})(?![a-zA-Z0-9])`, 'gi');
      currentText = currentText.replace(standaloneRegex, '');
    } catch {
      try {
        const fallbackRegex = new RegExp(pattern, 'gi');
        currentText = currentText.replace(fallbackRegex, '');
      } catch {
        // ignore invalid regex patterns
      }
    }
  }

  // 3. Replace confidential client/partner names or internal tools using replacements dictionary
  const replacements = rules.replacements ?? [];
  for (const rule of replacements) {
    if (!rule.search) continue;
    const escaped = escapeRegExp(rule.search);
    const regex = new RegExp(escaped, 'gi');
    currentText = currentText.replace(regex, () => rule.replace);
  }

  // Normalize whitespace and punctuation cleanly across lines
  currentText = normalizeSpacing(currentText);

  // 4. Scan for banned_keywords in the redacted text
  const bannedKeywords = rules.banned_keywords ?? [];
  const violations: string[] = [];
  const seenViolations = new Set<string>();

  for (const keyword of bannedKeywords) {
    if (!keyword || !keyword.trim()) continue;
    const trimmed = keyword.trim();
    if (hasKeywordMatch(currentText, trimmed)) {
      if (!seenViolations.has(trimmed)) {
        seenViolations.add(trimmed);
        violations.push(trimmed);
      }
    }
  }

  return {
    redactedText: currentText,
    violations,
    isClean: violations.length === 0,
  };
}
