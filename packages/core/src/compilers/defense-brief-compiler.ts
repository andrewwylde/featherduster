import { ResumeSpec } from '../schemas/resume.js';
import { EvidenceStore } from '../parsers/index-store.js';

export interface DefenseBriefOptions {
  candidateName?: string;
  targetCompany?: string;
  targetRole?: string;
  jobDescription?: string;
  matchedKeywords?: string[];
  missingKeywords?: string[];
  date?: string;
}

/**
 * Compiles a confidential, unredacted Interview Defense Brief mapping
 * every tailored resume bullet directly to underlying evidence ledger entries,
 * internal tickets, raw metrics, and architectural decision context.
 */
export function compileDefenseBrief(
  spec: ResumeSpec,
  store: EvidenceStore,
  options?: DefenseBriefOptions
): string {
  const candidateName = options?.candidateName || spec.profile?.name || 'Candidate';
  const roleTitle = options?.targetRole || spec.profile?.title || 'Engineering Role';
  const company = options?.targetCompany || 'Target Company';
  const briefDate = options?.date || new Date().toISOString().split('T')[0];

  const lines: string[] = [];

  // Header
  lines.push(`# 🛡️ Interview Defense Brief: ${candidateName}`);
  lines.push(`**Target Role:** ${roleTitle} at ${company}  `);
  lines.push(`**Generated:** ${briefDate} · *Strictly Confidential / Private Candidate Prep*  `);
  lines.push(
    `> **Purpose:** This dossier maps every bullet point on your tailored resume directly to verified evidence entries, unredacted employer tickets, real-world trade-offs, and technical defense angles for interview panels.\n`
  );

  // Section 1: Target Role Alignment & Keywords
  lines.push(`## 1. Role Signal & Keyword Alignment\n`);
  if (options?.matchedKeywords && options.matchedKeywords.length > 0) {
    lines.push(`### ✔ Verified Competencies Matched (${options.matchedKeywords.length})`);
    lines.push(
      options.matchedKeywords.map((kw) => `\`${kw}\``).join(' · ') + '\n'
    );
  }

  if (options?.missingKeywords && options.missingKeywords.length > 0) {
    lines.push(`### ⚠ Unmatched JD Requirements / Potential Inquiries (${options.missingKeywords.length})`);
    lines.push(
      `The target job description highlights the following concepts which are not explicitly prominent in your active resume bullets. Be prepared to address these through foundational knowledge or adjacent systems:`
    );
    for (const kw of options.missingKeywords.slice(0, 10)) {
      lines.push(`- **${kw}**: Position using adjacent architecture or transferable system design patterns.`);
    }
    lines.push('');
  }

  if (spec.summary) {
    lines.push(`### Tailored Pitch Summary`);
    lines.push(`> "${spec.summary}"\n`);
  }

  // Section 2: Bullet-by-Bullet Evidence Verification Map
  lines.push(`## 2. Bullet-by-Bullet Technical Defense Map\n`);

  let totalIncludedBullets = 0;
  let citedBulletsCount = 0;

  for (const exp of spec.experiences || []) {
    const includedBullets = (exp.bullets || []).filter((b) => b.text && b.text.trim().length > 0);
    if (includedBullets.length === 0) continue;

    lines.push(`### ${exp.company} — ${exp.role} (${exp.startDate} – ${exp.endDate})`);
    if (exp.location) {
      lines.push(`*Location:* ${exp.location}\n`);
    } else {
      lines.push('');
    }

    for (let i = 0; i < includedBullets.length; i++) {
      const b = includedBullets[i];
      totalIncludedBullets++;

      // Extract citation IDs from bullet citations array or inline tags
      const citedIds = new Set<string>(b.citations || []);
      const tagMatches = b.text.matchAll(/\((ev-\d+)\)/g);
      for (const m of tagMatches) {
        citedIds.add(m[1]);
      }

      // Clean citation tags for the heading quote
      const cleanBulletText = b.text.replace(/\s*\(ev-\d+\)/g, '').trim();

      lines.push(`#### Bullet ${i + 1}`);
      lines.push(`> "${cleanBulletText}"\n`);

      if (citedIds.size === 0) {
        lines.push(`- **Evidence Status:** ⚠️ *No explicit citation attached.* Review your work log to ensure you can defend this claim with concrete metrics and architecture decisions.\n`);
        continue;
      }

      citedBulletsCount++;

      for (const evId of citedIds) {
        const record = store.get(evId);
        if (!record) {
          lines.push(`- **Citation:** \`${evId}\` ⚠️ *(Not found in local evidence store)*\n`);
          continue;
        }

        const entry = record.entry;
        const confidenceBadge =
          entry.confidence === 'verified'
            ? '✅ Verified'
            : entry.confidence === 'provisional'
            ? '⚠️ Provisional'
            : '❌ Retracted';

        lines.push(`##### Evidence Entry: \`${entry.id}\` — ${entry.title}`);
        lines.push(`- **Ledger Date & Confidence:** ${entry.date} · **${confidenceBadge}**`);
        if (entry.summary) {
          lines.push(`- **Ledger Summary:** ${entry.summary}`);
        }
        if (entry.impact) {
          lines.push(`- **Reported Impact:** ${entry.impact}`);
        }

        // Metrics breakdown
        if (entry.metrics && entry.metrics.length > 0) {
          lines.push(`- **Quantitative Proof Points:**`);
          for (const m of entry.metrics) {
            lines.push(`  - \`${m.name}\`: **${m.value}** (${m.status})`);
          }
        }

        // Unredacted internal references for candidate defense
        if (entry.internal_references && entry.internal_references.length > 0) {
          lines.push(`- **Internal Ticket & Traceability (CONFIDENTIAL):**`);
          for (const ref of entry.internal_references) {
            lines.push(`  - [${ref.type.toUpperCase()}] \`${ref.ref}\``);
          }
        }

        // Architectural context & narrative notes from evidence markdown body
        if (record.narrative && record.narrative.trim().length > 0) {
          lines.push(`- **Implementation Details & Decisions:**`);
          // Indent narrative lines
          const narrativeLines = record.narrative
            .trim()
            .split('\n')
            .filter((l) => l.trim().length > 0);
          for (const nl of narrativeLines) {
            lines.push(`  > ${nl}`);
          }
        }

        // Suggested Interview Talking Points / Deep-Dive Angle
        lines.push(`- **Anticipated Interview Deep-Dives:**`);
        lines.push(`  - *Technical Trade-offs:* What alternative architectures did you consider before this approach?`);
        lines.push(`  - *Failure Modes:* How did you handle edge cases, partition splits, or regression risks?`);
        if (entry.metrics && entry.metrics.length > 0) {
          lines.push(`  - *Metric Attribution:* Be ready to explain how ${entry.metrics[0].value} was measured and isolated from other concurrent deployments.`);
        }
        lines.push('');
      }
    }
  }

  // Section 3: Ledger Coverage Summary
  lines.push(`## 3. Dossier Audit Statistics\n`);
  const coveragePct =
    totalIncludedBullets > 0
      ? Math.round((citedBulletsCount / totalIncludedBullets) * 100)
      : 0;
  lines.push(`- **Total Resume Bullets:** ${totalIncludedBullets}`);
  lines.push(`- **Bullets Backed by Evidence:** ${citedBulletsCount} (${coveragePct}% coverage)`);
  lines.push(`- **Ledger Verification Status:** ${coveragePct === 100 ? '✅ 100% Audit-Proof' : '⚠️ Contains uncited bullets'}`);
  lines.push(`\n---\n*End of Confidential Interview Defense Brief · Featherduster*`);

  return lines.join('\n');
}
