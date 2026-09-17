import React, { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { apiClient, type RunnerId } from '../../api/client';
import { secondaryButton } from '../tailoring/ui';

export const labelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-300';

export const TestConnectionButton: React.FC<{ runner: RunnerId }> = ({ runner }) => {
  const [state, setState] = useState<'idle' | 'testing' | 'done'>('idle');
  const [result, setResult] = useState<{ available: boolean; detail: string } | null>(null);

  const run = async () => {
    setState('testing');
    try {
      setResult(await apiClient.testRunner(runner));
    } catch (err: any) {
      setResult({ available: false, detail: err?.message || 'Test failed' });
    } finally {
      setState('done');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={secondaryButton} onClick={run} disabled={state === 'testing'}>
        {state === 'testing' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Test connection
      </button>
      {state === 'done' && result && (
        <span
          role="status"
          className={`inline-flex items-center gap-1.5 text-xs ${
            result.available ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
          }`}
        >
          {result.available ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
          {result.detail}
        </span>
      )}
    </div>
  );
};

export const CardHeader: React.FC<{ title: string; subtitle: string; badge?: React.ReactNode; id: string }> = ({
  title,
  subtitle,
  badge,
  id,
}) => (
  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800/80">
    <div>
      <h2 id={id} className="text-base font-bold text-slate-900 dark:text-white">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{subtitle}</p>
    </div>
    {badge}
  </div>
);

export const Pill: React.FC<{ tone: 'good' | 'warn' | 'neutral'; children: React.ReactNode }> = ({ tone, children }) => {
  const styles = {
    good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>;
};
