import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DraftCoordinator, type DraftCoordinatorOptions } from './coordinator';

export function useTailoringDraft(options: DraftCoordinatorOptions) {
  // Dependencies intentionally identify a document, not freshly allocated render options.
  const coordinator = useMemo(() => new DraftCoordinator(options), [options.workspaceId, options.draftId]);
  useEffect(() => { coordinator.connect(); return () => coordinator.dispose(); }, [coordinator]);
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  return { ...snapshot, coordinator, canLeave: coordinator.canLeave, retry: coordinator.retry, awaitSaved: coordinator.awaitSaved };
}
