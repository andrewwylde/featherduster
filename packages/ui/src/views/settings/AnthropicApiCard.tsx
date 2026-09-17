import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiClient, type CredentialSummary, type RunnerSettingsPatch, type SettingsResponse } from '../../api/client';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui';
import { CardHeader, Pill, TestConnectionButton, labelClass } from './shared';

const SUGGESTED_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1'];

interface AnthropicApiCardProps {
  credential: CredentialSummary;
  model: string;
  onSettings: (next: SettingsResponse) => void;
  onPatch: (patch: RunnerSettingsPatch) => Promise<void>;
}

export const AnthropicApiCard: React.FC<AnthropicApiCardProps> = ({ credential, model, onSettings, onPatch }) => {
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState(model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setModelDraft(model), [model]);

  const act = async (fn: () => Promise<SettingsResponse>, done: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      onSettings(await fn());
      setNotice(done);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Action failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const envActive = credential.source === 'env';
  const hasStoredKey = credential.source === 'keychain' || credential.shadowedKeychainValue;

  return (
    <section aria-labelledby="anthropic-heading" className={`${cardClass} p-5 space-y-4`}>
      <CardHeader
        id="anthropic-heading"
        title="Anthropic API"
        subtitle="Calls the Claude API directly with your API key. Evidence is redacted before it is sent."
        badge={credential.configured ? <Pill tone="good">Key configured</Pill> : <Pill tone="warn">No key</Pill>}
      />

      <div className="text-sm text-slate-700 dark:text-slate-300">
        {credential.configured ? (
          <p className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Using the key ending <span className="font-mono">{credential.last4}</span>{' '}
            {envActive ? (
              <>
                from <span className="font-mono">{credential.envVar}</span>.
              </>
            ) : (
              <>saved in {credential.storeDetail}.</>
            )}
          </p>
        ) : (
          <p>No API key yet. Keys are saved in {credential.storeDetail}, never in your workspace or git.</p>
        )}
        {envActive && (
          <p className="mt-1 text-xs text-slate-500">
            Environment variables take precedence over saved keys.
            {credential.shadowedKeychainValue && ' A saved key also exists and will be used if the variable is removed.'}
          </p>
        )}
      </div>

      {!credential.storeAvailable ? (
        <p role="alert" className="rounded-desk bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          The OS credential store is unavailable ({credential.storeDetail}). Set ANTHROPIC_API_KEY in the environment that launches Featherduster instead.
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => apiClient.saveAnthropicKey(keyDraft.trim()), 'Key saved.').then((ok) => ok && setKeyDraft(''));
          }}
        >
          <label className={`${labelClass} flex-1 min-w-[16rem]`}>
            {hasStoredKey ? 'Replace saved API key' : 'API key'}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-ant-…"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <button type="submit" className={primaryButton} disabled={busy || keyDraft.trim().length === 0}>
            Save key
          </button>
          {hasStoredKey && (
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => act(() => apiClient.removeAnthropicKey(), 'Saved key removed.')}>
              Remove saved key
            </button>
          )}
        </form>
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

      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} flex-1 min-w-[14rem]`}>
          Model
          <input list="anthropic-models" value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} className={`${inputClass} mt-1`} />
          <datalist id="anthropic-models">
            {SUGGESTED_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className={secondaryButton}
          disabled={!modelDraft.trim() || modelDraft === model}
          onClick={() => onPatch({ 'anthropic-api': { model: modelDraft.trim() } })}
        >
          Save model
        </button>
      </div>

      <TestConnectionButton runner="anthropic-api" />
    </section>
  );
};
