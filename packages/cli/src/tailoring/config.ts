import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { RunnerId } from '../runners/types.js';

export interface RunnerConfig {
  default: RunnerId;
  step_timeout_seconds: number;
  'claude-code': { model: string; command: string };
  'anthropic-api': { model: string };
  ollama: { url: string; model: string; max_context: number };
}

export interface TailoringConfig {
  runner: RunnerConfig;
  runner_consent: Partial<Record<RunnerId, string>>;
  deslop_warn_band: 'low' | 'moderate' | 'high';
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  default: 'claude-code',
  step_timeout_seconds: 180,
  'claude-code': { model: '', command: 'claude' },
  'anthropic-api': { model: 'claude-opus-5' },
  ollama: { url: 'http://127.0.0.1:11434', model: '', max_context: 32768 },
};

const RUNNER_IDS: RunnerId[] = ['claude-code', 'anthropic-api', 'ollama', 'fake'];

function configPath(workspaceDir: string): string {
  return path.join(workspaceDir, '.featherduster', 'config.yaml');
}

function readRawConfig(workspaceDir: string): Record<string, any> {
  try {
    const raw = yaml.load(fs.readFileSync(configPath(workspaceDir), 'utf-8'));
    return raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Lenient loader: missing or malformed fields fall back to defaults (older workspaces have no runner block). */
export function loadTailoringConfig(workspaceDir: string): TailoringConfig {
  const raw = readRawConfig(workspaceDir);
  const r = raw.runner && typeof raw.runner === 'object' ? raw.runner : {};
  const d = DEFAULT_RUNNER_CONFIG;
  const runner: RunnerConfig = {
    default: RUNNER_IDS.includes(r.default) ? r.default : d.default,
    step_timeout_seconds: num(r.step_timeout_seconds, d.step_timeout_seconds),
    'claude-code': {
      model: str(r['claude-code']?.model, d['claude-code'].model),
      command: str(r['claude-code']?.command, d['claude-code'].command) || d['claude-code'].command,
    },
    'anthropic-api': {
      model: str(r['anthropic-api']?.model, d['anthropic-api'].model) || d['anthropic-api'].model,
    },
    ollama: {
      url: str(r.ollama?.url, d.ollama.url) || d.ollama.url,
      model: str(r.ollama?.model, d.ollama.model),
      max_context: num(r.ollama?.max_context, d.ollama.max_context),
    },
  };
  const consent: Partial<Record<RunnerId, string>> = {};
  if (raw.runner_consent && typeof raw.runner_consent === 'object') {
    for (const id of RUNNER_IDS) {
      const v = raw.runner_consent[id];
      if (typeof v === 'string' || v instanceof Date) consent[id] = String(v instanceof Date ? v.toISOString().slice(0, 10) : v);
    }
  }
  const band = raw.deslop_warn_band;
  return {
    runner,
    runner_consent: consent,
    deslop_warn_band: band === 'low' || band === 'high' || band === 'moderate' ? band : 'moderate',
  };
}

/** Records consent for a cloud runner, preserving all other config keys. */
export function recordRunnerConsent(workspaceDir: string, runnerId: RunnerId, date: string): void {
  const raw = readRawConfig(workspaceDir);
  const consent = raw.runner_consent && typeof raw.runner_consent === 'object' ? raw.runner_consent : {};
  consent[runnerId] = date;
  raw.runner_consent = consent;
  fs.mkdirSync(path.dirname(configPath(workspaceDir)), { recursive: true });
  fs.writeFileSync(configPath(workspaceDir), yaml.dump(raw, { indent: 2 }), 'utf-8');
}
