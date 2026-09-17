export type RunnerId = 'claude-code' | 'codex' | 'anthropic-api' | 'ollama' | 'fake';

export interface RunnerProgressEvent {
  kind: 'status' | 'token';
  text: string;
}

export interface RunnerRequest {
  /** Skill text + gate instructions. */
  system: string;
  /** Gate input (already redacted for cloud runners). */
  prompt: string;
  /** Strict JSON Schema the output must satisfy. */
  schema: Record<string, unknown>;
  signal: AbortSignal;
  onProgress(evt: RunnerProgressEvent): void;
}

export interface RunnerDetection {
  available: boolean;
  detail: string;
}

/**
 * A model backend. Runners never touch the workspace, privacy rules, or gate logic:
 * they send one structured-output request and return the parsed JSON.
 */
export interface ModelRunner {
  readonly id: RunnerId;
  readonly label: string;
  readonly locality: 'local' | 'cloud';
  readonly model: string;
  detect(): Promise<RunnerDetection>;
  run(req: RunnerRequest): Promise<unknown>;
}

/** Error with a user-facing message and a machine-readable code. */
export class RunnerError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
    this.detail = detail;
  }
}

export function abortError(): RunnerError {
  return new RunnerError('aborted', 'The model call was cancelled.');
}
