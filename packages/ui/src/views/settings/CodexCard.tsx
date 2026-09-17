import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, LogIn, LogOut } from 'lucide-react';
import { apiClient, type CodexAuthStatus, type CodexLoginJob, type RunnerSettingsPatch } from '../../api/client';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui';
import { CardHeader, Pill, TestConnectionButton, labelClass } from './shared';

interface CodexCardProps {
  model: string;
  onPatch: (patch: RunnerSettingsPatch) => Promise<void>;
}

const METHOD_LABEL: Record<NonNullable<CodexAuthStatus['method']>, string> = {
  chatgpt: 'ChatGPT account',
  'api-key': 'OpenAI API key',
};

export const CodexCard: React.FC<CodexCardProps> = ({ model, onPatch }) => {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [login, setLogin] = useState<CodexLoginJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState(model);

  useEffect(() => setModelDraft(model), [model]);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.getCodexAuth();
      setStatus(res.status);
      setLogin(res.login);
    } catch (err: any) {
      setError(err?.message || 'Could not read Codex status');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (login?.state !== 'running') return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [login?.state, refresh]);

  const act = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      if (done) setNotice(done);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Action failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const signingIn = login?.state === 'running';

  return (
    <section aria-labelledby="codex-heading" className={`${cardClass} p-5 space-y-4`}>
      <CardHeader
        id="codex-heading"
        title="Codex"
        subtitle="Uses your Codex CLI sign-in (OpenAI). Runs locally with tools disabled; evidence is redacted before it is sent."
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

      {status?.installed && status.loggedIn && (
        <p className="text-sm text-slate-800 dark:text-slate-200">
          Signed in with {status.method ? METHOD_LABEL[status.method] : 'Codex'}.{' '}
          <span className="text-xs text-slate-500">{status.detail}</span>
        </p>
      )}
      {status && !status.installed && <p className="text-sm text-amber-800 dark:text-amber-300">{status.detail}</p>}

      {signingIn && (
        <div role="status" className="rounded-desk bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {login?.mode === 'device' ? 'Enter the code below on the sign-in page…' : 'Finish signing in in your browser…'}
          </p>
          {login?.output && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">{login.output}</pre>}
          {login?.url && (
            <a href={login.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
              Open the sign-in page <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          <div className="mt-2">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.cancelCodexLogin())}>
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
      {notice && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}

      {status?.installed && !signingIn && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy} onClick={() => act(() => apiClient.startCodexLogin('chatgpt'))}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {status.loggedIn ? 'Switch to ChatGPT sign-in' : 'Sign in with ChatGPT'}
            </button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.startCodexLogin('device'))}>
              Sign in with a device code
            </button>
            {status.loggedIn && (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.logoutCodex(), 'Signed out of Codex.')}>
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
              </button>
            )}
          </div>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const res = await apiClient.loginCodexWithApiKey(keyDraft.trim());
                if (!res.ok) throw new Error(res.detail || 'Codex rejected the API key');
              }, 'Codex signed in with your API key.').then((ok) => ok && setKeyDraft(''));
            }}
          >
            <label className={`${labelClass} flex-1 min-w-[16rem]`}>
              Or use an OpenAI API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-…"
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <button type="submit" className={secondaryButton} disabled={busy || keyDraft.trim().length === 0}>
              <KeyRound className="h-4 w-4" aria-hidden="true" /> Sign in with key
            </button>
          </form>
          <p className="text-[11px] text-slate-500">The key is handed to Codex, which stores it in its own sign-in file. Featherduster keeps no copy.</p>
        </>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} flex-1 min-w-[14rem]`}>
          Model (blank = Codex default)
          <input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} placeholder="e.g. gpt-5-codex" className={`${inputClass} mt-1`} />
        </label>
        <button type="button" className={secondaryButton} disabled={modelDraft === model} onClick={() => onPatch({ codex: { model: modelDraft.trim() } })}>
          Save model
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Note: Codex always includes descriptions of your locally installed skills in each request (there is no switch to turn this off). Evidence is still
        redacted, and all Codex tools are disabled.
      </p>

      <TestConnectionButton runner="codex" />
    </section>
  );
};
