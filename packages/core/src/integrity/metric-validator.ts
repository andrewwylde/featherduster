import { EvidenceStore, hasMissingMetrics } from '../parsers/index-store.js';

export type MetricIssueType = 'missing_metric' | 'provisional_evidence' | 'retracted_evidence';

export interface MetricIssue {
  type: MetricIssueType;
  message: string;
  line?: number;
}

export interface MetricValidationResult {
  issues: MetricIssue[];
  isClean: boolean;
}

/**
 * Validates text claims for explicit missing metric tokens and cross-references
 * cited evidence entries to flag provisional, retracted, or unverified claims.
 */
export function validateMetrics(text: string, store?: EvidenceStore): MetricValidationResult {
  const issues: MetricIssue[] = [];
  const lines = text.split('\n');

  const prefixes = new Set<string>(['ev']);
  if (store) {
    for (const entry of store.getAll()) {
      const match = entry.id.match(/^([a-z0-9_-]+?)-[0-9]{3}$/i);
      if (match) {
        prefixes.add(match[1].toLowerCase());
      }
    }
  }
  const prefixPattern = Array.from(prefixes).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const citationRegex = new RegExp(`(?<![a-zA-Z0-9_-])((?:${prefixPattern})-[0-9]{3})(?![a-zA-Z0-9_-])`, 'gi');
  const metricNeededRegex = /\[METRIC[\s_-]?NEEDED\]/i;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Detect explicit [METRIC NEEDED] tokens in claims
    // Ignore schema configuration lines (e.g. metric_placeholder: "[METRIC NEEDED]")
    // and rule guidelines that quote the placeholder as an instruction
    const isConfigLine = /^\s*metric_placeholder\s*:/i.test(line);
    const isGuidelineMeta = /use the literal (?:placeholder|string)|is the placeholder|replace `?\[METRIC/i.test(line);

    if (!isConfigLine && !isGuidelineMeta && metricNeededRegex.test(line)) {
      issues.push({
        type: 'missing_metric',
        message: `Line ${lineNum}: Explicit [METRIC NEEDED] token detected`,
        line: lineNum,
      });
    }

    // Check citations against store if store is provided
    if (store) {
      const lineCitations = Array.from(line.matchAll(citationRegex));
      const seenOnLine = new Set<string>();

      for (const match of lineCitations) {
        const rawId = match[1];
        const normalizedId = rawId.toLowerCase();

        if (seenOnLine.has(normalizedId)) {
          continue;
        }
        seenOnLine.add(normalizedId);

        const record = store.get(normalizedId) || store.get(rawId);
        if (!record) {
          continue;
        }

        if (record.confidence === 'provisional') {
          issues.push({
            type: 'provisional_evidence',
            message: `Line ${lineNum}: Claim cites provisional evidence ${record.id}`,
            line: lineNum,
          });
        } else if (record.confidence === 'retracted') {
          issues.push({
            type: 'retracted_evidence',
            message: `Line ${lineNum}: Claim cites retracted evidence ${record.id}`,
            line: lineNum,
          });
        }

        // Check for unverified or missing metrics
        const hasUnverified = record.metrics.some((m) => {
          const status = m.status.toLowerCase();
          return (
            status === 'unverified' ||
            status === 'pending' ||
            status === 'metric needed' ||
            status.includes('needed') ||
            m.value.includes('METRIC NEEDED') ||
            m.name.includes('METRIC NEEDED')
          );
        });

        if (hasUnverified || hasMissingMetrics(record.entry, record.narrative)) {
          issues.push({
            type: 'missing_metric',
            message: `Line ${lineNum}: Evidence ${record.id} contains unverified or missing metrics`,
            line: lineNum,
          });
        }
      }
    }
  }

  return {
    issues,
    isClean: issues.length === 0,
  };
}
