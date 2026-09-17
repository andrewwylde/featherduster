import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, LogIn, LogOut } from 'lucide-react';
import { apiClient, type ClaudeAuthStatus, type ClaudeLoginJob, type RunnerSettingsPatch } from '../../api/client';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui';
import { CardHeader, Pill, TestConnectionButton, labelClass } from './shared';

interface ClaudeCodeCardProps {
  model: string;
  onPatch: (patch: RunnerSettingsPatch) => Promise<void>;
}

export const ClaudeCodeCard: React.FC<ClaudeCodeCardProps> = ({ model, onPatch }) => {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [login, setLogin] = useState<ClaudeLoginJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelDraft, setModelDraft] = useState(model);

  useEffect(() => setModelDraft(model), [model]);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.getClaudeAuth();
      setStatus(res.status);
      setLogin(res.login);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not read Claude Code status');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while a browser sign-in is in progress.
  useEffect(() => {
    if (login?.state !== 'running') return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [login?.state, refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const signingIn = login?.state === 'running';

  return (
    <section aria-labelledby="claude-code-heading" className={`${cardClass} p-5 space-y-4`}>
      <CardHeader
        id="claude-code-heading"
        title="Claude Code"
        subtitle="Uses your Claude Code sign-in. Runs locally with tools disabled; evidence is redacted before it is sent."
        badge={
          status ? (
            !status.installed ? (
              <Pill tone="warn">Not installed</Pill>
            ) : status.loggedIn ? (
              <Pill tone="good">Signed in</Pill>
            ) : (
              <Pill tone="warn">Signed out</Pill>
            )
          ) : null
        }
      />

      {status && status.installed && status.loggedIn && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Account</dt>
            <dd className="text-slate-900 dark:text-white">{status.email ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Method</dt>
            <dd className="text-slate-900 dark:text-white">
              {status.authMethod ?? 'Unknown'}
              {status.subscriptionType ? ` · ${status.subscriptionType}` : ''}
            </dd>
          </div>
        </dl>
      )}
      {status && !status.installed && <p className="text-sm text-amber-800 dark:text-amber-300">{status.detail}</p>}

      {signingIn && (
        <div role="status" className="rounded-desk bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Finish signing in in your browser…
          </p>
          {login?.url && (
            <a href={login.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
              Browser didn't open? Open the sign-in page <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          <div className="mt-2">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.cancelClaudeLogin())}>
              Cancel sign-in
            </button>
          </div>
        </div>
      )}
      {login && (login.state === 'failed' || login.state === 'cancelled') && (
        <div role="alert" className="rounded-desk bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          Sign-in {login.state === 'cancelled' ? 'was cancelled' : 'failed'}.
          {login.output && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs">{login.output}</pre>}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}

      {status?.installed && !signingIn && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} disabled={busy} onClick={() => act(() => apiClient.startClaudeLogin('claudeai'))}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {status.loggedIn ? 'Switch account' : 'Sign in with Claude subscription'}
          </button>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.startClaudeLogin('console'))}>
            Sign in with Anthropic Console (API billing)
          </button>
          {status.loggedIn && (
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.logoutClaude())}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} flex-1 min-w-[14rem]`}>
          Model (blank = Claude Code default)
          <input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} placeholder="e.g. opus, sonnet" className={`${inputClass} mt-1`} />
        </label>
        <button type="button" className={secondaryButton} disabled={modelDraft === model} onClick={() => onPatch({ 'claude-code': { model: modelDraft.trim() } })}>
          Save model
        </button>
      </div>

      <TestConnectionButton runner="claude-code" />
    </section>
  );
};
