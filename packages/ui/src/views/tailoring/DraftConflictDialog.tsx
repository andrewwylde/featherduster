import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { DraftEnvelope, DraftRecord } from '@featherduster/core';
import { apiClient } from '../../api/client';
import { useModalA11y } from '../../hooks/useModalA11y';
import type { DraftCoordinator } from '../../tailoring-drafts/coordinator';
import { UpstreamSyncControl } from './UpstreamSyncDialog';
import { secondaryButton } from './ui';
export function DraftControls(props: DraftChoiceProps) {
  const { coordinator, verifyWorkspace, onBack, onLoaded } = props;
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const [confirmation, setConfirmation] = useState<{ token: NonNullable<typeof state.token>; operationId: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const release = useRef<() => void>();
  const mounted = useRef(true);
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  const close = () => { if (!busy) { setConfirmation(undefined); release.current?.(); release.current = undefined; } };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; release.current?.(); }; }, []);
  useModalA11y({ isOpen: !!confirmation, onClose: close, closeOnEscape: !busy, containerRef: ref });
  const run = state.record?.kind === 'run';
  const discard = async () => {
    if (!confirmation || !state.record || busy) return;
    setBusy(true); setError(undefined);
    try {
      const result = await coordinator.resolveConflict(async () => {
        await verifyWorkspace();
        const result = await apiClient.discardTailoringDraft(state.record!.id, { expected: confirmation.token, operationId: confirmation.operationId });
        await verifyWorkspace();
        return result;
      });
      if (!mounted.current) return;
      release.current?.(); release.current = undefined;
      setConfirmation(undefined);
      if (run) await onLoaded?.(result); else onBack();
    } catch (err) {
      if (!mounted.current) return;
      setError((err as Error).message || 'Discard failed. Recovery is retained.');
      if ([409, 410].includes((err as { status?: number })?.status ?? 0)) { coordinator.enterConflict(err); release.current?.(); release.current = undefined; setConfirmation(undefined); }
    } finally { if (mounted.current) setBusy(false); }
  };
  return <>
    <UpstreamSyncControl coordinator={coordinator} verifyWorkspace={props.verifySyncIdentity ?? verifyWorkspace} onLoaded={onLoaded} />
    <div className="flex flex-wrap gap-3">
      <button type="button" className={secondaryButton} onClick={onBack}>Back to list</button>
      <button type="button" className={secondaryButton} disabled={!state.token || state.status === 'conflict'} onClick={() => { release.current = coordinator.pauseForChoice(); setError(undefined); setConfirmation({ token: state.token!, operationId: crypto.randomUUID() }); }}>{run ? 'Discard unapplied edits' : 'Discard draft'}</button>
    </div>
    {!confirmation && <DraftConflictDialog {...props} />}
    {confirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title} tabIndex={-1} className="w-full max-w-lg rounded-lg bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
        <h2 id={title}>{run ? 'Discard unapplied edits?' : 'Discard this draft?'}</h2>
        <p>{run ? 'This resets editable recovery text to the current applied artifacts. The run, approvals, and exported resumes are preserved.' : 'This removes the draft from your list. Exported resumes are preserved.'}</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void discard()}>Confirm discard</button>{' '}
        <button type="button" disabled={busy} onClick={close}>Keep editing</button>
      </div>
    </div>}
  </>;
}

