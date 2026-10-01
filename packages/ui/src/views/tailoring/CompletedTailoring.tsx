import { useEffect, useRef, useState } from 'react';
import { canonicalJson, type DraftRecord, type DraftEnvelope } from '@featherduster/core';
import { apiClient, type PreflightResult } from '../../api/client';
import { ExportDrawer } from '../../components/ExportDrawer';
import { PreFlightModal } from '../../components/PreFlightModal';
import { BrowserRecovery, recoveryKey } from '../../tailoring-drafts/recovery';
import { DraftCoordinator } from '../../tailoring-drafts/coordinator';
import { DraftConflictDialog } from './DraftConflictDialog';
import { primaryButton, secondaryButton, cardClass } from './ui';

export function CompletedTailoring({ draft, workspaceId, verifyWorkspace, onOpenDraft, onBack }: { draft: DraftEnvelope; workspaceId: string; verifyWorkspace: () => Promise<unknown>; onOpenDraft: (id: string) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [exportsOpen, setExportsOpen] = useState(false), [preflightOpen, setPreflightOpen] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  useEffect(() => {
    let active = true; setPreflightLoading(true);
    void apiClient.runPreflight({ spec: draft.record.completion!.spec }).then(result => { if (active) setPreflight(result); }).catch(() => { if (active) setPreflight(null); }).finally(() => { if (active) setPreflightLoading(false); });
    return () => { active = false; };
  }, [draft.record.id]);
  const operation = useRef<{ id: string; expected: DraftEnvelope['token'] }>();
  const mounted = useRef(false);
  const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, [draft.record.id]);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveryCoordinator, setRecoveryCoordinator] = useState<DraftCoordinator>();
  useEffect(() => {
    let active = true;
    let browser: BrowserRecovery | undefined;
    let coordinator: DraftCoordinator | undefined;
    setRecoveryChecked(false); setRecoveryCoordinator(undefined);
    void (async () => {
      await verifyWorkspace();
      if (!active) return;
      browser = new BrowserRecovery();
      const snapshots = browser.list(workspaceId).snapshots.filter(snapshot => snapshot.draftId === draft.record.id);
      // Completion acknowledges this exact editable content. Remove only the
      // observed mutation, so a newer write from that tab cannot be consumed.
      for (const snapshot of snapshots) {
        if (completionContent(snapshot.record) === completionContent(draft.record)) browser.remove(recoveryKey(workspaceId, snapshot.draftId, snapshot.writerId), snapshot.mutationId);
      }
      const remaining = browser.list(workspaceId).snapshots.some(snapshot => snapshot.draftId === draft.record.id);
      if (remaining) {
        coordinator = new DraftCoordinator({ workspaceId, draftId: draft.record.id, api: apiClient, recovery: browser });
        await coordinator.hydrate(draft);
        if (active) setRecoveryCoordinator(coordinator);
      }
      if (active) setRecoveryChecked(true);
    })().catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; coordinator?.dispose(); browser?.dispose(); };
  }, [draft.record.id, workspaceId]);
  const completion = draft.record.completion!;
  const spec = completion.spec;
  const proceed = async () => {
    if (busy) return;
    const currentGeneration = generation.current;
    const isCurrent = () => mounted.current && currentGeneration === generation.current;
    setBusy(true); setError(undefined);
    try {
      await verifyWorkspace(); if (!isCurrent()) return;
      operation.current ??= { id: crypto.randomUUID(), expected: draft.token };
      const next = await apiClient.continueTailoringDraft(draft.record.id, { expected: operation.current.expected, operationId: operation.current.id });
      await verifyWorkspace(); if (!isCurrent()) return;
      onOpenDraft(next.record.id);
    } catch (err) { if (isCurrent()) setError((err as Error).message); }
    finally { if (isCurrent()) setBusy(false); }
  };
  if (!recoveryChecked) return <div><p>Checking browser recovery...</p>{error && <p role="alert">{error}</p>}</div>;
  if (recoveryCoordinator) return <DraftConflictDialog coordinator={recoveryCoordinator} verifyWorkspace={verifyWorkspace} onFork={next => onOpenDraft(next.record.id)} onBack={onBack} onLoaded={() => { recoveryCoordinator.dispose(); setRecoveryCoordinator(undefined); }} />;
  return <div className="space-y-6">
    <button className={secondaryButton} onClick={onBack}>Back to tailoring</button>
    <header><p className="text-sm text-slate-500">Completed version · {new Date(completion.completedAt).toLocaleDateString()}</p><h1 className="text-2xl font-bold">{completion.name ?? 'Completed resume'}</h1><p>This version is saved. Continue editing to create a linked draft.</p></header>
    <div className="flex gap-3"><button className={primaryButton} disabled={busy} onClick={() => void proceed()}>{busy ? 'Creating draft…' : 'Continue editing'}</button><button className={secondaryButton} onClick={() => setExportsOpen(true)}>Deliverables &amp; Exports</button></div>
    {preflight && <div><p>{preflight.isClean ? 'Pre-flight clean.' : 'Pre-flight found issues to review.'}</p><button className="text-sm underline" onClick={() => setPreflightOpen(true)}>View pre-flight report</button></div>}
    {error && <p role="alert">{error}</p>}
    <ParentCompletionLink completionId={draft.record.parentCompletionId} onOpenDraft={onOpenDraft} />
    <article className={`${cardClass} space-y-5 p-6`} aria-label="Completed resume">
      <header><h2 className="text-xl font-semibold">{spec.profile.name}</h2><p>{spec.profile.title}</p><p>{[spec.profile.email, spec.profile.phone, spec.profile.location].filter(Boolean).join(' · ')}</p><div className="flex gap-3">{Object.entries(spec.profile.links ?? {}).filter(([, url]) => url && /^https?:\/\//i.test(url)).map(([label, url]) => <a key={label} href={url} className="underline" target="_blank" rel="noreferrer">{label}</a>)}</div></header>
      {spec.summary && <p>{spec.summary}</p>}
      {spec.experiences.map((experience, index) => <section key={index}><h3 className="font-semibold">{experience.role} · {experience.company}</h3><p>{experience.location}</p><p>{experience.startDate} — {experience.endDate}</p><ul className="list-disc pl-5">{experience.bullets.map((bullet, index) => <li key={index}>{bullet.text}</li>)}</ul></section>)}
      {spec.education.map((education, index) => <section key={index}><p>{education.degree} &middot; {education.institution} &middot; {education.year}</p>{education.details && <p>{education.details}</p>}</section>)}
      {spec.skills.map((group, index) => <p key={index}><strong>{group.category}:</strong> {group.skills.join(', ')}</p>)}
    </article>
    {exportsOpen && <ExportDrawer isOpen onClose={() => setExportsOpen(false)} spec={spec} variantName={completion.name ?? 'Completed resume'} jobDescription={draft.record.kind === 'manual' ? draft.record.payload.jobDescription : completion.runArtifacts?.posting} preflightStatus={preflight} preflightLoading={preflightLoading} onOpenPreflightModal={() => setPreflightOpen(true)} onDeSlop={() => {}} deslopping={false} squeezeMode={draft.record.kind === 'manual' && draft.record.payload.squeezeMode} onToggleSqueeze={() => {}} readOnly />}
    {preflightOpen && <PreFlightModal isOpen onClose={() => setPreflightOpen(false)} spec={spec} />}
  </div>;
}

export function ParentCompletionLink({ completionId, onOpenDraft }: { completionId?: string; onOpenDraft: (id: string) => void }) {
  const [parent, setParent] = useState<DraftEnvelope>();
  useEffect(() => {
    let active = true; setParent(undefined);
    if (completionId) void apiClient.listTailoringDrafts().then(list => { if (active) setParent(list.records.find(draft => draft.record.completion?.outputId === completionId)); }).catch(() => undefined);
    return () => { active = false; };
  }, [completionId]);
  if (!completionId) return null;
  if (!parent) return <p className="text-sm text-slate-500">Continued from a completed version.</p>;
  const completion = parent.record.completion!;
  return <button className="text-sm underline" onClick={() => onOpenDraft(parent.record.id)}>Continued from {completion.name ?? 'completed resume'} &middot; {new Date(completion.completedAt).toLocaleDateString()}</button>;
}

/** Compare every editable/recovery field, excluding server lifecycle metadata. */
function completionContent(record: DraftRecord): string {
  const { completion: _completion, lifecycle: _lifecycle, revision: _revision, createdAt: _created, editedAt: _edited, savedAt: _saved, ...content } = record;
  return canonicalJson(content);
}
