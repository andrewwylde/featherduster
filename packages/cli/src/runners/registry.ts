import { AnthropicApiRunner } from './anthropic-api.js';
import { ClaudeCodeRunner } from './claude-code.js';
import { OllamaRunner } from './ollama.js';
import { FakeRunner } from './fake.js';
import { createDemoResponder } from './demo-responder.js';
import type { ModelRunner, RunnerDetection, RunnerId } from './types.js';
import type { RunnerConfig } from '../tailoring/config.js';

export interface RunnerInfo extends RunnerDetection {
  id: RunnerId;
  label: string;
  locality: 'local' | 'cloud';
  model: string;
  isDefault: boolean;
}

export type RunnerFactory = (id: RunnerId, config: RunnerConfig) => ModelRunner | null;

/** Whether the scripted demo runner is enabled (walkthroughs / e2e). */
export function fakeRunnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FEATHERDUSTER_RUNNER === 'fake';
}

let sharedDemoRunner: FakeRunner | null = null;

export const defaultRunnerFactory: RunnerFactory = (id, config) => {
  switch (id) {
    case 'claude-code':
      return new ClaudeCodeRunner({ command: config['claude-code'].command, model: config['claude-code'].model });
    case 'anthropic-api':
      return new AnthropicApiRunner({ model: config['anthropic-api'].model });
    case 'ollama':
      return new OllamaRunner({ url: config.ollama.url, model: config.ollama.model, maxContext: config.ollama.max_context });
    case 'fake':
      if (!fakeRunnerEnabled()) return null;
      if (!sharedDemoRunner) {
        sharedDemoRunner = new FakeRunner([], { delayMs: 400, fallback: createDemoResponder() });
      }
      return sharedDemoRunner;
  }
};

export function listRunnerIds(): RunnerId[] {
  const ids: RunnerId[] = ['claude-code', 'anthropic-api', 'ollama'];
  if (fakeRunnerEnabled()) ids.unshift('fake');
  return ids;
}

export async function detectRunners(config: RunnerConfig, factory: RunnerFactory = defaultRunnerFactory): Promise<RunnerInfo[]> {
  const ids = listRunnerIds();
  const defaultId: RunnerId = fakeRunnerEnabled() ? 'fake' : config.default;
  return Promise.all(
    ids.map(async (id) => {
      const runner = factory(id, config);
      if (!runner) {
        return { id, label: id, locality: 'cloud' as const, model: '', isDefault: false, available: false, detail: 'Unavailable' };
      }
      const detection = await runner.detect();
      return {
        id,
        label: runner.label,
        locality: runner.locality,
        model: runner.model,
        isDefault: id === defaultId,
        ...detection,
      };
    })
  );
}
