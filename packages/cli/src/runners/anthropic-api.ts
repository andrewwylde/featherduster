import Anthropic from '@anthropic-ai/sdk';
import { abortError, RunnerError, type ModelRunner, type RunnerDetection, type RunnerRequest } from './types.js';

export interface AnthropicApiRunnerOptions {
  model?: string;
  /** Injected for tests. */
  client?: Anthropic;
  env?: NodeJS.ProcessEnv;
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

  constructor(options: AnthropicApiRunnerOptions = {}) {
    this.model = options.model || DEFAULT_ANTHROPIC_MODEL;
    this.injectedClient = options.client;
    this.env = options.env ?? process.env;
  }

  async detect(): Promise<RunnerDetection> {
    if (this.injectedClient || this.env.ANTHROPIC_API_KEY || this.env.ANTHROPIC_AUTH_TOKEN) {
      return { available: true, detail: `API credentials found in environment (${this.model})` };
    }
    return {
      available: false,
      detail: 'Set ANTHROPIC_API_KEY in the environment that launches Featherduster.',
    };
  }

  async run(req: RunnerRequest): Promise<unknown> {
    if (req.signal.aborted) throw abortError();
    const client = this.injectedClient ?? new Anthropic();

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
