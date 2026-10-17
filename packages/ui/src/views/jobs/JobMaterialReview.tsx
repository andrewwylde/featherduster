import { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialContentSchema, type Job, type MaterialContent, type MaterialRevision } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

type Draft = { revision: string; content: MaterialContent };
type Field = { label: string; path: (string | number)[]; text: string };
function fields(content: MaterialContent): Field[] {
  const result: Field[] = [];
  const add = (label: string, path: (string | number)[], text: string) => result.push({ label, path, text });
  if (content.kind === 'cover_letter') content.paragraphs.forEach((p, i) => add(`Paragraph ${i + 1}`, ['paragraphs', i, 'text'], p.text));
  else {
    content.stories.forEach((story, i) => {
      for (const key of ['situation', 'contribution', 'outcome', 'tradeoffs'] as const) add(`Story ${i + 1}: ${key}`, ['stories', i, key, 'text'], story[key].text);
    });
    content.questions.forEach((q, i) => { add(`Question ${i + 1}`, ['questions', i, 'question'], q.question); add(`Answer ${i + 1}`, ['questions', i, 'answer', 'text'], q.answer.text); });
    content.gaps.forEach((g, i) => add(`Gap ${i + 1}: ${g.requirement_quote}`, ['gaps', i, 'framing'], g.framing));
  }
  const bindings = (node: unknown, path: (string | number)[] = []) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((value, i) => bindings(value, [...path, i])); return; }
    for (const [key, value] of Object.entries(node)) {
      const next = [...path, key];
      if (typeof value === 'string' && (path.includes('claims') || path.includes('resume_claim') || path.includes('transferable_evidence'))) {
        add(`Evidence binding: ${next.join(' / ')}`, next, value);
      } else bindings(value, next);
    }
  };
  bindings(content);
  return result;
}

