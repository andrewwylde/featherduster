import { CompletedTailoring, ParentCompletionLink } from './CompletedTailoring';
import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from '@featherduster/core';
import type { DraftEnvelope, DraftRecord, SetupPayload, ManualDraftPayload } from '@featherduster/core';
import { apiClient, type ResumeRecord, type RunnerInfo } from '../../api/client';
import { BrowserRecovery } from '../../tailoring-drafts/recovery';
import { DraftCoordinator, type DraftCoordinatorSnapshot } from '../../tailoring-drafts/coordinator';
import { TailoringRunList } from './TailoringRunList';
import { TailoringSetup } from './TailoringSetup';
import { TailoringRun } from './TailoringRun';
import { ResumeTailor } from '../ResumeTailor';
import { DraftStatus } from './DraftStatus';
import { DraftControls } from './DraftConflictDialog';

const empty: SetupPayload = { posting: '', label: '', baseResumeId: '', runner: '' };
export function TailoringDraftRoute({ canvas = false, preferredResumeId, draftId, navigate, onOpenCanvas, onOpenSettings, initialPosting, onInitialPostingConsumed, registerGuard }: {
  canvas?: boolean; preferredResumeId?: string;
  draftId?: string; navigate: (path: string, replace?: boolean) => void; onOpenCanvas: () => void; onOpenSettings: () => void;
  initialPosting?: string; onInitialPostingConsumed?: () => void; registerGuard: (guard: () => boolean) => void;
}) {
  const [completed, setCompleted] = useState<DraftEnvelope>();
  const completionOperation = useRef<{ saved: DraftEnvelope; request: { operationId: string; expected: DraftEnvelope['token']; name: string; type: 'template' | 'tailored' } }>();
  const [recovery, setRecovery] = useState<BrowserRecovery>();
  const [identityMismatch, setIdentityMismatch] = useState(false);
  const identityInvalidated = useRef(false);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [defaults, setDefaults] = useState(empty);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [state, setState] = useState<DraftCoordinatorSnapshot>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!draftId);
  const [creating, setCreating] = useState(false);
  const session = useRef<{ id: string; coordinator: DraftCoordinator; unsubscribe: () => void }>();
  const generation = useRef(0);
  const freshManualId = useRef(crypto.randomUUID());
  const manualPane = useRef<'bullets' | 'matcher'>('bullets');
  const mounted = useRef(false);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    const browserRecovery = new BrowserRecovery();
    setRecovery(browserRecovery);
    void apiClient.getResumes().then(list => { if (active) { setResumes(list); setDefaults(v => ({ ...v, baseResumeId: list.find(r => r.type === 'template')?.id || list[0]?.id || '' })); } }).catch(() => undefined);
    void apiClient.getRunners().then(result => { if (active) { setRunners(result.runners); const preferred = result.runners.find(r => r.isDefault && r.available) ?? result.runners.find(r => r.available); setDefaults(v => ({ ...v, runner: preferred?.id ?? result.runners.find(r => r.isDefault)?.id ?? '' })); } }).catch(() => undefined);
    // A workspace mismatch disposes the writer and its unload listener. Keep
    // protecting memory-only edits until this host unmounts or content is durable.
    const protectPausedDraft = (event: BeforeUnloadEvent) => {
      if (!identityInvalidated.current || (session.current?.coordinator.canLeave() ?? true)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectPausedDraft);
    registerGuard(() => session.current?.coordinator.canLeave() ?? true);
    return () => { active = false; mounted.current = false; window.removeEventListener('beforeunload', protectPausedDraft); generation.current++; session.current?.unsubscribe(); session.current?.coordinator.dispose(); browserRecovery.dispose(); registerGuard(() => true); };
  }, []);
  useEffect(() => {
    let active = true;
    setIdentityLoading(true);
    let confirmed: string | undefined;
    const confirm = (id?: string) => {
      if (!active || !id) return;
      if (confirmed && confirmed !== id) {
        identityInvalidated.current = true;
        generation.current++;
        session.current?.coordinator.dispose();
        setIdentityMismatch(true);
        setError('Workspace identity changed. Reload before editing.');
        return;
      }
      confirmed = id; setWorkspaceId(id); setIdentityLoading(false);
    };
    void Promise.allSettled([
      apiClient.getHealth().then(health => confirm(health.workspaceId)),
      apiClient.listTailoringDrafts().then(list => confirm(list.workspaceId)),
    ]).then(() => {
      if (!active || confirmed) return;
      setError('Workspace identity unavailable. Connect to your workspace and retry.');
      setIdentityLoading(false);
    });
    return () => { active = false; };
  }, [identityAttempt]);
  const startSession = (id: string) => {
    completionOperation.current = undefined;
    session.current?.unsubscribe(); session.current?.coordinator.dispose();
    const coordinator = new DraftCoordinator({ workspaceId: workspaceId!, draftId: id, api: apiClient, recovery: recovery! });
    session.current = { id, coordinator, unsubscribe: coordinator.subscribe(() => setState(coordinator.getSnapshot())) };
    return coordinator;
  };
  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (identityInvalidated.current) return;
    setCreating(false); setCompleted(undefined);
    if (!draftId) {
      session.current?.unsubscribe(); session.current?.coordinator.dispose(); session.current = undefined;
      setState(undefined); setLoading(false); setError(null); return;
    }
    if (session.current?.id === draftId) return;
    if (!workspaceId || !recovery) return;
    setLoading(true); setError(null); setState(undefined);
    session.current?.unsubscribe(); session.current?.coordinator.dispose(); session.current = undefined;
    void apiClient.getTailoringDraft(draftId).then(async server => {
      if (currentGeneration !== generation.current) return;
      if (server.record.lifecycle === 'completed') { setCompleted(server); return; }
      await startSession(draftId).hydrate(server);
    }).catch(async err => {
      if (currentGeneration !== generation.current) return;
      const coordinator = session.current?.coordinator ?? startSession(draftId);
      const locals = recovery.list(workspaceId).snapshots.filter(s => s.draftId === draftId);
      if (err?.status === 404 && locals.length && locals.every(s => s.base === null)) await coordinator.hydrate(null);
      else await coordinator.hydrate();
    }).catch(err => { if (currentGeneration === generation.current) setError(err?.message || 'Could not load draft'); }).finally(() => { if (currentGeneration === generation.current) setLoading(false); });
  }, [draftId, workspaceId, recovery, canvas]);
  const edit = (payload: SetupPayload) => {
    if (!workspaceId || !recovery || identityInvalidated.current) return;
    let coordinator = session.current?.coordinator;
    if (!coordinator) {
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      const initial: DraftRecord = { schemaVersion: 1, id, kind: 'setup', lifecycle: 'draft', revision: 0, createdAt: now, editedAt: now, savedAt: now, context: {}, appliedContent: {}, base: null, payload };
      coordinator = startSession(id);
      // Explicit seed hydration is synchronous before its returned promise resolves.
      void coordinator.hydrate(null, initial);
      coordinator.edit(payload);
      navigate(`/tailor/drafts/${id}`, true);
    } else coordinator.edit(payload);
  };
  useEffect(() => {
    if (initialPosting && workspaceId && recovery && !draftId && !identityInvalidated.current) { setShowSetup(true); edit({ ...defaults, posting: initialPosting }); onInitialPostingConsumed?.(); }
  }, [initialPosting, workspaceId, draftId, recovery]);
  useEffect(() => {
    const coordinator = session.current?.coordinator;
    const record = coordinator?.getSnapshot().record;
    if (!coordinator || record?.kind !== 'setup' || identityInvalidated.current) return;
    const payload = record.payload;
    const baseResumeId = payload.baseResumeId || defaults.baseResumeId;
    const runner = payload.runner || defaults.runner;
    // Late choices fill a document already created by a user edit or handoff.
    // Fetching defaults on an untouched setup never creates a draft.
    if (baseResumeId !== payload.baseResumeId || runner !== payload.runner) coordinator.edit({ ...payload, baseResumeId, runner });
  }, [defaults]);
  const create = async () => {
    const activeSession = session.current;
    if (!activeSession || identityInvalidated.current) return;
    const coordinator = activeSession.coordinator;
    const operationGeneration = generation.current;
    const isCurrent = () => mounted.current && generation.current === operationGeneration
      && session.current === activeSession && !identityInvalidated.current;
    setCreating(true); setError(null);
    try {
      const saved = await coordinator.awaitSaved();
      if (!isCurrent()) return;
      const result = await apiClient.createRunFromDraft(saved.record.id, { expected: saved.token, operationId: crypto.randomUUID() });
      // The server retains a successful result even if this editor was left while
      // the command ran. An obsolete editor must not redirect the current page.
      if (!isCurrent()) return;
      coordinator.reconcile(result);
      navigate(`/tailor/${result.slug}`);
    } catch (err: any) { if (isCurrent()) setError(err?.message || 'Could not create run'); }
    finally { if (isCurrent()) setCreating(false); }
  };
  const verifyWorkspace = async () => {
    if (identityInvalidated.current) throw Error('Workspace identity changed. Reload before editing.');
    const operationGeneration = generation.current;
    const activeSession = session.current;
    const health = await apiClient.getHealth();
    if (identityInvalidated.current) throw Error('Workspace identity changed. Reload before editing.');
    if (!mounted.current || generation.current !== operationGeneration || session.current !== activeSession) {
      throw Error('The active draft changed while verifying the workspace. Retry from the current draft.');
    }
    if (health.workspaceId !== workspaceId) {
      identityInvalidated.current = true;
      generation.current++;
      session.current?.coordinator.dispose();
      setIdentityMismatch(true);
      throw Error('Workspace identity changed. Reload before editing.');
    }
  };
  const completeManual = async (name: string, type: 'template' | 'tailored', payload: ManualDraftPayload, source?: ResumeRecord) => {
    await verifyWorkspace();
    if (!session.current) editManual(payload, source);
    const activeSession = session.current;
    if (!activeSession) throw Error('Create a manual draft before completing');
    const currentGeneration = generation.current;
    const isCurrent = () => mounted.current && currentGeneration === generation.current && session.current === activeSession && !identityInvalidated.current;
    const saved = completionOperation.current?.saved ?? await activeSession.coordinator.awaitSaved();
    await verifyWorkspace(); if (!isCurrent()) return;
    const pending = completionOperation.current;
    if (pending && (pending.request.name !== name || pending.request.type !== type)) throw Error('Retry the previous completion before changing its name or type');
    completionOperation.current ??= { saved, request: { operationId: crypto.randomUUID(), expected: saved.token, name, type } };
    const current = activeSession.coordinator.getSnapshot().record;
    const newerEdits = canonicalJson([current?.payload, current?.context]) !== canonicalJson([saved.record.payload, saved.record.context]);
    const command = async () => {
      const result = await apiClient.completeTailoringDraft(saved.record.id, completionOperation.current!.request);
      await verifyWorkspace();
      return result;
    };
    const result = newerEdits ? await command() : await activeSession.coordinator.resolveConflict(command);
    if (newerEdits && isCurrent()) activeSession.coordinator.enterConflict();
    if (!isCurrent()) return;
    if (activeSession.coordinator.getSnapshot().record?.lifecycle !== 'completed') throw Error('The saved version is complete. New edits remain in recovery; resolve them before leaving.');
    completionOperation.current = undefined;
    activeSession.unsubscribe(); activeSession.coordinator.dispose(); session.current = undefined;
    setCompleted(result); navigate(`/tailor/drafts/${result.record.id}`, true);
  };
  const editManual = (payload: ManualDraftPayload, source?: ResumeRecord, independent = false) => {
    if (!workspaceId || !recovery || identityInvalidated.current) return false;
    let coordinator = session.current?.coordinator;
    if (independent && coordinator && !coordinator.canLeave()) { setError('Save current changes before choosing another source.'); return false; }
    if (!coordinator || independent) {
      if (!source) return false;
      const id = independent ? crypto.randomUUID() : freshManualId.current; const now = new Date().toISOString();
      const initial: DraftRecord = { schemaVersion: 1, id, kind: 'manual', lifecycle: 'draft', revision: 0, createdAt: now, editedAt: now, savedAt: now, context: { mobilePane: manualPane.current }, appliedContent: {}, base: { resumeId: source.id, spec: source.spec, fingerprint: 'pending-workspace-snapshot' }, payload };
      coordinator = startSession(id);
      void coordinator.hydrate(null, initial);
      coordinator.edit(payload);
      navigate(`/tailor/drafts/${id}`, true);
    } else coordinator.edit(payload);
    return true;
  };
  const handoff = (posting: string) => {
    if (!workspaceId || !recovery || identityInvalidated.current) return;
    if (session.current && !session.current.coordinator.canLeave()) { setError('Save current changes before starting a tailoring run.'); return; }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const original = session.current?.coordinator.getSnapshot().record;
    const payload: SetupPayload = { ...defaults, posting, baseResumeId: original?.kind === 'manual' ? original.payload.selectedResumeId : defaults.baseResumeId };
    const initial: DraftRecord = { schemaVersion: 1, id, kind: 'setup', lifecycle: 'draft', revision: 0, createdAt: now, editedAt: now, savedAt: now, context: {}, appliedContent: {}, base: null, payload };
    const next = new DraftCoordinator({ workspaceId, draftId: id, api: apiClient, recovery });
    void next.hydrate(null, initial); next.edit(payload);
    if (!next.canLeave()) { next.dispose(); setError('Could not save the setup in this browser. Retry after browser storage is available.'); return; }
    session.current?.unsubscribe(); session.current?.coordinator.dispose();
    session.current = { id, coordinator: next, unsubscribe: next.subscribe(() => setState(next.getSnapshot())) };
    setState(next.getSnapshot()); setShowSetup(true);
    navigate(`/tailor/drafts/${id}`, true);
  };
  if (identityMismatch) return <div>
    <p role="alert">Workspace identity changed. Reload before editing.</p>
    <p>Your current draft is retained on this page. Further saves are paused.</p>
    <button disabled={!(session.current?.coordinator.canLeave() ?? true)} onClick={() => {
      if (session.current?.coordinator.canLeave() ?? true) window.location.reload();
    }}>Reload workspace</button>
  </div>;
  if ((draftId || showSetup || canvas) && (!workspaceId || !recovery)) return <div>
    <p>{identityLoading ? 'Connecting to workspace…' : error || 'Workspace identity unavailable.'}</p>
    {!identityLoading && <button onClick={() => setIdentityAttempt(v => v + 1)}>Retry connection</button>}
    <button onClick={() => { setShowSetup(false); navigate('/tailor'); }}>Back to tailoring</button>
  </div>;
  if (draftId && loading) return <p>Loading draft…</p>;
  if (completed) return <CompletedTailoring key={completed.record.id} draft={completed} workspaceId={workspaceId!} verifyWorkspace={verifyWorkspace} onOpenDraft={id => navigate(`/tailor/drafts/${id}`)} onBack={() => navigate('/tailor')} />;
  if (draftId && !state?.record) return <div><h1>Draft unavailable</h1><p>{error || 'This draft could not be found in the connected workspace or browser.'}</p><button onClick={() => navigate('/tailor')}>Back to tailoring</button></div>;
  const record = state?.record;
  const controls = session.current && <DraftControls coordinator={session.current.coordinator} onLoaded={result => { if (result.record.lifecycle === 'completed') { session.current?.unsubscribe(); session.current?.coordinator.dispose(); session.current = undefined; completionOperation.current = undefined; setCompleted(result); } }} verifyWorkspace={verifyWorkspace} onFork={draft => navigate(`/tailor/drafts/${draft.record.id}`)} onBack={() => { setShowSetup(false); navigate('/tailor'); }} />;
  if (draftId && record?.kind === 'run' && record.runSlug) return <TailoringRun coordinator={session.current?.coordinator} slug={record.runSlug} selectedStep={record.context.activeStep} onOpenDraft={id => navigate(`/tailor/drafts/${id}`)} onOpenInCanvas={onOpenCanvas} onBack={() => navigate('/tailor')} />;
  if (canvas || record?.kind === 'manual') return <div className="space-y-4">
    <ParentCompletionLink completionId={record?.parentCompletionId} onOpenDraft={id => navigate(`/tailor/drafts/${id}`)} />
    {controls}
    {state && <DraftStatus status={state.status} savedAt={state.savedAt} onRetry={() => void session.current?.coordinator.retry()} />}
    {error && <p role="alert">{error}</p>}
    <ResumeTailor
      key={record?.kind === 'manual' ? record.id : freshManualId.current}
      initialPayload={record?.kind === 'manual' ? record.payload : undefined}
      preferredResumeId={preferredResumeId}
      initialMobilePane={record?.context.mobilePane === 'matcher' ? 'matcher' : 'bullets'}
      onMobilePaneChange={pane => { manualPane.current = pane; const coordinator = session.current?.coordinator; if (coordinator && !identityInvalidated.current) coordinator.updateContext({ ...coordinator.getSnapshot().record?.context, mobilePane: pane }); }}
      onPayloadChange={(payload, source) => editManual(payload, source)}
      onSourceSelect={(payload, source) => editManual(payload, source, true)}
      onComplete={completeManual}
      verifyWorkspace={verifyWorkspace}
      onBackToRuns={() => navigate('/tailor')}
      onStartTailoringRun={handoff}
    />
  </div>;
  if (showSetup || draftId) return <div className="space-y-4">
    {controls}
    <h1 className="text-2xl font-bold">New tailoring run</h1>
    {state && <DraftStatus status={state.status} savedAt={state.savedAt} onRetry={() => void session.current?.coordinator.retry()} />}
    <TailoringSetup value={record?.kind === 'setup' ? record.payload : defaults} onChange={edit} resumes={resumes} runners={runners} creating={creating} createError={error} onSubmit={() => void create()} onCancel={() => { setShowSetup(false); navigate('/tailor'); }} onOpenSettings={onOpenSettings} />
  </div>;
  return <TailoringRunList onNew={() => setShowSetup(true)} onOpenRun={slug => navigate(`/tailor/${slug}`)} onOpenDraft={id => navigate(`/tailor/drafts/${id}`)} onOpenCanvas={onOpenCanvas} recovery={recovery} workspaceId={workspaceId} />;
}
