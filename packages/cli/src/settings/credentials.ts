import { createRequire } from 'node:module';

export const KEYRING_SERVICE = 'featherduster';
export const ANTHROPIC_KEY_ACCOUNT = 'anthropic-api-key';

/** Secret storage abstraction. Implementations never log or echo values. */
export interface CredentialStore {
  readonly available: boolean;
  readonly detail: string;
  get(account: string): string | null;
  set(account: string, secret: string): void;
  delete(account: string): void;
}

export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

/** OS credential store (Windows Credential Manager, macOS Keychain, Linux Secret Service). */
export class KeyringCredentialStore implements CredentialStore {
  readonly available = true;
  readonly detail: string;
  private readonly EntryCtor: new (service: string, account: string) => {
    getPassword(): string | null | undefined;
    setPassword(password: string): void;
    deletePassword(): boolean | void;
  };

  constructor(EntryCtor: KeyringCredentialStore['EntryCtor'], detail = 'OS credential store') {
    this.EntryCtor = EntryCtor;
    this.detail = detail;
  }

  get(account: string): string | null {
    try {
      return new this.EntryCtor(KEYRING_SERVICE, account).getPassword() ?? null;
    } catch {
      return null;
    }
  }

  set(account: string, secret: string): void {
    try {
      new this.EntryCtor(KEYRING_SERVICE, account).setPassword(secret);
    } catch (err) {
      throw new CredentialStoreError(`Could not save to the OS credential store: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  delete(account: string): void {
    try {
      new this.EntryCtor(KEYRING_SERVICE, account).deletePassword();
    } catch {
      // Already absent.
    }
  }
}

/** In-memory store for tests. */
export class MemoryCredentialStore implements CredentialStore {
  readonly available = true;
  readonly detail = 'In-memory (test)';
  private readonly values = new Map<string, string>();
  get(account: string): string | null {
    return this.values.get(account) ?? null;
  }
  set(account: string, secret: string): void {
    this.values.set(account, secret);
  }
  delete(account: string): void {
    this.values.delete(account);
  }
}

export class UnavailableCredentialStore implements CredentialStore {
  readonly available = false;
  constructor(readonly detail: string) {}
  get(): string | null {
    return null;
  }
  set(): void {
    throw new CredentialStoreError(`OS credential store unavailable: ${this.detail}`);
  }
  delete(): void {
    // nothing stored
  }
}

let shared: CredentialStore | null = null;

/** Lazily loads the native keyring; falls back to an unavailable store instead of crashing the server. */
export function getCredentialStore(): CredentialStore {
  if (shared) return shared;
  try {
    const require = createRequire(import.meta.url);
    const { Entry } = require('@napi-rs/keyring') as { Entry: KeyringCredentialStore['EntryCtor'] };
    shared = new KeyringCredentialStore(Entry, credentialStoreLabel());
  } catch (err) {
    shared = new UnavailableCredentialStore(err instanceof Error ? err.message : String(err));
  }
  return shared;
}

export function setCredentialStoreForTesting(store: CredentialStore | null): void {
  shared = store;
}

function credentialStoreLabel(): string {
  switch (process.platform) {
    case 'win32':
      return 'Windows Credential Manager';
    case 'darwin':
      return 'macOS Keychain';
    default:
      return 'Secret Service keyring';
  }
}

export type CredentialSource = 'env' | 'keychain';

export interface ResolvedCredential {
  key: string;
  source: CredentialSource;
  /** Which env var supplied it, when source is env. */
  envVar?: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN';
}

/** Environment wins over the keychain so existing setups keep working. */
export function resolveAnthropicCredential(env: NodeJS.ProcessEnv, store: CredentialStore): ResolvedCredential | null {
  if (env.ANTHROPIC_API_KEY) return { key: env.ANTHROPIC_API_KEY, source: 'env', envVar: 'ANTHROPIC_API_KEY' };
  if (env.ANTHROPIC_AUTH_TOKEN) return { key: env.ANTHROPIC_AUTH_TOKEN, source: 'env', envVar: 'ANTHROPIC_AUTH_TOKEN' };
  const stored = store.get(ANTHROPIC_KEY_ACCOUNT);
  return stored ? { key: stored, source: 'keychain' } : null;
}

export interface CredentialSummary {
  configured: boolean;
  source: CredentialSource | null;
  envVar: string | null;
  last4: string | null;
  storeAvailable: boolean;
  storeDetail: string;
  /** A keychain value exists but an env var currently overrides it. */
  shadowedKeychainValue: boolean;
}

export function summarizeAnthropicCredential(env: NodeJS.ProcessEnv, store: CredentialStore): CredentialSummary {
  const resolved = resolveAnthropicCredential(env, store);
  return {
    configured: !!resolved,
    source: resolved?.source ?? null,
    envVar: resolved?.envVar ?? null,
    last4: resolved ? resolved.key.slice(-4) : null,
    storeAvailable: store.available,
    storeDetail: store.detail,
    shadowedKeychainValue: resolved?.source === 'env' && !!store.get(ANTHROPIC_KEY_ACCOUNT),
  };
}

/** Light shape check; the API is the real validator (Test connection). */
export function validateAnthropicKeyShape(key: unknown): string | null {
  if (typeof key !== 'string') return 'API key is required.';
  const trimmed = key.trim();
  if (trimmed.length < 20) return 'That does not look like a complete API key.';
  if (/\s/.test(trimmed)) return 'API keys cannot contain whitespace.';
  return null;
}
