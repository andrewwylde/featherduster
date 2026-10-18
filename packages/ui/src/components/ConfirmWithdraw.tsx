import { useState } from 'react';
import { secondaryButton } from '../views/tailoring/ui.js';
import { confirmLabel } from './corpus-labels.js';

/** Withdrawal reaches every job in its scope, so it states that and asks once more inline (no browser dialog). */
export function ConfirmWithdraw({ label, effect, disabled, onConfirm }: { label: string; effect: string; disabled?: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return <div className="space-y-1">
    <p className="text-xs text-slate-600 dark:text-slate-400">{effect} Jobs already prepared keep what they captured.</p>
    {confirming
      ? <div className="flex flex-wrap gap-2">
        <button className={`${secondaryButton} border-rose-300 text-rose-700 dark:border-rose-900 dark:text-rose-300`} disabled={disabled} onClick={() => { setConfirming(false); onConfirm(); }}>{confirmLabel(label)}</button>
        <button className={secondaryButton} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
      : <button className={secondaryButton} disabled={disabled} onClick={() => setConfirming(true)}>{label}</button>}
  </div>;
}