export function JobMaterialReview({ job, kind, onSaved }: { job: Job; kind: MaterialContent['kind']; onSaved(): void }) {
  const key = `job-material:${job.workspace_id}:${job.id}:${kind}`;
  const [draft, setDraft] = useState<Draft | null>(() => {
    try { const raw = JSON.parse(localStorage.getItem(key) ?? 'null'); return raw && typeof raw.revision === 'string' ? { revision: raw.revision, content: MaterialContentSchema.parse(raw.content) } : null; } catch { return null; }
  });
  const load = useCallback(() => apiClient.getJobMaterial(job.id, kind), [job.id, kind]);
  const { data, error, refresh } = useJobsData(load);
  const sources = useJobsData(useCallback(() => apiClient.getEvidence(), []));
  const [selected, setSelected] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0), [historyId, setHistoryId] = useState('');
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false), intent = useIntentKey();
  const [acknowledged, setAcknowledged] = useState<MaterialRevision | null>(null);
  useEffect(() => { if (acknowledged && data?.history.some(r => r.id === acknowledged.id)) setAcknowledged(null); }, [acknowledged, data]);
  const current = acknowledged ?? data?.current;
  const historical = historyId ? data?.history.find(r => r.id === historyId) : null;
  const content = historical?.content ?? draft?.content ?? current?.content;
  const entries = content ? fields(content) : [], field = entries[Math.min(index, Math.max(0, entries.length - 1))];
  const conflict = draft && current && draft.revision !== current.id;
  const active = ['queued', 'preparing'].includes(job.preparation_state);
  const ids = selected ?? sources.data?.map(e => e.id) ?? [];
  const remember = (value: Draft | null) => {
    setDraft(value);
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); }
    catch { setFailure('Browser storage is unavailable. Keep this page open and save before navigating.'); }
  };
  const action = async (operation: () => Promise<unknown>, clear = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure('');
    try { await operation(); if (clear) remember(null); await refresh(); onSaved(); }
    catch (e) { setFailure(e instanceof Error ? e.message : 'The operation failed; your draft is retained.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const edit = (text: string) => {
    if (!content || !current || !field || historical) return;
    const next = structuredClone(content);
    let node: any = next;
    for (const part of field.path.slice(0, -1)) node = node[part];
    node[field.path.at(-1)!] = text;
    remember({ revision: draft?.revision ?? current.id, content: next });
  };
  const title = kind === 'cover_letter' ? 'Cover letter' : 'Interview brief';
  return <section aria-label={title} className={`${cardClass} p-5 sm:p-6 space-y-5 min-w-0 text-slate-900 dark:text-slate-100`}>
    <header className="space-y-2"><h2 className="text-xl font-semibold">{title}</h2><p className="text-sm">{kind === 'cover_letter' ? 'Prepare a letter from selected experience. Review it before using it outside Featherduster.' : 'Practice defending the claims in your current resume: contribution, outcomes, tradeoffs and honest gaps. This is not the evidence dossier.'}</p></header>
    {(error || failure) && <div role="alert" className="text-sm space-y-2"><p>{failure || error}</p><button className="underline" onClick={() => void refresh()}>Reload saved version (keep draft)</button><p>For runner or consent errors, open <a className="underline" href="/settings">Settings</a>. If stopped, inspect Automatic work controls below before choosing Start; other queued jobs may also run.</p></div>}
    <details><summary className="cursor-pointer text-sm">Selected compendium sources ({ids.length})</summary><p className="text-sm my-2">Your evidence corpus and saved applicable skills supply the compendium. Selecting sources never generates work.</p>{sources.data?.map(e => <label key={e.id} className="flex gap-2 text-sm py-1"><input type="checkbox" checked={ids.includes(e.id)} disabled={busy || active} onChange={event => setSelected(event.target.checked ? [...ids, e.id] : ids.filter(id => id !== e.id))} />{e.title}</label>)}</details>
    <div className="flex flex-wrap gap-3"><button className={secondaryButton} disabled={busy || active || !!draft || !!historical || !sources.data || !!sources.error} onClick={() => void action(() => apiClient.generateJobMaterial(job.id, kind, { expected_revision: job.revision, evidence_ids: ids, idempotency_key: intent({ kind, revision: job.revision, ids }) }))}>{current ? 'Generate new version' : `Generate ${title.toLowerCase()}`}</button>{active && <button className={secondaryButton} disabled={busy} onClick={() => void action(() => apiClient.cancelJob(job.id, { expected_revision: job.revision, idempotency_key: intent({ cancel: job.revision }), reason: 'Cancelled from material review' }))}>Cancel active work</button>}</div>
    {active && <p role="status">Work is running. Saved content remains below. Cancel here or Stop all processing in the controls below.</p>}
    <p className="text-sm"><a className="underline" href={`/jobs/${job.id}/resume`}>Resume exports and saved release bundles</a> include this material only after saving, checking and review.</p>
    {!current && !active && <p>No saved {title.toLowerCase()} yet. Generation is optional and does not affect existing resume exports.{kind === 'interview_brief' && <> First <a className="underline" href={`/jobs/${job.id}/resume`}>prepare a current resume</a>.</>}</p>}
    {!!data?.stale_reasons.length && <p role="status">Inputs changed: {data.stale_reasons.join(', ')}. This is retained text, not current checked content. Save any draft, then explicitly generate a new version before review.</p>}
    {conflict && <section className="space-y-2 text-sm" aria-label="Changed saved version"><p>The saved revision changed. Your draft still belongs to its original revision and cannot overwrite it.</p><details><summary>Compare current saved wording</summary>{current && fields(current.content).map((f, i) => <p key={i} className="whitespace-pre-wrap py-2">{f.label}: {f.text}</p>)}</details><button className={secondaryButton} disabled={busy} onClick={() => current && draft && remember({ ...draft, revision: current.id })}>Keep my draft against this saved revision</button></section>}
    {content && field && <div className="space-y-4">
      <p role="status" className="text-sm">{historical ? 'Historical version — read only' : draft ? 'Unsaved local edits — saved checks do not cover these changes' : current?.review ? 'Reviewed saved version' : 'Saved draft — inspect checks and review before use'}</p>
      <label className="block text-sm">Passage<select aria-label="Passage" className="block w-full mt-2 bg-transparent border rounded p-2" value={Math.min(index, entries.length - 1)} onChange={event => setIndex(Number(event.target.value))}>{entries.map((f, i) => <option key={i} value={i}>{f.label}</option>)}</select></label>
      <label className="block text-sm font-medium">{field.label}<textarea className="block w-full min-h-48 mt-2 p-3 rounded border bg-transparent text-base leading-relaxed" value={field.text} readOnly={!!historical} disabled={busy} onChange={event => edit(event.target.value)} /></label>
      <details><summary className="cursor-pointer text-sm">Inspect claim bindings and exact source quotes</summary><div className="space-y-3 mt-3">{entries.filter(entry => entry.path.at(-1) === 'quote').map((entry, i) => <blockquote key={i} className="border-l-2 pl-3 text-sm whitespace-pre-wrap">{entry.text}</blockquote>)}</div><p className="text-sm">Checks conservatively require source wording. Paraphrases and unsupported statements remain blocked; generation cannot establish new facts.</p></details>
      {!historical && current && <>
        {!!current.validation.issues.length && <section aria-label="Material checks" className="text-sm space-y-2"><h3 className="font-semibold">Resolve before review</h3>{current.validation.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}</section>}
        <div className="flex flex-wrap gap-3"><button className={primaryButton} disabled={busy || !draft || !!conflict} onClick={() => draft && void action(async () => {
          const saved = await apiClient.saveJobMaterial(job.id, kind, { expected_revision_id: draft.revision, content: draft.content, idempotency_key: intent(draft) });
          setAcknowledged(saved.result);
        }, true)}>Save and check</button><button className={secondaryButton} disabled={busy || !!draft || !!data?.stale_reasons.length || current.validation.status !== 'checked'} onClick={() => void action(() => apiClient.reviewJobMaterial(job.id, kind, { expected_revision_id: current.id, idempotency_key: intent({ review: current.id }) }))}>Mark reviewed</button>{draft && <button className={secondaryButton} disabled={busy} onClick={() => { if (window.confirm('Discard your local edits and show the saved version?')) remember(null); }}>Discard local edits</button>}</div>
      </>}
    </div>}
    {current?.review && !draft && !historical && !data?.stale_reasons.length && <section aria-label="Use reviewed material" className="flex flex-wrap gap-4 text-sm">
      <a className="underline" href={`/api/jobs/${job.id}/materials/${kind}/export?revision=${current.id}&format=text&download=1`}>Download Markdown</a>
      <a className="underline" href={`/api/jobs/${job.id}/materials/${kind}/export?revision=${current.id}&format=html&download=1`}>Download HTML</a>
      <a className="underline" target="_blank" rel="noreferrer" href={`/api/jobs/${job.id}/materials/${kind}/export?revision=${current.id}&format=html`}>Open print-ready document</a>
      <button className="underline" disabled={busy} onClick={() => void action(async () => {
        const response = await fetch(`/api/jobs/${job.id}/materials/${kind}/export?revision=${current.id}&format=text`);
        if (!response.ok) throw new Error('The export is no longer current. Reload and inspect checks.');
        await navigator.clipboard.writeText(await response.text());
      })}>Copy text</button>
    </section>}
    {!!data?.history.length && <details><summary className="cursor-pointer text-sm">Revision history ({data.history.length})</summary><button className="block underline py-2 text-sm" onClick={() => setHistoryId('')}>Return to current version</button>{data.history.map(r => <button key={r.id} className="block underline py-2 text-sm" onClick={() => { setHistoryId(r.id); setIndex(0); }}>Revision {r.revision} · {new Date(r.created_at).toLocaleString()}{r.review ? ' · reviewed' : ''}</button>)}</details>}
  </section>;
}
