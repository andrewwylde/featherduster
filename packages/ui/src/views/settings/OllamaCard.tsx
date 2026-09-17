import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiClient, type RunnerPreferences, type RunnerSettingsPatch } from '../../api/client';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui';
import { CardHeader, Pill, TestConnectionButton, labelClass } from './shared';

interface OllamaCardProps {
  settings: RunnerPreferences['ollama'];
  onPatch: (patch: RunnerSettingsPatch) => Promise<void>;
}

export const OllamaCard: React.FC<OllamaCardProps> = ({ settings, onPatch }) => {
  const [url, setUrl] = useState(settings.url);
  const [model, setModel] = useState(settings.model);
  const [maxContext, setMaxContext] = useState(String(settings.max_context));
  const [models, setModels] = useState<string[]>([]);
  const [reach, setReach] = useState<{ reachable: boolean; detail: string } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setUrl(settings.url);
    setModel(settings.model);
    setMaxContext(String(settings.max_context));
  }, [settings.url, settings.model, settings.max_context]);

  const loadModels = useCallback(async (target: string) => {
    setLoadingModels(true);
    try {
      const res = await apiClient.getOllamaModels(target);
      setModels(res.models);
      setReach({ reachable: res.reachable, detail: res.detail });
    } catch (err: any) {
      setModels([]);
      setReach({ reachable: false, detail: err?.message || 'Could not reach Ollama' });
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadModels(settings.url);
  }, [loadModels, settings.url]);

  const parsedContext = Number(maxContext);
  const dirty = url !== settings.url || model !== settings.model || parsedContext !== settings.max_context;
  const valid = /^https?:\/\//.test(url) && Number.isInteger(parsedContext) && parsedContext >= 2048;
  const options = model && !models.includes(model) ? [model, ...models] : models;

  return (
    <section aria-labelledby="ollama-heading" className={`${cardClass} p-5 space-y-4`}>
      <CardHeader
        id="ollama-heading"
        title="Ollama"
        subtitle="Runs a local model. Evidence never leaves this machine, so nothing is redacted."
        badge={reach ? reach.reachable ? <Pill tone="good">Reachable</Pill> : <Pill tone="warn">Not reachable</Pill> : null}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className={labelClass}>
          Server URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          Model
          <select value={model} onChange={(e) => setModel(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">Choose a model…</option>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Max context (tokens)
          <input type="number" min={2048} step={1024} value={maxContext} onChange={(e) => setMaxContext(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>
      {reach && <p className="text-xs text-slate-600 dark:text-slate-400">{reach.detail}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={loadingModels || !/^https?:\/\//.test(url)} onClick={() => loadModels(url)}>
          <RefreshCw className={`h-4 w-4 ${loadingModels ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh models
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={!dirty || !valid}
          onClick={() => onPatch({ ollama: { url: url.trim(), model, max_context: parsedContext } })}
        >
          Save Ollama settings
        </button>
      </div>

      <TestConnectionButton runner="ollama" />
    </section>
  );
};
