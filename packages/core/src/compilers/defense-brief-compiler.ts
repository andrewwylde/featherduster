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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compiles a standalone, print-ready HTML Interview Defense Brief
 * styled for on-screen review and high-resolution PDF printing.
 */
export function compileHtmlDefenseBrief(
  spec: ResumeSpec,
  store: EvidenceStore,
  options?: DefenseBriefOptions
): string {
  const candidateName = escapeHtml(options?.candidateName || spec.profile?.name || 'Candidate');
  const roleTitle = escapeHtml(options?.targetRole || spec.profile?.title || 'Engineering Role');
  const company = escapeHtml(options?.targetCompany || 'Target Company');
  const briefDate = escapeHtml(options?.date || new Date().toISOString().split('T')[0]);

  let totalIncludedBullets = 0;
  let citedBulletsCount = 0;

  let sectionsHtml = '';

  // 1. Role Signal & Keywords
  let alignmentHtml = '';
  if (options?.matchedKeywords && options.matchedKeywords.length > 0) {
    const kwBadges = options.matchedKeywords
      .map((kw) => `<span class="badge badge-success">${escapeHtml(kw)}</span>`)
      .join(' ');
    alignmentHtml += `
      <div class="mb-4">
        <h3 class="text-sm font-semibold text-slate-700">Verified Competencies Matched (${options.matchedKeywords.length})</h3>
        <div class="keyword-cloud mt-1">${kwBadges}</div>
      </div>
    `;
  }

  if (options?.missingKeywords && options.missingKeywords.length > 0) {
    const missingItems = options.missingKeywords
      .slice(0, 10)
      .map(
        (kw) =>
          `<li><strong>${escapeHtml(kw)}</strong>: Position using adjacent architecture or transferable system design patterns.</li>`
      )
      .join('');
    alignmentHtml += `
      <div class="mb-4 warning-callout">
        <h3 class="text-sm font-semibold text-amber-800">Unmatched JD Requirements / Potential Inquiries (${options.missingKeywords.length})</h3>
        <p class="text-xs text-amber-900 mt-1">The target job description highlights these concepts which are not explicitly prominent in your resume. Be prepared to address them:</p>
        <ul class="text-xs text-amber-950 mt-1 pl-4 list-disc">${missingItems}</ul>
      </div>
    `;
  }

  if (spec.summary) {
    alignmentHtml += `
      <div class="mb-4">
        <h3 class="text-sm font-semibold text-slate-700">Tailored Pitch Summary</h3>
        <blockquote class="pitch-quote">${escapeHtml(spec.summary)}</blockquote>
      </div>
    `;
  }

  // 2. Experience Bullets and Evidence Cards
  let defenseMapHtml = '';
  for (const exp of spec.experiences || []) {
    const includedBullets = (exp.bullets || []).filter((b) => b.text && b.text.trim().length > 0);
    if (includedBullets.length === 0) continue;

    const companyName = escapeHtml(exp.company);
    const roleName = escapeHtml(exp.role);
    const dateRange = `${escapeHtml(exp.startDate)} – ${escapeHtml(exp.endDate)}`;
    const locationStr = exp.location ? ` · ${escapeHtml(exp.location)}` : '';

    let expBulletsHtml = '';

    for (let i = 0; i < includedBullets.length; i++) {
      const b = includedBullets[i];
      totalIncludedBullets++;

      const citedIds = new Set<string>(b.citations || []);
      const tagMatches = b.text.matchAll(/\((ev-\d+)\)/g);
      for (const m of tagMatches) {
        citedIds.add(m[1]);
      }

      const cleanBulletText = escapeHtml(b.text.replace(/\s*\(ev-\d+\)/g, '').trim());

      let evidenceCardsHtml = '';

      if (citedIds.size === 0) {
        evidenceCardsHtml = `
          <div class="uncited-warning">
            ⚠️ <strong>No explicit citation attached.</strong> Review work log to ensure you can defend this claim with concrete metrics and architecture decisions.
          </div>
        `;
      } else {
        citedBulletsCount++;
        for (const evId of citedIds) {
          const record = store.get(evId);
          if (!record) {
            evidenceCardsHtml += `
              <div class="uncited-warning">
                ⚠️ Citation <code>${escapeHtml(evId)}</code> not found in local evidence store.
              </div>
            `;
            continue;
          }

          const entry = record.entry;
          const confClass =
            entry.confidence === 'verified'
              ? 'badge-verified'
              : entry.confidence === 'provisional'
              ? 'badge-provisional'
              : 'badge-retracted';
          const confLabel =
            entry.confidence === 'verified'
              ? '✅ Verified'
              : entry.confidence === 'provisional'
              ? '⚠️ Provisional'
              : '❌ Retracted';

          let metricsHtml = '';
          if (entry.metrics && entry.metrics.length > 0) {
            const metricRows = entry.metrics
              .map(
                (m) =>
                  `<tr><td class="font-mono text-xs">${escapeHtml(m.name)}</td><td class="font-semibold text-xs">${escapeHtml(m.value)}</td><td class="text-xs text-slate-500">${escapeHtml(m.status)}</td></tr>`
              )
              .join('');
            metricsHtml = `
              <div class="sub-section">
                <span class="sub-heading">Quantitative Proof Points:</span>
                <table class="metrics-table">
                  <thead><tr><th>Metric</th><th>Value</th><th>Status</th></tr></thead>
                  <tbody>${metricRows}</tbody>
                </table>
              </div>
            `;
          }

          let refsHtml = '';
          if (entry.internal_references && entry.internal_references.length > 0) {
            const refPills = entry.internal_references
              .map(
                (ref) =>
                  `<span class="badge-ticket">[${escapeHtml(ref.type.toUpperCase())}] ${escapeHtml(ref.ref)}</span>`
              )
              .join(' ');
            refsHtml = `
              <div class="sub-section">
                <span class="sub-heading">Internal Ticket &amp; Traceability (CONFIDENTIAL):</span>
                <div class="mt-1">${refPills}</div>
              </div>
            `;
          }

          let narrativeHtml = '';
          if (record.narrative && record.narrative.trim().length > 0) {
            const cleanNarrative = escapeHtml(record.narrative.trim());
            narrativeHtml = `
              <div class="sub-section">
                <span class="sub-heading">Implementation Details &amp; Decisions:</span>
                <blockquote class="narrative-quote">${cleanNarrative}</blockquote>
              </div>
            `;
          }

          const metricTip =
            entry.metrics && entry.metrics.length > 0
              ? `<li><strong>Metric Attribution:</strong> Be ready to explain how <em>${escapeHtml(entry.metrics[0].value)}</em> was measured and isolated from concurrent deployments.</li>`
              : '';

          evidenceCardsHtml += `
            <div class="evidence-card">
              <div class="evidence-card-header">
                <div>
                  <span class="evidence-id font-mono">${escapeHtml(entry.id)}</span>
                  <span class="evidence-title font-semibold">${escapeHtml(entry.title)}</span>
                </div>
                <div>
                  <span class="badge ${confClass}">${confLabel}</span>
                  <span class="evidence-date font-mono text-xs text-slate-500 ml-2">${escapeHtml(entry.date)}</span>
                </div>
              </div>

              ${entry.summary ? `<p class="evidence-summary mt-2 text-xs text-slate-700">${escapeHtml(entry.summary)}</p>` : ''}
              ${entry.impact ? `<p class="evidence-impact mt-1 text-xs text-emerald-800"><strong>Reported Impact:</strong> ${escapeHtml(entry.impact)}</p>` : ''}

              ${metricsHtml}
              ${refsHtml}
              ${narrativeHtml}

              <div class="sub-section deep-dives-box">
                <span class="sub-heading font-semibold text-indigo-900">Anticipated Interview Deep-Dives:</span>
                <ul class="text-xs text-indigo-950 mt-1 pl-4 list-disc">
                  <li><strong>Technical Trade-offs:</strong> What alternative architectures did you consider before this approach?</li>
                  <li><strong>Failure Modes:</strong> How did you handle edge cases, partition splits, or regression risks?</li>
                  ${metricTip}
                </ul>
              </div>
            </div>
          `;
        }
      }

      expBulletsHtml += `
        <div class="bullet-block">
          <div class="bullet-number">Bullet ${i + 1}</div>
          <blockquote class="bullet-text">"${cleanBulletText}"</blockquote>
          ${evidenceCardsHtml}
        </div>
      `;
    }

    defenseMapHtml += `
      <section class="experience-block">
        <h3 class="experience-title">${companyName} — ${roleName} <span class="experience-meta">(${dateRange}${locationStr})</span></h3>
        ${expBulletsHtml}
      </section>
    `;
  }

  // 3. Stats
  const coveragePct =
    totalIncludedBullets > 0
      ? Math.round((citedBulletsCount / totalIncludedBullets) * 100)
      : 0;
  const isAuditProof = coveragePct === 100;

  const statsHtml = `
    <div class="stats-panel">
      <div class="stat-card">
        <div class="stat-label">Total Bullets</div>
        <div class="stat-value font-mono">${totalIncludedBullets}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cited Bullets</div>
        <div class="stat-value font-mono">${citedBulletsCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Ledger Coverage</div>
        <div class="stat-value font-mono ${isAuditProof ? 'text-emerald-700' : 'text-amber-700'}">${coveragePct}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Verification Status</div>
        <div class="stat-value text-xs font-semibold ${isAuditProof ? 'text-emerald-700' : 'text-amber-700'}">
          ${isAuditProof ? '✅ 100% Audit-Proof' : '⚠️ Contains uncited bullets'}
        </div>
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interview Defense Brief - ${candidateName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #1e293b;
      background: #f8fafc;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .confidential-pill {
      display: inline-block;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 3px 8px;
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    h1 {
      margin: 4px 0 8px 0;
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
    }
    .meta-line {
      font-size: 13px;
      color: #475569;
      margin-bottom: 6px;
    }
    .meta-line strong {
      color: #1e293b;
    }
    .purpose-box {
      margin-top: 12px;
      padding: 10px 14px;
      background: #f1f5f9;
      border-left: 3px solid #6366f1;
      font-size: 12px;
      color: #334155;
      border-radius: 0 4px 4px 0;
    }
    h2.section-heading {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 6px;
      margin-top: 28px;
      margin-bottom: 16px;
    }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 4px;
    }
    .badge-success { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .badge-verified { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .badge-provisional { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .badge-retracted { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .badge-ticket {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .warning-callout {
      background: #fffbeb;
      border: 1px solid #fde68a;
      padding: 12px;
      border-radius: 6px;
    }
    .pitch-quote {
      margin: 8px 0;
      padding: 8px 14px;
      border-left: 3px solid #8b5cf6;
      background: #faf5ff;
      font-style: italic;
      color: #4c1d95;
    }
    .experience-block {
      margin-bottom: 24px;
    }
    .experience-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }
    .experience-meta {
      font-size: 12px;
      font-weight: normal;
      color: #64748b;
    }
    .bullet-block {
      margin-bottom: 18px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .bullet-number {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6366f1;
      margin-bottom: 4px;
    }
    .bullet-text {
      margin: 0 0 10px 0;
      padding: 8px 12px;
      background: #f8fafc;
      border-left: 3px solid #cbd5e1;
      font-weight: 500;
      color: #1e293b;
      font-size: 12.5px;
    }
    .uncited-warning {
      padding: 8px 12px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 4px;
      font-size: 12px;
      color: #92400e;
    }
    .evidence-card {
      margin-top: 8px;
      padding: 14px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .evidence-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 8px;
    }
    .evidence-id {
      font-size: 12px;
      font-weight: 700;
      color: #4338ca;
      margin-right: 8px;
    }
    .evidence-title {
      font-size: 13px;
      color: #0f172a;
    }
    .sub-section {
      margin-top: 10px;
    }
    .sub-heading {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
    }
    .metrics-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      font-size: 12px;
    }
    .metrics-table th {
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
      padding: 4px 8px;
      color: #64748b;
      font-weight: 600;
    }
    .metrics-table td {
      border-bottom: 1px solid #f1f5f9;
      padding: 4px 8px;
    }
    .narrative-quote {
      margin: 4px 0 0 0;
      padding: 6px 10px;
      background: #f8fafc;
      border-left: 2px solid #94a3b8;
      font-size: 11.5px;
      color: #334155;
      white-space: pre-wrap;
    }
    .deep-dives-box {
      background: #eef2ff;
      border: 1px solid #c7d2fe;
      border-radius: 5px;
      padding: 10px 12px;
      margin-top: 10px;
    }
    .stats-panel {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      padding: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      text-align: center;
    }
    .stat-label {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 600;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 700;
      margin-top: 4px;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
    }
    @media print {
      body {
        background: #ffffff;
        padding: 0;
        font-size: 10pt;
      }
      .container {
        border: none;
        padding: 0;
        box-shadow: none;
        max-width: 100%;
      }
      .deep-dives-box {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
      }
      @page {
        margin: 12mm 15mm;
        size: letter portrait;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="confidential-pill">🛡️ STRICTLY CONFIDENTIAL · INTERVIEW DEFENSE DOSSIER</span>
      <h1>Interview Defense Brief: ${candidateName}</h1>
      <div class="meta-line"><strong>Target Role:</strong> ${roleTitle} at ${company}</div>
      <div class="meta-line"><strong>Generated:</strong> ${briefDate} · <em>Private Candidate Preparation</em></div>
      <div class="purpose-box">
        <strong>Purpose:</strong> This dossier maps every bullet point on your tailored resume directly to verified evidence entries, unredacted employer tickets, real-world trade-offs, and technical defense angles for interview panels.
      </div>
    </div>

    ${alignmentHtml ? `<h2 class="section-heading">1. Role Signal &amp; Keyword Alignment</h2>${alignmentHtml}` : ''}

    <h2 class="section-heading">2. Bullet-by-Bullet Technical Defense Map</h2>
    ${defenseMapHtml}

    <h2 class="section-heading">3. Dossier Audit Statistics</h2>
    ${statsHtml}

    <div class="footer">
      End of Confidential Interview Defense Brief · Featherduster Ledger Defense Engine
    </div>
  </div>
</body>
</html>`;
}
