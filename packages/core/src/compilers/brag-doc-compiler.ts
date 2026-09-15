import { LevelingRubric } from '../schemas/rubric.js';
import { EvidenceStore, hasMissingMetrics } from '../parsers/index-store.js';
import { PrivacyRulesConfig } from '../schemas/privacy.js';
import { redactText } from '../integrity/redaction-engine.js';

export interface BragDocOptions {
  candidateName?: string;
  period?: string;
  rules?: PrivacyRulesConfig;
}

function maybeRedact(text: string, rules?: PrivacyRulesConfig): string {
  if (!rules || !text) return text;
  return redactText(text, rules).redactedText;
}

/**
 * Compiles a complete performance review brag doc / promotion packet
 * grouped under the rubric's competencies with verified accomplishments,
 * outcomes, impact metrics, and flagged provisional evidence or missing metrics.
 */
export function compileBragDoc(
  rubric: LevelingRubric,
  store: EvidenceStore,
  options?: BragDocOptions
): string {
  const rules = options?.rules;
  const sections: string[] = [];

  // Header
  const titleParts: string[] = ['# Performance Brag Document'];
  if (options?.candidateName) {
    titleParts[0] += `: ${maybeRedact(options.candidateName, rules)}`;
  }

  const metaLines: string[] = [];
  if (options?.period) {
    metaLines.push(`**Period**: ${maybeRedact(options.period, rules)}`);
  }
  metaLines.push(`**Rubric**: ${maybeRedact(rubric.title, rules)} (Target Level: ${rubric.target_level})`);

  sections.push(`${titleParts.join('')}\n\n${metaLines.join('\n')}`);

  // Competencies
  for (const competency of rubric.competencies) {
    const compLines: string[] = [];
    const compName = maybeRedact(competency.name, rules);
    compLines.push(`## ${compName}`);

    // Level expectation
    const expectation = competency.levels[rubric.target_level];
    if (expectation) {
      compLines.push(`**Target Level Expectations (${rubric.target_level})**:\n> ${maybeRedact(expectation, rules)}`);
    }

    // Determine mapped evidence entries
    let mappedItems: Array<{ evId: string; relevance?: string; narrative?: string }> = [];
    if (competency.evidence_mapped && competency.evidence_mapped.length > 0) {
      mappedItems = competency.evidence_mapped.map((m) => ({
        evId: m.ev_id,
        relevance: m.relevance,
        narrative: m.narrative,
      }));
    } else {
      // Fallback: discover evidence in store tagged with competency id or name
      const matching = store.getAll().filter((record) =>
        record.themes.some(
          (t) =>
            t.toLowerCase() === competency.id.toLowerCase() ||
            t.toLowerCase() === competency.name.toLowerCase()
        )
      );
      mappedItems = matching.map((r) => ({ evId: r.id }));
    }

    if (mappedItems.length === 0) {
      compLines.push('*Status: Gap — No evidence mapped for this competency.*');
    } else {
      for (const item of mappedItems) {
        const record = store.get(item.evId);
        if (!record) {
          compLines.push(`*Evidence record '${item.evId}' not found in store.*`);
          continue;
        }

        const isProvisional = record.confidence === 'provisional';
        const isRetracted = record.confidence === 'retracted';
        const missingMetrics = hasMissingMetrics(record.entry, record.narrative);
        const isInFlight = record.in_flight;

        const badges: string[] = [];
        if (isProvisional) badges.push('[PROVISIONAL]');
        else if (isRetracted) badges.push('[RETRACTED]');
        else badges.push('[VERIFIED]');

        if (isInFlight) badges.push('[IN-FLIGHT]');
        if (missingMetrics) badges.push('[MISSING METRICS]');

        const badgeStr = badges.join(' ');
        const cleanTitle = maybeRedact(record.entry.title, rules);
        const cleanCompany = maybeRedact(record.entry.company, rules);

        const evLines: string[] = [
          `### ${cleanTitle} ${badgeStr}`,
          `- **Evidence ID**: ${record.id} (${record.entry.date}) | **Organization**: ${cleanCompany}`,
          `- **Accomplishment**: ${maybeRedact(record.entry.summary, rules)}`,
          `- **Impact & Outcome**: ${maybeRedact(record.entry.impact, rules)}`,
        ];

        if (item.relevance) {
          evLines.push(`- **Rubric Alignment**: ${maybeRedact(item.relevance, rules)}`);
        }

        if (record.entry.metrics.length > 0) {
          const metricItems = record.entry.metrics
            .map((m) => {
              const name = maybeRedact(m.name, rules);
              const val = maybeRedact(m.value, rules);
              return `  - ${name}: ${val} (${m.status})`;
            })
            .join('\n');
          evLines.push(`- **Key Metrics**:\n${metricItems}`);
        }

        const narrativeText = item.narrative || record.narrative;
        if (narrativeText && narrativeText.trim()) {
          evLines.push(`- **Details**: ${maybeRedact(narrativeText, rules)}`);
        }

        if (record.entry.internal_references.length > 0) {
          const cleanedRefs = record.entry.internal_references
            .map((r) => {
              const refStr = maybeRedact(`${r.type}: ${r.ref}`, rules);
              return refStr.replace(/^[a-zA-Z_-]+:\s*$/, '').trim();
            })
            .filter(Boolean);

          if (cleanedRefs.length > 0) {
            evLines.push(`- **Internal References**: ${cleanedRefs.join(', ')}`);
          }
        }

        compLines.push(evLines.join('\n'));
      }
    }

    sections.push(compLines.join('\n\n'));
  }

  return sections.join('\n\n---\n\n').trim() + '\n';
}
