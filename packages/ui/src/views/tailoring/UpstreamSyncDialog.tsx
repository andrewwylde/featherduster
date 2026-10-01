import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { canonicalJson, type DraftEnvelope } from '@featherduster/core';
import { apiClient, type DraftSyncConflict, type DraftSyncPreview, type DraftSyncResolutions, type DraftUpstream } from '../../api/client';
import { sseClient } from '../../api/events';
import { useModalA11y } from '../../hooks/useModalA11y';
import type { DraftCoordinator } from '../../tailoring-drafts/coordinator';
import { MergeValue, PreviousOutputs, ResumePreview, resolvedCandidate } from './ResumeMergePreview';

const label = (path: string) => path.split('/').filter(Boolean).map(part => /^\d+$/.test(part) ? String(Number(part) + 1) : part.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())).join(' › ');
function ConflictChoices({ conflict, group, choice, disabled, manual, onChoose }: {
  conflict: DraftSyncConflict;
  group: string;
  choice?: 'local' | 'upstream';
  disabled: boolean;
  manual: boolean;
  onChoose: (choice: 'local' | 'upstream') => void;
}) {
  const name = label(conflict.path);
  return <fieldset className="my-4 border p-3" disabled={disabled}>
    <legend>{name}</legend>
    {conflict.path === '/experiences' && manual && <p>
      Changes to these experiences could not be matched reliably. Keep local preserves your bullet selections.
      Use upstream replaces unmatched experiences with all bullets included.
    </p>}
    <div className="grid gap-3 sm:grid-cols-3">
      {(['base', 'local', 'upstream'] as const).map(side => <section key={side}>
        <h3>{side === 'base' ? 'Pinned base' : side === 'local' ? 'Your edits' : 'Upstream'}</h3>
        <MergeValue value={conflict[side]} />
      </section>)}
    </div>
    <div className="mt-3 flex gap-4">
      <label>
        <input type="radio" name={group} checked={choice === 'local'}
          onChange={() => onChoose('local')} aria-label={`${name}: keep local`} />
        Keep local
      </label>
      <label>
        <input type="radio" name={group} checked={choice === 'upstream'}
          onChange={() => onChoose('upstream')} aria-label={`${name}: use upstream`} />
        Use upstream
      </label>
    </div>
  </fieldset>;
}
export function UpstreamSyncControl({ coordinator, verifyWorkspace, onLoaded }: { coordinator: DraftCoordinator; verifyWorkspace: () => Promise<unknown>; onLoaded?: (draft: DraftEnvelope) => void | Promise<void> }) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const [upstream, setUpstream] = useState<DraftUpstream>();
  const [preview, setPreview] = useState<{ result: DraftSyncPreview; saved: DraftEnvelope; operationId: string }>();
  const [resolutions, setResolutions] = useState<DraftSyncResolutions>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const alive = useRef(true), release = useRef<() => void>();
  const verify = useRef(verifyWorkspace); verify.current = verifyWorkspace;
  const sequence = useRef(0);
  const ref = useRef<HTMLDivElement>(null), title = useId();
  const close = () => { if (busy) return; sequence.current++; setPreview(undefined); setError(undefined); release.current?.(); release.current = undefined; };
  useModalA11y({ isOpen: !!preview, onClose: close, closeOnEscape: !busy, containerRef: ref });
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current++; release.current?.(); };
  }, [coordinator]);
  useEffect(() => {
    let active = true, request = 0;
    const check = async () => {
      const current = ++request;
      const record = coordinator.getSnapshot().record;
      if (!record?.base || record.lifecycle !== 'draft') return;
      try { const result = await apiClient.getDraftUpstream(record.id); if (active && current === request) setUpstream(result); }
      catch { if (active && current === request) setUpstream(undefined); }
    };
    void check(); window.addEventListener('focus', check);
    const unsubscribe = sseClient.onChange(event => { const file = event?.relativePath ?? event?.path; if (!file || /resumes[/\\]/.test(file)) void check(); });
    return () => { active = false; window.removeEventListener('focus', check); unsubscribe(); };
  }, [coordinator, state.record?.base?.fingerprint]);
  const open = async () => {
    if (busy) return;
    const current = ++sequence.current;
    setBusy(true); setError(undefined);
    try {
      await verify.current(); const saved = await coordinator.awaitSaved(); await verify.current();
      if (!alive.current || current !== sequence.current) return;
      release.current = coordinator.pauseForChoice();
      const result = await apiClient.previewDraftSync(saved.record.id, { expected: saved.token }); await verify.current();
      if (!alive.current || current !== sequence.current) return;
      setResolutions({}); setPreview({ result, saved, operationId: crypto.randomUUID() });
    } catch (err) { if (alive.current && current === sequence.current) { setError((err as Error).message); release.current?.(); release.current = undefined; } }
    finally { if (alive.current && current === sequence.current) setBusy(false); }
  };
  const apply = async () => {
    if (!preview || busy) return;
    setBusy(true); setError(undefined);
    try {
      const snapshot = coordinator.getSnapshot();
      if (snapshot.status === 'conflict' || canonicalJson(snapshot.record) !== canonicalJson(preview.saved.record) || canonicalJson(snapshot.token) !== canonicalJson(preview.saved.token)) throw Error('Draft changed while preview was open. Cancel and preview again; your newer edits are retained.');
      const result = await coordinator.resolveConflict(async () => {
        await verify.current();
        const current = coordinator.getSnapshot();
        if (current.status === 'conflict' || canonicalJson(current.record) !== canonicalJson(preview.saved.record)) throw Error('Draft changed while preview was open. Cancel and preview again.');
        const acknowledged = await apiClient.syncTailoringDraft(preview.saved.record.id, { expected: preview.saved.token, operationId: preview.operationId, upstreamFingerprint: preview.result.upstreamFingerprint, resolutions });
        await verify.current(); return acknowledged;
      });
      if (!alive.current) return;
      setPreview(undefined); release.current?.(); release.current = undefined;
      await onLoaded?.(result);
    } catch (err) { if (alive.current) setError((err as Error).message || 'Sync failed. Your draft is retained.'); }
    finally { if (alive.current) setBusy(false); }
  };
  if (!state.record?.base || state.record.lifecycle !== 'draft') return null;
  const sync = state.record.kind === 'run' ? state.record.upstreamSync : undefined;
  const candidate = preview ? resolvedCandidate(preview.result, resolutions) : undefined;
  return <>
    <div className="space-y-2">
      {upstream?.missing
        ? <p>Live source unavailable. Your pinned snapshot is retained.</p>
        : upstream?.changed && <p role="status">Base resume updated</p>}
      <button type="button"
        disabled={busy || !upstream || upstream.missing || !upstream.changed || state.status === 'conflict'}
        onClick={() => void open()}>
        {busy && !preview ? 'Loading upstream preview…' : 'Sync upstream'}
      </button>
      {!preview && error && <p role="alert">{error}</p>}
      {sync && <details>
        <summary>Upstream sync comparison and review</summary>
        <p>Review or regenerate {sync.staleSteps.join(', ') || 'completed outputs'}. Nothing was regenerated automatically.</p>
        {sync.reviewProposalIds.length > 0 && <p>
          {sync.reviewProposalIds.length} proposal target(s) need review. Text is retained.
          Reject these proposals or regenerate after reviewing the candidate.
        </p>}
        <details>
          <summary>Merged candidate</summary>
          <ResumePreview resume={sync.candidate} />
        </details>
        <PreviousOutputs previous={sync.previous} />
      </details>}
    </div>
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title} tabIndex={-1}
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
        <h2 id={title}>Sync upstream resume</h2>
        <p>Review changes before applying. Cancel keeps the current draft. Generated outputs will require review; sync does not regenerate them.</p>
        <details>
          <summary>Changes from the pinned base</summary>
          <div className="grid gap-4 sm:grid-cols-2">
            <section><h3>Pinned base</h3><ResumePreview resume={preview.saved.record.base!.spec} /></section>
            <section><h3>Upstream base</h3><ResumePreview resume={preview.result.record.base!.spec} /></section>
          </div>
        </details>
        <details>
          <summary>Merged candidate preview</summary>
          <ResumePreview resume={candidate!} />
          <p>This preview follows your choices. Unresolved conflicts show local content.</p>
        </details>
        {preview.result.conflicts.map(conflict => <ConflictChoices
          key={conflict.id} conflict={conflict} group={`${title}-${conflict.id}`}
          choice={resolutions[conflict.id]} disabled={busy} manual={preview.saved.record.kind === 'manual'}
          onChoose={choice => setResolutions(current => ({ ...current, [conflict.id]: choice }))}
        />)}
        {preview.result.conflicts.length === 0 && <p>No conflicting edits. Your independent edits will be retained.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" disabled={busy || preview.result.conflicts.some(c => !resolutions[c.id])} onClick={() => void apply()}>
            Apply upstream sync
          </button>
          <button type="button" disabled={busy} onClick={close}>Cancel</button>
        </div>
      </div>
    </div>}
  </>;
}