export interface DraftChoiceProps {
  coordinator: DraftCoordinator;
  verifyWorkspace: () => Promise<unknown>;
  verifySyncIdentity?: () => Promise<unknown>;
  onFork: (draft: DraftEnvelope) => void;
  onBack: () => void;
  onLoaded?: (draft: DraftEnvelope) => void | Promise<void>;
}
function preview(record: DraftRecord): string {
  if (record.kind === 'setup') return [record.payload.label, record.payload.posting].filter(Boolean).join('\n\n');
  if (record.kind === 'manual') return [record.payload.profile.name, record.payload.profile.title, record.payload.summary, ...record.payload.experiences.flatMap(experience => [experience.company, experience.role, ...experience.bullets.map(bullet => bullet.text)]), record.payload.jobDescription].filter(Boolean).join('\n\n');
  const { analysis, alignment, proposals, proposalTextById } = record.payload;
  return [analysis?.company, analysis?.role, analysis?.mission, ...(analysis?.requirements.map(requirement => requirement.text) ?? []), ...(alignment?.rows.map(row => row.rationale) ?? []), ...(proposals?.proposals.map(proposal => proposalTextById[proposal.id] ?? proposal.edited_after ?? proposal.after) ?? []), ...Object.entries(proposalTextById).filter(([id]) => !proposals?.proposals.some(proposal => proposal.id === id)).map(([, text]) => text)].filter(Boolean).join('\n\n');
}
/** No recovery copy is consumed until the selected operation acknowledges. */
export function DraftConflictDialog({ coordinator, verifyWorkspace, onFork, onBack, onLoaded }: DraftChoiceProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const operation = useRef<{ key: string; id: string }>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  const open = state.status === 'conflict';
  useModalA11y({ isOpen: open, onClose: onBack, closeOnEscape: !busy, containerRef: ref });
  if (!open) return null;
  const choices = state.conflicts;
  const key = (s: typeof choices[number]) => `${s.writerId}:${s.mutationId}`;
  const selected = choices.length === 1 ? choices[0] : choices.find(s => key(s) === selectedKey);
  const gone = deleted || (state.error as { status?: number })?.status === 410;
  const choose = async (fork: boolean) => {
    if (!selected || busy) return;
    setBusy(true); setError(undefined);
    try {
      const result = await coordinator.resolveConflict(async () => {
        await verifyWorkspace();
        let result: DraftEnvelope;
        if (fork) {
          if (operation.current?.key !== key(selected)) operation.current = { key: key(selected), id: crypto.randomUUID() };
          result = await apiClient.forkTailoringDraft(selected.draftId, { expected: selected.base ?? state.token ?? { revision: 0, fingerprint: 'browser-only' }, operationId: operation.current.id, sourceSnapshot: selected.record });
        } else result = await apiClient.getTailoringDraft(selected.draftId);
        await verifyWorkspace();
        return result;
      }, selected);
      if (!mounted.current) return;
      if (fork) onFork(result); else await onLoaded?.(result);
    } catch (err) {
      if (!mounted.current) return;
      if ((err as { status?: number })?.status === 410) setDeleted(true);
      setError((err as Error).message || 'Could not resolve the draft. Your recovery copy is retained.');
    } finally { if (mounted.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title} tabIndex={-1} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
      <h2 id={title} className="text-xl font-semibold">Resolve draft conflict</h2>
      <p>Autosave is paused. Choose which recovery copy to keep, or explicitly load the workspace version.</p>
      {gone && <p>This draft was deleted. Recover your text as a separate new draft.</p>}
      {state.savedAt && <p>Last acknowledged workspace save: <time dateTime={state.savedAt}>{new Date(state.savedAt).toLocaleString()}</time></p>}
      <fieldset disabled={busy} className="my-4 space-y-2">
        <legend>Choose a browser recovery version</legend>
        {choices.map((copy, index) => <label key={key(copy)} className="block">
          <input type="radio" name={title} checked={selected === copy} onChange={() => setSelectedKey(key(copy))} />{' '}
          Browser version {index + 1} — <time dateTime={copy.savedAt}>{new Date(copy.savedAt).toLocaleString()}</time>
        </label>)}
      </fieldset>
      {selected && <label className="block">Selected recovery content<textarea readOnly value={preview(selected.record)} className="mt-1 h-40 w-full rounded border p-2 dark:bg-slate-950" /></label>}
      {error && <p role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={busy || !selected || gone} onClick={() => void choose(false)}>Load newer version</button>
        <button type="button" disabled={busy || !selected} onClick={() => void choose(true)}>Keep mine as a separate draft</button>
        <button type="button" disabled={busy} onClick={onBack}>Back to list</button>
      </div>
    </div>
  </div>;
}
