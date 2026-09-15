import { LevelingRubric } from '../schemas/rubric.js';
import { EvidenceStore, hasMissingMetrics } from '../parsers/index-store.js';

export interface CompetencyGapReport {
  id: string;
  name: string;
  status: 'met' | 'partial' | 'gap';
  verifiedCount: number;
  provisionalCount: number;
  issues: string[];
}

export interface RubricGapAnalysis {
  targetLevel: string;
  totalCompetencies: number;
  coveredCompetencies: number;
  gapPercentage: number;
  competencies: CompetencyGapReport[];
}

/**
 * Analyzes competency coverage gaps by evaluating mapped evidence in the EvidenceStore
 * against a LevelingRubric for a specific target level.
 */
export function analyzeCompetencyGaps(
  rubric: LevelingRubric,
  store: EvidenceStore,
  targetLevel?: string
): RubricGapAnalysis {
  const effectiveTargetLevel = targetLevel ?? rubric.target_level;
  const reports: CompetencyGapReport[] = [];

  for (const competency of rubric.competencies) {
    const issues: string[] = [];
    let verifiedCount = 0;
    let provisionalCount = 0;

    // Check if rubric criteria exist for this target level
    if (
      !competency.levels[effectiveTargetLevel] ||
      !competency.levels[effectiveTargetLevel].trim()
    ) {
      issues.push(`No rubric criteria defined for target level '${effectiveTargetLevel}'`);
    }

    // Determine mapped evidence entries
    let mappedEvIds: string[] = [];
    if (competency.evidence_mapped && competency.evidence_mapped.length > 0) {
      mappedEvIds = competency.evidence_mapped.map((m) => m.ev_id);
    } else {
      // Fallback: discover evidence in store tagged with competency id or name
      const matching = store.getAll().filter((record) =>
        record.themes.some(
          (t) =>
            t.toLowerCase() === competency.id.toLowerCase() ||
            t.toLowerCase() === competency.name.toLowerCase()
        )
      );
      mappedEvIds = matching.map((r) => r.id);
    }

    // Deduplicate ev_ids
    const uniqueEvIds = Array.from(new Set(mappedEvIds));

    let cleanVerifiedCount = 0;

    if (uniqueEvIds.length === 0) {
      issues.push('No evidence mapped for competency');
    } else {
      for (const evId of uniqueEvIds) {
        const record = store.get(evId);
        if (!record) {
          issues.push(`Mapped evidence '${evId}' not found in store`);
          continue;
        }

        if (record.confidence === 'retracted') {
          issues.push(`Evidence '${evId}' has retracted confidence`);
          continue;
        }

        if (record.in_flight) {
          issues.push(`Evidence '${evId}' is in-flight`);
        }

        const missingMetrics = hasMissingMetrics(record.entry, record.narrative);
        if (missingMetrics) {
          issues.push(`Evidence '${evId}' has unverified or missing metrics`);
        }

        if (record.confidence === 'verified') {
          verifiedCount++;
          if (!record.in_flight && !missingMetrics) {
            cleanVerifiedCount++;
          }
        } else if (record.confidence === 'provisional') {
          provisionalCount++;
          issues.push(`Evidence '${evId}' has provisional confidence`);
        }
      }
    }

    // Status evaluation:
    // 'met': at least 1 verified entry, clean metrics, not in-flight, no missing evidence, level criteria exists
    // 'partial': has evidence (provisional or verified with issues or missing metrics or in-flight)
    // 'gap': 0 verified and 0 provisional (or all retracted/missing), or 0 evidence mapped
    let status: 'met' | 'partial' | 'gap' = 'gap';

    if (verifiedCount === 0 && provisionalCount === 0) {
      status = 'gap';
    } else if (cleanVerifiedCount > 0 && issues.length === 0) {
      status = 'met';
    } else {
      status = 'partial';
    }

    reports.push({
      id: competency.id,
      name: competency.name,
      status,
      verifiedCount,
      provisionalCount,
      issues,
    });
  }

  const totalCompetencies = reports.length;
  const coveredCompetencies = reports.filter((r) => r.status === 'met').length;
  const gapPercentage =
    totalCompetencies === 0
      ? 0
      : Math.round(((totalCompetencies - coveredCompetencies) / totalCompetencies) * 100);

  return {
    targetLevel: effectiveTargetLevel,
    totalCompetencies,
    coveredCompetencies,
    gapPercentage,
    competencies: reports,
  };
}
