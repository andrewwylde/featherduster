import type { DraftSaveStatus } from '../../tailoring-drafts/coordinator';

export function DraftStatus({ status, savedAt, onRetry }: { status: DraftSaveStatus; savedAt?: string; onRetry: () => void }) {
  const text = { saved: 'Draft saved', saving: 'Saving…', 'browser-only': 'Saved in this browser · Workspace save pending', unsaved: 'Unsaved changes', conflict: 'Conflicting draft versions · Choose which version to keep' }[status];
  return <div className="draft-status">
    <span role="status" aria-live="polite" aria-atomic="true">{text}</span>
    {status === 'saved' && savedAt && <span> · <time dateTime={savedAt}>{new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>}
    {(status === 'unsaved' || status === 'browser-only') && <span> · <button type="button" onClick={onRetry}>Retry</button></span>}
  </div>;
}
