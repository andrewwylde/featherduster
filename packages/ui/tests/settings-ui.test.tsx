/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, apiClient, type SettingsResponse } from '../src/api/client';
import { SettingsView } from '../src/views/settings/SettingsView';
import { App } from '../src/App';

function settings(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    runner: {
      default: 'claude-code',
      step_timeout_seconds: 180,
      'claude-code': { model: '', command: 'claude' },
      'anthropic-api': { model: 'claude-opus-5' },
      ollama: { url: 'http://127.0.0.1:11434', model: '', max_context: 32768 },
    },
    runner_consent: { 'claude-code': '2026-09-16' },
    deslop_warn_band: 'moderate',
    credentials: {
      anthropic: {
        configured: false,
        source: null,
        envVar: null,
        last4: null,
        storeAvailable: true,
        storeDetail: 'Windows Credential Manager',
        shadowedKeychainValue: false,
      },
    },
    ...overrides,
  };
}

const signedIn = {
  installed: true,
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'dev@example.com',
  orgName: 'Dev Org',
  subscriptionType: 'pro',
  detail: 'Logged in',
};

describe('SettingsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(apiClient, 'getClaudeAuth').mockResolvedValue({ status: signedIn, login: null });
    vi.spyOn(apiClient, 'getOllamaModels').mockResolvedValue({ reachable: true, models: ['llama3.1:8b', 'qwen2.5:14b'], detail: 'Ollama at http://127.0.0.1:11434' });
  });
  afterEach(cleanup);

  it('shows Claude Code account status and starts a browser sign-in', async () => {
    const start = vi.spyOn(apiClient, 'startClaudeLogin').mockResolvedValue({
      login: { state: 'running', mode: 'console', startedAt: '', finishedAt: null, output: '', url: 'https://claude.ai/oauth/x' },
    });
    render(<SettingsView />);
    const card = await screen.findByRole('region', { name: 'Claude Code' });
    expect(await within(card).findByText('dev@example.com')).toBeInTheDocument();
    expect(within(card).getByText('Signed in')).toBeInTheDocument();

    vi.mocked(apiClient.getClaudeAuth).mockResolvedValue({
      status: signedIn,
      login: { state: 'running', mode: 'console', startedAt: '', finishedAt: null, output: '', url: 'https://claude.ai/oauth/x' },
    });
    fireEvent.click(within(card).getByRole('button', { name: /Anthropic Console/ }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('console'));
    expect(await within(card).findByText(/Finish signing in in your browser/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Open the sign-in page/ })).toHaveAttribute('href', 'https://claude.ai/oauth/x');
  });

  it('saves an API key without echoing it and clears the field', async () => {
    const save = vi.spyOn(apiClient, 'saveAnthropicKey').mockResolvedValue(
      settings({
        credentials: {
          anthropic: { configured: true, source: 'keychain', envVar: null, last4: 'wxyz', storeAvailable: true, storeDetail: 'Windows Credential Manager', shadowedKeychainValue: false },
        },
      })
    );
    render(<SettingsView />);
    const card = await screen.findByRole('region', { name: 'Anthropic API' });
    const input = within(card).getByLabelText('API key') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'sk-ant-api03-secret-value-wxyz' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('sk-ant-api03-secret-value-wxyz'));
    expect(await within(card).findByText('Key saved.')).toBeInTheDocument();
    expect(within(card).getByText('wxyz')).toBeInTheDocument();
    expect((within(card).getByLabelText('Replace saved API key') as HTMLInputElement).value).toBe('');
    expect(card.textContent).not.toContain('secret-value');
  });

  it('keeps the typed key when saving fails', async () => {
    vi.spyOn(apiClient, 'saveAnthropicKey').mockRejectedValue(new ApiError('Could not save to the OS credential store', 503, 'store_unavailable'));
    render(<SettingsView />);
    const card = await screen.findByRole('region', { name: 'Anthropic API' });
    fireEvent.change(within(card).getByLabelText('API key'), { target: { value: 'sk-ant-api03-secret-value-wxyz' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save key' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Could not save');
    expect((within(card).getByLabelText('API key') as HTMLInputElement).value).toBe('sk-ant-api03-secret-value-wxyz');
  });

  it('explains env-sourced keys and an unavailable credential store', async () => {
    vi.mocked(apiClient.getSettings).mockResolvedValue(
      settings({
        credentials: {
          anthropic: { configured: true, source: 'env', envVar: 'ANTHROPIC_API_KEY', last4: '9f3a', storeAvailable: false, storeDetail: 'no keyring', shadowedKeychainValue: false },
        },
      })
    );
    render(<SettingsView />);
    const card = await screen.findByRole('region', { name: 'Anthropic API' });
    expect(within(card).getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();
    expect(within(card).getByText(/Environment variables take precedence/)).toBeInTheDocument();
    expect(within(card).getByRole('alert')).toHaveTextContent(/credential store is unavailable/);
    expect(within(card).queryByRole('button', { name: 'Save key' })).not.toBeInTheDocument();
  });

  it('saves defaults and Ollama model, and revokes consent', async () => {
    const update = vi.spyOn(apiClient, 'updateRunnerSettings').mockImplementation(async () => settings());
    const revoke = vi.spyOn(apiClient, 'revokeRunnerConsent').mockResolvedValue(settings({ runner_consent: {} }));
    render(<SettingsView />);

    fireEvent.change(await screen.findByLabelText('Default runner'), { target: { value: 'ollama' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ default: 'ollama' }));

    const ollama = screen.getByRole('region', { name: 'Ollama' });
    await within(ollama).findByRole('option', { name: 'llama3.1:8b' });
    fireEvent.change(within(ollama).getByLabelText('Model'), { target: { value: 'llama3.1:8b' } });
    fireEvent.click(within(ollama).getByRole('button', { name: 'Save Ollama settings' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ ollama: { url: 'http://127.0.0.1:11434', model: 'llama3.1:8b', max_context: 32768 } })
    );

    const consent = screen.getByRole('region', { name: 'Cloud consent' });
    fireEvent.click(within(consent).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('claude-code'));
    expect(await within(consent).findByText('No cloud runner has consent yet.')).toBeInTheDocument();
  });

  it('tests a runner connection', async () => {
    vi.spyOn(apiClient, 'testRunner').mockResolvedValue({ available: false, detail: 'No API key. Add one in Settings, or set ANTHROPIC_API_KEY.' });
    render(<SettingsView />);
    const card = await screen.findByRole('region', { name: 'Anthropic API' });
    fireEvent.click(within(card).getByRole('button', { name: 'Test connection' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('No API key');
  });
});

describe('Settings navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: 'C:/ws' });
    vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({ isClean: true, issues: [] });
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([]);
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getTailoringCitations').mockResolvedValue({});
    vi.spyOn(apiClient, 'getRunners').mockResolvedValue({
      runners: [{ id: 'anthropic-api', label: 'Anthropic API', locality: 'cloud', model: 'claude-opus-5', isDefault: true, available: false, detail: 'No API key' }],
      consent: {},
    });
    vi.spyOn(apiClient, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(apiClient, 'getClaudeAuth').mockResolvedValue({ status: signedIn, login: null });
    vi.spyOn(apiClient, 'getOllamaModels').mockResolvedValue({ reachable: false, models: [], detail: 'not running' });
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('links from the Tailor form to Settings', async () => {
    window.history.replaceState({}, '', '/tailor');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'New tailoring run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Configure runners' }));
    expect(window.location.pathname).toBe('/settings');
    expect(await screen.findByRole('heading', { name: 'Model runners' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });
});
