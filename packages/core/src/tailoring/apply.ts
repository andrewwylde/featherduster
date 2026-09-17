import type { ResumeBullet, ResumeSpec } from '../schemas/resume.js';
import type { AlignmentMatrix, DefensibilityBrief, JobAnalysis, Proposal } from './schemas.js';
import { effectiveAfter, isBlocked } from './validators.js';

const CHARS_PER_LINE = 110;

function lineCount(text: string | undefined): number {
  if (!text || !text.trim()) return 0;
  return Math.max(1, Math.ceil(text.trim().length / CHARS_PER_LINE));
}

/** Approximate vertical footprint (summary + bullets + skills lines). */
export function estimateResumeLines(spec: ResumeSpec): number {
  let lines = lineCount(spec.summary);
  for (const exp of spec.experiences) {
    lines += 1; // role header
    for (const b of exp.bullets) lines += lineCount(b.text);
  }
  for (const g of spec.skills) lines += lineCount(`${g.category}: ${g.skills.join(', ')}`);
  return lines;
}

interface WorkingBullet {
  originalIndex: number | null;
  bullet: ResumeBullet;
}

/**
 * Applies accepted, unblocked proposals to a deep copy of the base resume.
 * Indices always refer to the ORIGINAL base resume. Order of operations per
 * experience: rewrites → drops → reorder → inserts (anchored before the original
 * bullet at `bullet_index`, or appended).
 */
export function applyProposals(base: ResumeSpec, proposals: Proposal[]): ResumeSpec {
  const spec: ResumeSpec = JSON.parse(JSON.stringify(base));
  const accepted = proposals.filter((p) => p.decision === 'accepted' && !isBlocked(p));

  for (const p of accepted) {
    if (p.type === 'summary.rewrite') spec.summary = effectiveAfter(p);
  }

  spec.experiences = base.experiences.map((exp, ei) => {
    const ops = accepted.filter((p) => p.target.experience_index === ei);
    let working: WorkingBullet[] = exp.bullets.map((b, i) => ({
      originalIndex: i,
      bullet: { ...b },
    }));

    for (const p of ops.filter((o) => o.type === 'bullet.rewrite')) {
      const w = working.find((x) => x.originalIndex === p.target.bullet_index);
      if (w) {
        w.bullet = {
          text: effectiveAfter(p),
          ...(p.citations.length > 0 ? { citations: [...p.citations] } : w.bullet.citations ? { citations: w.bullet.citations } : {}),
        };
      }
    }

    const dropped = new Set(ops.filter((o) => o.type === 'bullet.drop').map((o) => o.target.bullet_index));

    const reorder = ops.filter((o) => o.type === 'bullet.reorder').pop();
    if (reorder) {
      const rank = new Map(reorder.order.map((idx, pos) => [idx, pos]));
      working = [...working].sort((a, b) => {
        const ra = rank.get(a.originalIndex ?? -1) ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(b.originalIndex ?? -1) ?? Number.MAX_SAFE_INTEGER;
        return ra === rb ? (a.originalIndex ?? 0) - (b.originalIndex ?? 0) : ra - rb;
      });
    }

    for (const p of ops.filter((o) => o.type === 'bullet.add')) {
      const newBullet: WorkingBullet = {
        originalIndex: null,
        bullet: { text: effectiveAfter(p), ...(p.citations.length > 0 ? { citations: [...p.citations] } : {}) },
      };
      const anchor = working.findIndex((x) => x.originalIndex === p.target.bullet_index);
      if (anchor >= 0) working.splice(anchor, 0, newBullet);
      else working.push(newBullet);
    }

    working = working.filter((w) => w.originalIndex === null || !dropped.has(w.originalIndex));

    return { ...exp, bullets: working.map((w) => w.bullet) };
  });

  spec.skills = base.skills.map((group, gi) => {
    let skills = [...group.skills];
    const ops = accepted.filter((p) => p.target.skill_group_index === gi);
    const reorder = ops.filter((o) => o.type === 'skills.reorder').pop();
    if (reorder) {
      const lower = new Map(skills.map((s) => [s.toLowerCase(), s]));
      const ordered = reorder.skills
        .map((s) => lower.get(s.toLowerCase()))
        .filter((s): s is string => !!s);
      const rest = skills.filter((s) => !ordered.includes(s));
      skills = [...ordered, ...rest];
    }
    for (const prune of ops.filter((o) => o.type === 'skills.prune')) {
      const remove = new Set(prune.skills.map((s) => s.toLowerCase()));
      skills = skills.filter((s) => !remove.has(s.toLowerCase()));
    }
    return { ...group, skills };
  });

  return spec;
}

/**
 * Page budget: returns IDs of accepted proposals that add lines when the applied
 * resume is longer than the base.
 */
export function pageBudgetOverruns(base: ResumeSpec, proposals: Proposal[]): { overBy: number; proposalIds: string[] } {
  const baseLines = estimateResumeLines(base);
  const applied = estimateResumeLines(applyProposals(base, proposals));
  const overBy = applied - baseLines;
  if (overBy <= 0) return { overBy: 0, proposalIds: [] };
  const proposalIds = proposals
    .filter((p) => p.decision === 'accepted' && !isBlocked(p))
    .filter((p) => {
      if (p.type === 'bullet.add') return true;
      if (p.type === 'bullet.rewrite' || p.type === 'summary.rewrite') {
        return lineCount(effectiveAfter(p)) > lineCount(p.before);
      }
      return false;
    })
    .map((p) => p.id);
  return { overBy, proposalIds };
}

export function renderBriefMarkdown(
  brief: DefensibilityBrief,
  analysis: JobAnalysis,
  alignment: AlignmentMatrix
): string {
  const reqText = (id: string) => analysis.requirements.find((r) => r.id === id)?.text ?? id;
  const cite = (ids: string[]) => (ids.length > 0 ? ` _(${ids.join(', ')})_` : '');
  const heading = [analysis.company, analysis.role].filter(Boolean).join(' — ') || 'Target Role';
  const counts = { backed: 0, transferable: 0, gap: 0 };
  alignment.rows.forEach((r) => (counts[r.classification] += 1));

  const lines: string[] = [
    `# Interview Defensibility Brief: ${heading}`,
    '',
    `Alignment: ${counts.backed} backed · ${counts.transferable} transferable · ${counts.gap} gaps`,
    '',
    '## Primary Anchor Stories',
    '',
  ];
  if (brief.anchor_stories.length === 0) lines.push('_None._', '');
  brief.anchor_stories.forEach((s, i) => {
    lines.push(
      `### ${i + 1}. ${s.title}${cite(s.citations)}`,
      '',
      `- **Problem:** ${s.problem}`,
      `- **Ownership:** ${s.ownership}`,
      `- **Proof:** ${s.proof}`,
      ''
    );
  });
  lines.push('## Bridging Transferable Skills', '');
  if (brief.bridges.length === 0) lines.push('_None._', '');
  brief.bridges.forEach((b) => {
    lines.push(`### ${reqText(b.requirement_id)} ← ${b.adjacent_tool}`, '', b.framing, '');
  });
  lines.push('## Addressing True Gaps', '');
  if (brief.gaps.length === 0) lines.push('_None._', '');
  brief.gaps.forEach((g) => {
    lines.push(
      `### ${reqText(g.requirement_id)}`,
      '',
      `- **Acknowledgement:** ${g.acknowledgement}`,
      `- **Parallel mastery:** ${g.parallel_mastery}`,
      ''
    );
  });
  return lines.join('\n').trimEnd() + '\n';
}
