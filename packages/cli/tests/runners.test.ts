import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeRunner, buildClaudeArgs } from '../src/runners/claude-code.js';
import { OllamaRunner } from '../src/runners/ollama.js';
import { AnthropicApiRunner } from '../src/runners/anthropic-api.js';
import { FakeRunner } from '../src/runners/fake.js';
import { RunnerError, type RunnerRequest } from '../src/runners/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = path.join(here, 'fixtures', 'fake-claude.mjs');
const schema = { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false };

function request(overrides: Partial<RunnerRequest> = {}): RunnerRequest & { events: Array<{ kind: string; text: string }> } {
  const events: Array<{ kind: string; text: string }> = [];
  return {
    system: 'SYSTEM PROMPT',
    prompt: 'USER PROMPT',
    schema,
    signal: new AbortController().signal,
    onProgress: (e) => events.push(e),
    events,
    ...overrides,
  };
}

function fakeRunner() {
  return new ClaudeCodeRunner({ command: process.execPath, prefixArgs: [fakeClaude] });
}

describe('ClaudeCodeRunner', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('builds isolated, tool-less argv without --bare or --add-dir', () => {
    const args = buildClaudeArgs({ schema, systemPromptFile: '/tmp/s.md', model: 'sonnet' });
    expect(args).toEqual(expect.arrayContaining(['-p', '--json-schema', '--tools', '--system-prompt-file', '--setting-sources', '--strict-mcp-config', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--add-dir');
    expect(args.slice(-2)).toEqual(['--model', 'sonnet']);
  });

  it('detects the CLI version', async () => {
    const detection = await fakeRunner().detect();
    expect(detection).toEqual({ available: true, detail: '9.9.9 (Claude Code)' });
  });

  it('reports unavailable when the binary is missing', async () => {
    const detection = await new ClaudeCodeRunner({ command: 'definitely-not-claude-xyz' }).detect();
    expect(detection.available).toBe(false);
  });

  it('pipes prompt on stdin, passes system via file in an empty temp cwd, and returns structured_output', async () => {
    const recordFile = path.join(os.tmpdir(), `fd-claude-record-${Date.now()}.json`);
    process.env.FAKE_CLAUDE_RECORD = recordFile;
    const req = request({ prompt: 'x'.repeat(50_000) });
    const out = await fakeRunner().run(req);
    expect(out).toEqual({ word: 'PINEAPPLE' });

    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    expect(record.stdin).toHaveLength(50_000);
    expect(record.system).toBe('SYSTEM PROMPT');
    expect(record.cwdEntries).toEqual([]);
    expect(JSON.parse(record.args[record.args.indexOf('--json-schema') + 1])).toEqual(schema);
    expect(fs.existsSync(path.dirname(record.args[record.args.indexOf('--system-prompt-file') + 1]))).toBe(false);
    expect(req.events.some((e) => e.kind === 'status')).toBe(true);
    expect(req.events.some((e) => e.kind === 'token' && e.text === 'thinking out loud')).toBe(true);
    fs.rmSync(recordFile, { force: true });
  });

  it('falls back to parsing result text when structured_output is absent', async () => {
    process.env.FAKE_CLAUDE_MODE = 'text-json';
    expect(await fakeRunner().run(request())).toEqual({ word: 'fallback' });
  });

  it('maps login failures to an auth error', async () => {
    process.env.FAKE_CLAUDE_MODE = 'auth';
    await expect(fakeRunner().run(request())).rejects.toMatchObject({ code: 'auth' });
  });

  it('kills the process on abort', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang';
    const controller = new AbortController();
    const promise = fakeRunner().run(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 300);
    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('OllamaRunner', () => {
  it('sizes num_ctx to the prompt and parses message content', async () => {
    let sentBody: any;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }));
      }
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ message: { content: '{"word":"local"}' }, prompt_eval_count: 10 }));
    }) as typeof fetch;
    const runner = new OllamaRunner({ model: 'llama3.1', fetchImpl });
    expect((await runner.detect()).available).toBe(true);
    const out = await runner.run(request({ prompt: 'y'.repeat(40_000) }));
    expect(out).toEqual({ word: 'local' });
    expect(sentBody.options.num_ctx).toBeGreaterThanOrEqual(12_500);
    expect(sentBody.format).toEqual(schema);
  });

  it('refuses prompts larger than max_context before calling', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch;
    const runner = new OllamaRunner({ model: 'm', maxContext: 4096, fetchImpl });
    await expect(runner.run(request({ prompt: 'z'.repeat(40_000) }))).rejects.toMatchObject({ code: 'context_too_large' });
    expect(called).toBe(false);
  });

  it('reports not running when the server is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect((await new OllamaRunner({ model: 'm', fetchImpl }).detect()).available).toBe(false);
  });
});

describe('AnthropicApiRunner', () => {
  it('is unavailable without credentials and defaults to claude-opus-5', async () => {
    const runner = new AnthropicApiRunner({ env: {} });
    expect(runner.model).toBe('claude-opus-5');
    expect((await runner.detect()).available).toBe(false);
    expect((await new AnthropicApiRunner({ env: { ANTHROPIC_API_KEY: 'x' } }).detect()).available).toBe(true);
  });
});

describe('FakeRunner', () => {
  it('returns scripted responses in order, then the fallback', async () => {
    const runner = new FakeRunner([{ a: 1 }, () => ({ b: 2 })], { fallback: { c: 3 } });
    expect(await runner.run(request())).toEqual({ a: 1 });
    expect(await runner.run(request())).toEqual({ b: 2 });
    expect(await runner.run(request())).toEqual({ c: 3 });
  });

  it('throws when nothing is scripted', async () => {
    await expect(new FakeRunner().run(request())).rejects.toBeInstanceOf(RunnerError);
  });
});
