import { estimateTokens } from '@featherduster/core';
import { abortError, RunnerError, type ModelRunner, type RunnerDetection, type RunnerRequest } from './types.js';

export interface OllamaRunnerOptions {
  url?: string;
  model?: string;
  maxContext?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MAX_CONTEXT = 32768;

/**
 * Local Ollama runner. Sizes `num_ctx` to the prompt (with headroom) so long ledgers
 * are not silently truncated by Ollama's small default context. `prompt_eval_count`
 * is not used as a truncation signal because Ollama's prefix KV-cache legitimately
 * lowers it when gates share the skill-text prefix.
 */
export class OllamaRunner implements ModelRunner {
  readonly id = 'ollama' as const;
  readonly label = 'Ollama';
  readonly locality = 'local' as const;
  readonly model: string;
  private readonly url: string;
  private readonly maxContext: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaRunnerOptions = {}) {
    this.url = (options.url || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    this.model = options.model ?? '';
    this.maxContext = options.maxContext ?? DEFAULT_OLLAMA_MAX_CONTEXT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async detect(): Promise<RunnerDetection> {
    try {
      const res = await this.fetchImpl(`${this.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { available: false, detail: `Ollama responded ${res.status} at ${this.url}` };
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      const names = (body.models ?? []).map((m) => m.name);
      if (!this.model) {
        return { available: false, detail: `Ollama running; set runner.ollama.model in config (installed: ${names.join(', ') || 'none'})` };
      }
      if (!names.some((n) => n === this.model || n.split(':')[0] === this.model)) {
        return { available: false, detail: `Model "${this.model}" is not pulled in Ollama.` };
      }
      return { available: true, detail: `Ollama ${this.model} at ${this.url}` };
    } catch {
      return { available: false, detail: `Ollama is not running at ${this.url}.` };
    }
  }

  async run(req: RunnerRequest): Promise<unknown> {
    if (req.signal.aborted) throw abortError();
    const estTokens = estimateTokens(req.system) + estimateTokens(req.prompt);
    const numCtx = Math.ceil((estTokens * 1.25) / 1024) * 1024;
    if (numCtx > this.maxContext) {
      throw new RunnerError(
        'context_too_large',
        `Input needs ~${estTokens} tokens, above the configured Ollama max_context (${this.maxContext}).`,
        'Raise runner.ollama.max_context (if the model supports it) or use a runner with a larger context window.'
      );
    }

    req.onProgress({ kind: 'status', text: `Calling Ollama ${this.model} (num_ctx ${numCtx})…` });
    let body: any;
    try {
      const res = await this.fetchImpl(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: req.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: req.schema,
          options: { num_ctx: numCtx, temperature: 0 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
        }),
      });
      if (!res.ok) {
        throw new RunnerError('runner_failed', `Ollama responded ${res.status}.`, await res.text());
      }
      body = await res.json();
    } catch (err) {
      if (req.signal.aborted) throw abortError();
      if (err instanceof RunnerError) throw err;
      throw new RunnerError('runner_failed', 'Ollama request failed.', err instanceof Error ? err.message : String(err));
    }

    const text = String(body?.message?.content ?? '');
    try {
      return JSON.parse(text);
    } catch {
      throw new RunnerError('invalid_output', 'Ollama did not return JSON.', text.slice(0, 4000));
    }
  }
}
