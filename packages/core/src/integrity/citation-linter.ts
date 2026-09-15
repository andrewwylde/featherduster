import { EvidenceStore } from '../parsers/index-store.js';

export interface CitationLintResult {
  validCitations: string[];
  danglingCitations: string[];
  isClean: boolean;
}

/**
 * Lints citations in text against an EvidenceStore.
 * Extracts all (ev-[0-9]{3}) or ev-[0-9]{3} citations, resolves each
 * against the store, and flags any dangling citations.
 */
export function lintCitations(text: string, store: EvidenceStore): CitationLintResult {
  const citationRegex = /(?<![a-zA-Z0-9_-])(ev-[0-9]{3})(?![a-zA-Z0-9_-])/gi;
  const validCitations: string[] = [];
  const danglingCitations: string[] = [];
  const seenValid = new Set<string>();
  const seenDangling = new Set<string>();

  const matches = text.matchAll(citationRegex);
  for (const match of matches) {
    const rawId = match[1];
    const normalizedId = rawId.toLowerCase();

    if (store.has(normalizedId) || store.has(rawId)) {
      if (!seenValid.has(normalizedId)) {
        seenValid.add(normalizedId);
        validCitations.push(normalizedId);
      }
    } else {
      if (!seenDangling.has(normalizedId)) {
        seenDangling.add(normalizedId);
        danglingCitations.push(normalizedId);
      }
    }
  }

  return {
    validCitations,
    danglingCitations,
    isClean: danglingCitations.length === 0,
  };
}
