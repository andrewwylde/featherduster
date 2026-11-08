import type { ResumeSpec } from '../schemas/resume.js';
export interface PassageEdit { path: string; before: string; after: string }
/** Exact revision-bound edits: an unrelated field can never change as a side effect. */
export function replaceSelectedPassages(candidate: ResumeSpec, edits: PassageEdit[]): ResumeSpec {
  const next = structuredClone(candidate), seen = new Set<string>();
  for (const edit of edits) {
    if (seen.has(edit.path) || !edit.after.trim()) throw new Error('Select each nonempty passage replacement once.');
    seen.add(edit.path);
    const match = /^experiences\.(0|[1-9]\d*)\.bullets\.(0|[1-9]\d*)\.text$/.exec(edit.path);
    const bullet = match ? next.experiences[Number(match[1])]?.bullets[Number(match[2])] : undefined;
    const before = edit.path === 'summary' ? next.summary : bullet?.text;
    if (before !== edit.before) throw new Error('Affected wording changed. Reload before updating it.');
    if (edit.path === 'summary') next.summary = edit.after;
    else if (bullet) bullet.text = edit.after;
    else throw new Error('Invalid affected passage.');
  }
  return next;
}
