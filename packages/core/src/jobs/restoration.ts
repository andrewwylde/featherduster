import type { Proposal } from '../tailoring/schemas.js';
import type { ResumeSpec } from '../schemas/resume.js';

/** Restore omitted generated wording as one accomplishment, retaining unrelated edits. */
export function restoreAccomplishmentInDraft(current: ResumeSpec, base: ResumeSpec, proposal: Proposal): ResumeSpec {
  const next = structuredClone(current), p = proposal, text = p.edited_after ?? p.after;
  const original = base.experiences[p.target.experience_index], exp = next.experiences[p.target.experience_index];
  if (!original || !exp || original.company !== exp.company || original.role !== exp.role || original.startDate !== exp.startDate)
    throw Error('The employment experience changed. Review its current content.');
  if (!['bullet.add', 'bullet.rewrite', 'bullet.consolidate'].includes(p.type) || !text.trim()) throw Error('Select an omitted accomplishment.');
  const sources = p.type === 'bullet.add' ? [] : p.type === 'bullet.consolidate' ? p.source_bullets ?? []
    : [{ bullet_index: p.target.bullet_index, before: p.before }];
  if ((p.type === 'bullet.consolidate' && sources.length < 2) || sources.some(s => original.bullets[s.bullet_index]?.text !== s.before))
    throw Error('Captured original targets no longer match.');
  if (exp.bullets.some(b => b.text === text || sources.some(s => s.before === b.text))) throw Error('This accomplishment or its original content is already present.');
  const following = p.target.bullet_index < 0 ? undefined : original.bullets.slice(p.target.bullet_index).find(b => exp.bullets.some(v => v.text === b.text));
  const previous = p.target.bullet_index < 0 ? undefined : original.bullets.slice(0, p.target.bullet_index).reverse().find(b => exp.bullets.some(v => v.text === b.text));
  const at = following ? exp.bullets.findIndex(b => b.text === following.text)
    : previous ? exp.bullets.findIndex(b => b.text === previous.text) + 1 : exp.bullets.length;
  exp.bullets.splice(at, 0, { text, citations: [...p.citations] });
  return next;
}

/** Undo one captured change against current wording, without replaying the entire generation. */
export function undoProposalInDraft(current: ResumeSpec, base: ResumeSpec, proposal: Proposal): ResumeSpec {
  const next = structuredClone(current), p = proposal, after = p.edited_after ?? p.after;
  if (p.type === 'summary.rewrite') {
    if (next.summary !== after) throw Error('The summary has changed. Review its current wording before undoing.');
    next.summary = p.before; return next;
  }
  const original = base.experiences[p.target.experience_index], exp = next.experiences[p.target.experience_index];
  if (!original || !exp || original.company !== exp.company || original.role !== exp.role || original.startDate !== exp.startDate) throw Error('The employment experience changed. Review its current content.');
  if (!['bullet.drop', 'bullet.add', 'bullet.rewrite', 'bullet.consolidate'].includes(p.type)) throw Error('Use the draft editor to change ordering or skills.');
  const index = exp.bullets.findIndex(b => b.text === after);
  if (p.type !== 'bullet.drop') {
    if (index < 0 || exp.bullets.filter(b => b.text === after).length !== 1) throw Error('The affected wording changed. Review it before undoing.');
    exp.bullets.splice(index, 1);
  }
  if (p.type === 'bullet.add') return next;
  const targets = p.type === 'bullet.consolidate' ? p.source_bullets ?? [] : [{ bullet_index: p.target.bullet_index, before: p.before }];
  if (!targets.length || targets.some(t => original.bullets[t.bullet_index]?.text !== t.before)) throw Error('Captured original targets no longer match.');
  for (const target of [...targets].sort((a, b) => a.bullet_index - b.bullet_index)) {
    if (exp.bullets.some(b => b.text === target.before)) throw Error('This accomplishment is already present.');
    const nextOriginal = original.bullets.slice(target.bullet_index + 1).find(b => exp.bullets.some(v => v.text === b.text));
    const previousOriginal = original.bullets.slice(0, target.bullet_index).reverse().find(b => exp.bullets.some(v => v.text === b.text));
    const at = nextOriginal ? exp.bullets.findIndex(b => b.text === nextOriginal.text)
      : previousOriginal ? exp.bullets.findIndex(b => b.text === previousOriginal.text) + 1
      : index >= 0 ? Math.min(index, exp.bullets.length) : exp.bullets.length;
    exp.bullets.splice(at, 0, structuredClone(original.bullets[target.bullet_index]));
  }
  return next;
}

/** Mechanical tightening keeps every distinct assertion and every technical qualifier. */
export function tightenResumeWording(current: ResumeSpec): ResumeSpec {
  const next = structuredClone(current);
  // Keep punctuation intact: periods can belong to technical names or metrics.
  const tighten = (text: string) => text.replace(/\bin order to\b/gi, 'to').replace(/\bfor the purpose of\b/gi, 'for');
  if (next.summary) next.summary = tighten(next.summary);
  for (const exp of next.experiences) for (const bullet of exp.bullets) bullet.text = tighten(bullet.text);
  return next;
}

export interface PassageDiffStage {
  kind: 'original_capture' | 'job_local_correction' | 'tailored_proposal' | 'user_edit' | 'omission';
  text: string;
  timestamp?: string;
}

export interface PassageDiffTrace {
  passage_id: string;
  original_text: string;
  final_text: string;
  stages: PassageDiffStage[];
}

export interface ArtifactChangesSummary {
  passages: PassageDiffTrace[];
}

