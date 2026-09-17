import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type RunnerId, type RunnerSettingsPatch, type SettingsResponse } from '../../api/client';
import { cardClass, eyebrowClass, inputClass, secondaryButton } from '../tailoring/ui';
import { AnthropicApiCard } from './AnthropicApiCard';
import { ClaudeCodeCard } from './ClaudeCodeCard';
import { CodexCard } from './CodexCard';
import { OllamaCard } from './OllamaCard';
import { CardHeader, labelClass } from './shared';

const RUNNER_LABELS: Record<Exclude<RunnerId, 'fake'>, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'anthropic-api': 'Anthropic API',
  ollama: 'Ollama',
};

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [timeoutDraft, setTimeoutDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await apiClient.getSettings();
      setSettings(next);
      setTimeoutDraft(String(next.runner.step_timeout_seconds));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (change: RunnerSettingsPatch) => {
    setSaveError(null);
    setSaved(false);
    try {
      const next = await apiClient.updateRunnerSettings(change);
      setSettings(next);
      setTimeoutDraft(String(next.runner.step_timeout_seconds));
      setSaved(true);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save settings');
    }
  };

  if (loadError && !settings) {
    return (
      <div role="alert" className="rounded-desk border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
        <p className="font-semibold">Settings could not load.</p>
        <p className="mt-1 text-sm">{loadError}</p>
        <button type="button" className={`${secondaryButton} mt-4`} onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!settings) return <p className="text-sm text-slate-500">Loading settings…</p>;

  const consents = Object.entries(settings.runner_consent) as Array<[RunnerId, string]>;
  const timeoutValue = Number(timeoutDraft);

  return (
    <div className="space-y-6">
      <header>
        <span className={eyebrowClass}>Settings</span>
        <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Model runners</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Choose how tailoring runs call a model. Preferences are saved to <span className="font-mono">.featherduster/config.yaml</span>; API
          keys go to your OS credential store, never the workspace.
        </p>
        <div aria-live="polite" className="mt-2 text-sm">
          {saved && <span className="text-emerald-700 dark:text-emerald-300">Saved.</span>}
          {saveError && <span role="alert" className="text-rose-700 dark:text-rose-300">{saveError}</span>}
        </div>
      </header>

      <section aria-labelledby="general-heading" className={`${cardClass} p-5 space-y-4`}>
        <CardHeader id="general-heading" title="Defaults" subtitle="Applies to new tailoring runs in this workspace." />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className={labelClass}>
            Default runner
            <select
              value={settings.runner.default}
              onChange={(e) => patch({ default: e.target.value as Exclude<RunnerId, 'fake'> })}
              className={`${inputClass} mt-1`}
            >
              {Object.entries(RUNNER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <label className={labelClass}>
              Step timeout (seconds)
              <input
                type="number"
                min={30}
                max={3600}
                value={timeoutDraft}
                onChange={(e) => setTimeoutDraft(e.target.value)}
                onBlur={() => {
                  if (Number.isInteger(timeoutValue) && timeoutValue !== settings.runner.step_timeout_seconds) {
                    patch({ step_timeout_seconds: timeoutValue });
                  }
                }}
                className={`${inputClass} mt-1`}
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-500">30–3600. Saved when you leave the field.</p>
          </div>
          <label className={labelClass}>
            Flag filler in proposed edits at
            <select
              value={settings.deslop_warn_band}
              onChange={(e) => patch({ deslop_warn_band: e.target.value as SettingsResponse['deslop_warn_band'] })}
              className={`${inputClass} mt-1`}
            >
              <option value="low">Low and above</option>
              <option value="moderate">Moderate and above</option>
              <option value="high">High only</option>
            </select>
          </label>
        </div>
      </section>

      <ClaudeCodeCard model={settings.runner['claude-code'].model} onPatch={patch} />
      <CodexCard model={settings.runner.codex.model} onPatch={patch} />
      <AnthropicApiCard
        credential={settings.credentials.anthropic}
        model={settings.runner['anthropic-api'].model}
        onSettings={setSettings}
        onPatch={patch}
      />
      <OllamaCard settings={settings.runner.ollama} onPatch={patch} />

      <section aria-labelledby="consent-heading" className={`${cardClass} p-5 space-y-3`}>
        <CardHeader
          id="consent-heading"
          title="Cloud consent"
          subtitle="Runners you allowed to receive redacted evidence. Revoking asks again before the next run."
        />
        {consents.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No cloud runner has consent yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {consents.map(([runner, date]) => (
              <li key={runner} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  {RUNNER_LABELS[runner as Exclude<RunnerId, 'fake'>] ?? runner}{' '}
                  <span className="text-xs text-slate-500">since {date}</span>
                </span>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={async () => {
                    try {
                      setSettings(await apiClient.revokeRunnerConsent(runner));
                    } catch (err: any) {
                      setSaveError(err?.message || 'Could not revoke consent');
                    }
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
