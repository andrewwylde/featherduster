import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalJson, hasUnappliedChanges, type DraftContext, type DraftEnvelope, type RunDraftPayload } from '@featherduster/core';
import { apiClient, type TailoringRunDetail } from '../../api/client';
import { DraftCoordinator, type DraftCoordinatorSnapshot } from '../../tailoring-drafts/coordinator';
import { BrowserRecovery } from '../../tailoring-drafts/recovery';

/** Owns a run writer, or borrows the writer already hydrated by the draft route. */
export function useRunRecovery(slug: string, supplied?: DraftCoordinator, registerGuard?: (guard: () => boolean) => void) {
  const [state, setState] = useState<DraftCoordinatorSnapshot>();
  const [error, setError] = useState<string>();
  const [identityError, setIdentityError] = useState<string>();
  const identityFailure = useRef<string>();
  const workspaceId = useRef<string>();
  const coordinator = useRef<DraftCoordinator>();
  const session = useRef(0);
  const initializer = useRef<Promise<void>>();
  const resources = useRef<{ recovery?: BrowserRecovery; unsubscribe?: () => void }>();
  const current = useCallback(() => session.current, []);
  const isCurrent = useCallback((id: number) => session.current === id, []);
  useEffect(() => {
    session.current++;
    setState(undefined); setError(undefined); setIdentityError(undefined);
    identityFailure.current = undefined; workspaceId.current = supplied?.workspaceId;
    initializer.current = undefined;
    resources.current = {};
    coordinator.current = supplied;
    if (supplied) {
      setState(supplied.getSnapshot());
      resources.current.unsubscribe = supplied.subscribe(() => setState(supplied.getSnapshot()));
    }
    const protectPausedDraft = (event: BeforeUnloadEvent) => {
      if (!identityFailure.current || (coordinator.current?.canLeave() ?? true)) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectPausedDraft);
    registerGuard?.(() => coordinator.current?.canLeave() ?? true);
    return () => {
      session.current++;
      window.removeEventListener('beforeunload', protectPausedDraft);
      resources.current?.unsubscribe?.();
      if (!supplied) { coordinator.current?.dispose(); resources.current?.recovery?.dispose(); }
      coordinator.current = undefined;
      registerGuard?.(() => true);
    };
  }, [slug, supplied]);

  const pauseIdentity = (message: string): never => {
    identityFailure.current = message;
    setIdentityError(message);
    // Keep the writer and its current record available for memory-only guards,
    // but stop timers, retries, subscriptions, and late command continuations.
    session.current++;
    coordinator.current?.dispose();
    throw Error(message);
  };
  const verifyIdentity = useCallback(async () => {
    if (identityFailure.current) throw Error(identityFailure.current);
    const generation = session.current;
    const health = await apiClient.getHealth();
    if (generation !== session.current) throw Error(identityFailure.current ?? 'Run changed');
    if (!health.workspaceId) throw Error('Workspace identity unavailable. Reconnect before continuing.');
    if (workspaceId.current && workspaceId.current !== health.workspaceId) {
      pauseIdentity('Workspace identity changed. Reload the intended workspace before continuing.');
    }
    workspaceId.current = health.workspaceId;
    return health.workspaceId;
  }, []);

  const verifyCommandIdentity = async () => {
    await verifyIdentity();
    const generation = session.current;
    const detail = await apiClient.getTailoringRun(slug);
    await verifyIdentity();
    if (generation !== session.current) throw Error(identityFailure.current ?? 'Run changed');
    const expectedId = coordinator.current?.getSnapshot().record?.id;
    if (expectedId && detail.draft?.record.id !== expectedId) {
      pauseIdentity('Run draft identity changed. Reload the intended workspace before continuing.');
    }
  };

  const receive = useCallback(async (detail: TailoringRunDetail) => {
    // The request caller confirms identity before reading. Confirm it again
    // before accepting a response, including responses from explicit commands.
    const confirmed = await verifyIdentity();
    const envelope = detail.draft;
    const expectedId = coordinator.current?.getSnapshot().record?.id;
    if (expectedId && envelope?.record.id !== expectedId) pauseIdentity('Run draft identity changed. Reload the intended workspace before continuing.');
    if (!envelope) return; // Older workspaces can still display their validated artifacts.
    if (envelope.record.lifecycle === 'completed') {
      const local = coordinator.current?.getSnapshot().record;
      if (local && canonicalJson([local.payload, local.context]) !== canonicalJson([envelope.record.payload, envelope.record.context])) { coordinator.current?.enterConflict(); throw Error('Completed version saved; newer edits remain in recovery. Resolve them before leaving.'); }
      resources.current?.unsubscribe?.(); coordinator.current?.dispose(); coordinator.current = undefined;
      setState({ record: envelope.record, token: envelope.token, status: 'saved', savedAt: envelope.record.savedAt, hasUnsavedContent: false, conflicts: [] });
      return;
    }
    const generation = session.current;
    if (!coordinator.current || initializer.current) {
      initializer.current ??= (async () => {
        if (generation !== session.current || identityFailure.current) return;
        const recovery = new BrowserRecovery();
        const writer = new DraftCoordinator({ workspaceId: confirmed, draftId: envelope.record.id, api: apiClient, recovery });
        coordinator.current = writer;
        resources.current = { recovery, unsubscribe: writer.subscribe(() => setState(writer.getSnapshot())) };
        await writer.hydrate(envelope);
        if (generation === session.current) setState(writer.getSnapshot());
      })();
      const pending = initializer.current;
      try { await pending; if (generation === session.current && initializer.current === pending) initializer.current = undefined; } catch (err) {
        if (generation === session.current) { setError((err as Error).message); initializer.current = undefined; }
        throw err;
      }
    }
    if (generation !== session.current) return;
    reconcile(envelope);
  }, []);

  const reconcile = (envelope: DraftEnvelope, applied = false) => {
    const writer = coordinator.current;
    const local = writer?.getSnapshot();
    if (identityFailure.current) throw Error(identityFailure.current);
    if (!writer || !local?.record) return;
    if (local.record.id !== envelope.record.id) pauseIdentity('Run draft identity changed. Reload the intended workspace before continuing.');
    if (local.token && envelope.token.revision < local.token.revision) return;
    // Changed artifacts must not silently consume even already-autosaved edits.
    // Preserve recovery without changing the user's content edit timestamp.
    if (!applied && local.record.kind === 'run' && envelope.record.kind === 'run'
      && envelope.token.revision >= (local.token?.revision ?? 0)
      && canonicalJson(local.record.payload.artifactTokens) !== canonicalJson(envelope.record.payload.artifactTokens)
      && hasUnappliedChanges(local.record)) writer.enterConflict();
    writer.reconcile(envelope);
  };
  const edit = (patch: Partial<RunDraftPayload>) => {
    if (identityFailure.current) return;
    const writer = coordinator.current;
    const record = writer?.getSnapshot().record;
    if (record?.kind === 'run') writer!.edit({ ...record.payload, ...patch });
  };
  const updateContext = (patch: Partial<DraftContext>) => {
    if (identityFailure.current) return;
    const writer = coordinator.current;
    const record = writer?.getSnapshot().record;
    if (record) {
      const context = { ...record.context, ...patch };
      if (canonicalJson(context) !== canonicalJson(record.context)) writer!.updateContext(context);
    }
  };
  const record = state?.record;
  const payload = record?.kind === 'run' ? record.payload : undefined;
  useEffect(() => {
    if (!payload || !record || record.lifecycle !== 'draft') return;
    const ids = new Set(payload.proposals?.proposals.map(p => p.id));
    const patch: Partial<DraftContext> = {};
    if (record.context.selectedProposalId && !ids.has(record.context.selectedProposalId)) patch.selectedProposalId = undefined;
    if (record.context.editingProposalId && !ids.has(record.context.editingProposalId)) patch.editingProposalId = undefined;
    if (Object.keys(patch).length) updateContext(patch);
  }, [record]);
  return { workspaceId: workspaceId.current, state, error, identityError, verifyIdentity, verifyCommandIdentity, payload, context: record?.context ?? {}, coordinator, receive, reconcile, edit, updateContext, current, isCurrent };
}