export function computeArtifactChanges(
  originalSnapshot: any,
  baseCorrections: any[] = [],
  generatedOperations: any[] = []
): ArtifactChangesSummary {
  interface PassageItem {
    id: string;
    path: string;
    originalText: string;
    experienceIndex?: number;
    bulletIndex?: number;
  }

  const passagesList: PassageItem[] = [];

  if (originalSnapshot && typeof originalSnapshot === 'object') {
    if (typeof originalSnapshot.summary === 'string' && originalSnapshot.summary.trim()) {
      passagesList.push({
        id: 'summary',
        path: 'summary',
        originalText: originalSnapshot.summary,
      });
    }

    const exps = Array.isArray(originalSnapshot.experience)
      ? originalSnapshot.experience
      : Array.isArray(originalSnapshot.experiences)
        ? originalSnapshot.experiences
        : [];

    exps.forEach((exp: any, ei: number) => {
      const bullets = Array.isArray(exp?.bullets) ? exp.bullets : [];
      bullets.forEach((b: any, bi: number) => {
        const originalText = typeof b === 'string' ? b : (b && typeof b === 'object' && 'text' in b ? String(b.text) : '');
        const passageId = exp?.id ? `${exp.id}:${bi}` : `experiences.${ei}.bullets.${bi}.text`;
        const path = `experiences.${ei}.bullets.${bi}.text`;
        passagesList.push({
          id: passageId,
          path,
          originalText,
          experienceIndex: ei,
          bulletIndex: bi,
        });
      });
    });
  }

  const traces: PassageDiffTrace[] = [];
  const handledOps = new Set<any>();

  for (const passage of passagesList) {
    let currentText = passage.originalText;
    const stages: PassageDiffStage[] = [];

    // 1. Job-local base corrections
    for (const c of (baseCorrections ?? [])) {
      const target = c.target ?? c.before;
      const replacement = c.replacement ?? c.after;
      const timestamp = c.timestamp ?? c.recorded_at;
      const matchesPath = c.path && (c.path === passage.path || c.path === passage.id);
      const matchesText = target !== undefined && target === currentText;

      if (matchesText || (matchesPath && (target === undefined || target === currentText))) {
        currentText = replacement;
        stages.push({
          kind: 'job_local_correction',
          text: replacement,
          ...(timestamp ? { timestamp } : {}),
        });
      }
    }

    // 2. Generated operations
    for (const op of (generatedOperations ?? [])) {
      if (op.decision === 'rejected' && op.type !== 'bullet.drop' && op.op !== 'drop') {
        continue;
      }
      const opType = op.op ?? op.type;
      const before = op.before;
      const after = op.after;
      const editedAfter = op.edited_after;
      const timestamp = op.timestamp ?? op.recorded_at;

      const matchesBefore = before !== undefined && (before === currentText || (Array.isArray(op.source_bullets) && op.source_bullets.some((s: any) => s.before === currentText)));
      const matchesTarget = op.target && passage.experienceIndex !== undefined && op.target.experience_index === passage.experienceIndex && (
        op.target.bullet_index === passage.bulletIndex || (Array.isArray(op.source_bullets) && op.source_bullets.some((s: any) => s.bullet_index === passage.bulletIndex))
      );
      const matchesSummary = opType === 'summary.rewrite' && passage.path === 'summary';

      if (matchesBefore || matchesTarget || matchesSummary) {
        handledOps.add(op);
        if (opType === 'replace' || opType === 'bullet.rewrite' || opType === 'summary.rewrite' || opType === 'bullet.consolidate') {
          currentText = after ?? '';
          stages.push({
            kind: 'tailored_proposal',
            text: currentText,
            ...(timestamp ? { timestamp } : {}),
          });
          if (editedAfter !== undefined && editedAfter !== after) {
            currentText = editedAfter;
            stages.push({
              kind: 'user_edit',
              text: editedAfter,
              ...(timestamp ? { timestamp } : {}),
            });
          }
        } else if (opType === 'drop' || opType === 'bullet.drop' || opType === 'delete') {
          currentText = '';
          stages.push({
            kind: 'omission',
            text: '',
            ...(timestamp ? { timestamp } : {}),
          });
        }
      }
    }

    if (stages.length > 0 || currentText !== passage.originalText) {
      traces.push({
        passage_id: passage.id,
        original_text: passage.originalText,
        final_text: currentText,
        stages,
      });
    }
  }

  // 3. Additions from operations not matching any original passage
  for (const op of (generatedOperations ?? [])) {
    if (handledOps.has(op)) continue;
    if (op.decision === 'rejected') continue;
    const opType = op.op ?? op.type;
    if (opType === 'add' || opType === 'bullet.add') {
      const after = op.after ?? '';
      const editedAfter = op.edited_after;
      const timestamp = op.timestamp ?? op.recorded_at;
      const stages: PassageDiffStage[] = [
        {
          kind: 'tailored_proposal',
          text: after,
          ...(timestamp ? { timestamp } : {}),
        },
      ];
      let final_text = after;
      if (editedAfter !== undefined && editedAfter !== after) {
        final_text = editedAfter;
        stages.push({
          kind: 'user_edit',
          text: editedAfter,
          ...(timestamp ? { timestamp } : {}),
        });
      }
      traces.push({
        passage_id: op.id ?? `add-${op.target?.experience_index ?? 0}-${op.target?.bullet_index ?? 0}`,
        original_text: '',
        final_text,
        stages,
      });
    }
  }

  return { passages: traces };
}
