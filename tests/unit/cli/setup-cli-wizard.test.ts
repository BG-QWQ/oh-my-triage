import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/config/validation.js';

const promptState = vi.hoisted(() => ({
  inputs: [] as string[],
  passwords: [] as string[],
  selects: [] as unknown[],
  confirms: [] as boolean[],
}));

const configState = vi.hoisted(() => ({
  savedConfig: undefined as Config | undefined,
  loadedConfig: undefined as Config | undefined,
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(async () => promptState.inputs.shift()),
  password: vi.fn(async () => promptState.passwords.shift()),
  select: vi.fn(async () => promptState.selects.shift()),
  confirm: vi.fn(async () => promptState.confirms.shift()),
}));

vi.mock('@/config/config.js', () => ({
  loadOrCreateConfig: vi.fn(async () => ({
    config: configState.loadedConfig ?? baseConfig(),
    filepath: 'oh-my-triage.config.json',
  })),
  saveConfig: vi.fn(async (config: Config) => {
    configState.savedConfig = config;
    return 'oh-my-triage.config.json';
  }),
}));

vi.mock('@/config/credential-store.js', () => ({
  CredentialStore: class {
    async setToken(): Promise<{ tokenRef: string }> {
      return { tokenRef: 'env:GITHUB_CODE_SCANNING_TOKEN' };
    }
  },
}));

vi.mock('@/config/setup-service.js', () => ({
  runSetupService: vi.fn(async () => ({
    config: {
      config: configState.savedConfig ?? baseConfig(),
      filepath: 'oh-my-triage.config.json',
    },
    mcpWrites: [],
  })),
}));

describe('runCliSetupWizard', () => {
  beforeEach(() => {
    promptState.inputs = ['github-code-scanning', 'GitHub Code Scanning', 'acme', 'api'];
    promptState.passwords = ['token-123'];
    promptState.selects = ['env', 'github'];
    promptState.confirms = [true, false];
    configState.savedConfig = undefined;
    configState.loadedConfig = undefined;
  });

  it('persists GitHub owner and repository options from CLI prompts', async () => {
    const { runCliSetupWizard } = await import('@/cli/setup-cli-wizard.js');

    await runCliSetupWizard({ add: true });

    expect(configState.savedConfig?.sources).toEqual([
      expect.objectContaining({
        id: 'github-code-scanning',
        type: 'github',
        token_ref: 'env:GITHUB_CODE_SCANNING_TOKEN',
        options: {
          owner: 'acme',
          repo: 'api',
        },
      }),
    ]);
  });

  it('persists multiple GitHub repository sources from comma-separated CLI input', async () => {
    promptState.inputs = ['github-code-scanning', 'GitHub Code Scanning', 'acme', 'api, other/web'];
    const { runCliSetupWizard } = await import('@/cli/setup-cli-wizard.js');

    await runCliSetupWizard({ add: true });

    expect(configState.savedConfig?.sources).toEqual([
      expect.objectContaining({
        id: 'github-code-scanning',
        token_ref: 'env:GITHUB_CODE_SCANNING_TOKEN',
        options: { owner: 'acme', repo: 'api' },
      }),
      expect.objectContaining({
        id: 'github-code-scanning-other-web',
        token_ref: 'env:GITHUB_CODE_SCANNING_TOKEN',
        options: { owner: 'other', repo: 'web' },
      }),
    ]);
  });

  it('updates an existing GitHub repository source instead of duplicating its id', async () => {
    configState.loadedConfig = baseConfig([
      {
        id: 'github-code-scanning',
        type: 'github',
        enabled: true,
        token_ref: 'existing-token-ref',
        options: { owner: 'acme', repo: 'api' },
      },
    ]);
    promptState.inputs = ['github-code-scanning', 'GitHub Code Scanning', 'acme', 'api, web'];
    const { runCliSetupWizard } = await import('@/cli/setup-cli-wizard.js');

    await runCliSetupWizard({ add: true });

    expect(configState.savedConfig?.sources.map((source) => source.id)).toEqual(['github-code-scanning', 'github-code-scanning-acme-web']);
    expect(configState.savedConfig?.sources).toEqual([
      expect.objectContaining({
        id: 'github-code-scanning',
        token_ref: 'env:GITHUB_CODE_SCANNING_TOKEN',
        options: { owner: 'acme', repo: 'api' },
      }),
      expect.objectContaining({
        id: 'github-code-scanning-acme-web',
        token_ref: 'env:GITHUB_CODE_SCANNING_TOKEN',
        options: { owner: 'acme', repo: 'web' },
      }),
    ]);
  });
});

function baseConfig(sources: Config['sources'] = []): Config {
  return {
    version: '1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    token_storage: 'keychain',
    sources,
  };
}
