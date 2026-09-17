import Anthropic from '@anthropic-ai/sdk';
import { abortError, RunnerError, type ModelRunner, type RunnerDetection, type RunnerRequest } from './types.js';
import {
  getCredentialStore,
  resolveAnthropicCredential,
  type CredentialStore,
  type ResolvedCredential,
} from '../settings/credentials.js';

export interface AnthropicApiRunnerOptions {
  model?: string;
  /** Injected for tests. */
  client?: Anthropic;
  env?: NodeJS.ProcessEnv;
  /** Credential store for keys saved from the settings UI (defaults to the OS store). */
  store?: CredentialStore;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/**
 * Calls the Claude API directly with structured outputs. Credentials resolve the
 * SDK's standard way from the environment; keys are never persisted by Featherduster.
 */
export class AnthropicApiRunner implements ModelRunner {
  readonly id = 'anthropic-api' as const;
  readonly label = 'Anthropic API';
  readonly locality = 'cloud' as const;
  readonly model: string;
  private readonly injectedClient?: Anthropic;
  private readonly env: NodeJS.ProcessEnv;
  private readonly store?: CredentialStore;

  constructor(options: AnthropicApiRunnerOptions = {}) {
    this.model = options.model || DEFAULT_ANTHROPIC_MODEL;
    this.injectedClient = options.client;
    this.env = options.env ?? process.env;
    this.store = options.store;
  }

  private credential(): ResolvedCredential | null {
    return resolveAnthropicCredential(this.env, this.store ?? getCredentialStore());
  }

  /** Builds a client from the resolved key without copying it into process.env. */
  private client(): Anthropic {
    if (this.injectedClient) return this.injectedClient;
    const cred = this.credential();
    if (!cred) {
      throw new RunnerError('unavailable', 'No Anthropic API key configured. Add one in Settings.');
    }
    return cred.envVar === 'ANTHROPIC_AUTH_TOKEN'
      ? new Anthropic({ apiKey: null, authToken: cred.key })
      : new Anthropic({ apiKey: cred.key, authToken: null });
  }

  async detect(): Promise<RunnerDetection> {
    if (this.injectedClient) return { available: true, detail: `Injected client (${this.model})` };
    const cred = this.credential();
    if (cred) {
      const where = cred.source === 'env' ? `from ${cred.envVar}` : 'from the OS credential store';
      return { available: true, detail: `API key ${where}, ending ${cred.key.slice(-4)} (${this.model})` };
    }
    return {
      available: false,
      detail: 'No API key. Add one in Settings, or set ANTHROPIC_API_KEY.',
    };
  }

  async run(req: RunnerRequest): Promise<unknown> {
    if (req.signal.aborted) throw abortError();
    const client = this.client();

    req.onProgress({ kind: 'status', text: `Calling ${this.model}…` });
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: req.system,
          messages: [{ role: 'user', content: req.prompt }],
          output_config: { format: { type: 'json_schema', schema: req.schema } },
        },
        { signal: req.signal }
      );
      stream.on('text', (delta) => req.onProgress({ kind: 'token', text: delta }));
      message = await stream.finalMessage();
    } catch (err) {
      if (req.signal.aborted) throw abortError();
      if (err instanceof Anthropic.AuthenticationError) {
        throw new RunnerError('auth', 'Anthropic API rejected the credentials.', err.message);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new RunnerError('rate_limited', 'Anthropic API rate limit reached. Try again shortly.', err.message);
      }
      if (err instanceof Anthropic.APIError) {
        throw new RunnerError('runner_failed', `Anthropic API error ${err.status ?? ''}`.trim(), err.message);
      }
      throw new RunnerError('runner_failed', 'Anthropic API request failed.', err instanceof Error ? err.message : String(err));
    }

    if (message.stop_reason === 'refusal') {
      throw new RunnerError('refused', 'The model declined this request.', message.stop_details?.explanation ?? undefined);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new RunnerError('truncated', 'The model output was truncated (max_tokens).');
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new RunnerError('invalid_output', 'Anthropic API did not return JSON.', text.slice(0, 4000));
    }
  }
}
