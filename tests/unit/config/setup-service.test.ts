import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/config/validation.js';

const configState = vi.hoisted(() => ({
  saveCalls: [] as Array<{ config: Config; path?: string }>,
  loadOrCreateResult: {
    config: baseConfig(),
    filepath: 'oh-my-triage.config.json',
  },
}));

vi.mock('@/config/config.js', () => {
  const saveConfig = vi.fn(async (config: Config, path?: string) => {
    configState.saveCalls.push({ config, path });
    return path ?? 'oh-my-triage.config.json';
  });
  return {
    initializeConfig: vi.fn(async (params?: { configPath?: string; config?: Partial<Config> }) => {
      const config = { ...configState.loadOrCreateResult.config, ...(params?.config ?? {}) };
      await saveConfig(config, params?.configPath ?? 'oh-my-triage.config.json');
      return { config, filepath: params?.configPath ?? 'oh-my-triage.config.json' };
    }),
    loadOrCreateConfig: vi.fn(async () => configState.loadOrCreateResult),
    saveConfig,
  };
});

describe('setup-service', () => {
  beforeEach(() => {
    configState.saveCalls = [];
    configState.loadOrCreateResult = { config: baseConfig(), filepath: 'oh-my-triage.config.json' };
  });

  it('runSetupService returns the loaded config without saving', async () => {
    const { runSetupService } = await import('@/config/setup-service.js');

    const result = await runSetupService();

    expect(result.config.config).toEqual(baseConfig());
    expect(configState.saveCalls).toHaveLength(0);
  });

  it('runSetupService with reset creates a fresh config but does not double-save', async () => {
    const { runSetupService } = await import('@/config/setup-service.js');

    const result = await runSetupService({ reset: true });

    expect(result.config.filepath).toBe('oh-my-triage.config.json');
    // initializeConfig internally saves once; runSetupService itself must not
    // call saveConfig again afterward.
    expect(configState.saveCalls).toHaveLength(1);
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
