import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeConfig, loadConfig, loadOrCreateConfig, saveConfig } from '@/config/config.js';
import { createDefaultConfig } from '@/config/defaults.js';
import { ErrorCodes, OMTError } from '@/core/errors.js';
import type { Config } from '@/config/validation.js';

describe('config persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'omt-config-persistence-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { force: true, recursive: true });
  });

  function configPath(name = 'oh-my-triage.config.json'): string {
    return join(tempDir, name);
  }

  function createConfig(id: string): Config {
    return {
      ...createDefaultConfig(),
      sources: [{ id, type: 'sarif', enabled: true, path: 'example.sarif', options: {} }],
    };
  }

  function writeConfig(path: string, config: Config): void {
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  }

  it('saveConfig creates a timestamped backup of the successfully written config', async () => {
    const targetPath = configPath();
    const firstConfig = createConfig('first');
    writeConfig(targetPath, firstConfig);

    const secondConfig = createConfig('second');
    await saveConfig(secondConfig, targetPath);

    const current = JSON.parse(readFileSync(targetPath, 'utf-8')) as Config;
    expect(current.sources[0]?.id).toBe('second');

    const backups = listBackups(targetPath);
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(readFileSync(backups[0]!, 'utf-8')) as Config;
    expect(backup.sources[0]?.id).toBe('second');
  });

  it('saveConfig writes valid JSON without leftover temp files', async () => {
    const targetPath = configPath();
    await saveConfig(createConfig('only'), targetPath);

    const raw = readFileSync(targetPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as Config;
    expect(parsed.sources[0]?.id).toBe('only');

    const tempFiles = listTempFiles(tempDir);
    expect(tempFiles).toHaveLength(0);
  });

  it('loadConfig restores from the newest valid backup when the target file is empty', async () => {
    const targetPath = configPath();
    const original = createConfig('original');
    writeConfig(targetPath, original);
    await saveConfig(createConfig('saved'), targetPath);
    writeFileSync(targetPath, '', 'utf-8');

    const loaded = await loadConfig(targetPath);

    expect(loaded.config.sources[0]?.id).toBe('saved');
    const restored = JSON.parse(readFileSync(targetPath, 'utf-8')) as Config;
    expect(restored.sources[0]?.id).toBe('saved');
  });

  it('loadConfig restores from the newest valid backup when the target file has invalid JSON', async () => {
    const targetPath = configPath();
    writeConfig(targetPath, createConfig('original'));
    await saveConfig(createConfig('saved'), targetPath);
    writeFileSync(targetPath, '{ not json', 'utf-8');

    const loaded = await loadConfig(targetPath);

    expect(loaded.config.sources[0]?.id).toBe('saved');
  });

  it('loadConfig restores from the newest valid backup when the target config fails Zod validation', async () => {
    const targetPath = configPath();
    writeConfig(targetPath, createConfig('original'));
    await saveConfig(createConfig('saved'), targetPath);
    writeFileSync(targetPath, '{}', 'utf-8');

    const loaded = await loadConfig(targetPath);

    expect(loaded.config.sources[0]?.id).toBe('saved');
  });

  it('loadConfig throws actionable CONFIG_INVALID when no valid backup exists', async () => {
    const targetPath = configPath();
    writeFileSync(targetPath, '{}', 'utf-8');

    await expect(loadConfig(targetPath)).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof OMTError &&
        error.code === ErrorCodes.CONFIG_INVALID &&
        error.message.includes('invalid') &&
        error.nextSteps.some((step) => step.includes('--force') || step.includes('--reset'))
      );
    });
  });

  it('loadOrCreateConfig recovers an invalid config from backup', async () => {
    const targetPath = configPath();
    writeConfig(targetPath, createConfig('original'));
    await saveConfig(createConfig('saved'), targetPath);
    writeFileSync(targetPath, '{}', 'utf-8');

    const loaded = await loadOrCreateConfig(targetPath);
    expect(loaded.config.sources[0]?.id).toBe('saved');
  });

  it('initializeConfig with force backs up the invalid config and creates a default', async () => {
    const targetPath = configPath();
    writeConfig(targetPath, createConfig('original'));
    await saveConfig(createConfig('saved'), targetPath);
    writeFileSync(targetPath, '{}', 'utf-8');

    const initialized = await initializeConfig({ configPath: targetPath, force: true });

    expect(initialized.config.sources).toEqual([]);
    const backups = listBackups(targetPath);
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('initializeConfig without force returns a recovered config instead of failing', async () => {
    const targetPath = configPath();
    writeConfig(targetPath, createConfig('original'));
    await saveConfig(createConfig('saved'), targetPath);
    writeFileSync(targetPath, '{}', 'utf-8');

    const loaded = await initializeConfig({ configPath: targetPath });

    expect(loaded.config.sources[0]?.id).toBe('saved');
  });

  function listBackups(targetPath: string): string[] {
    const dir = tempDir;
    const base = targetPath.replace(/\.config\.json$/, '').replace(/^.*[\\/]/, '');
    return readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.config.json.bak-`))
      .map((name) => join(dir, name));
  }

  function listTempFiles(dir: string): string[] {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.tmp'))
      .map((name) => join(dir, name));
  }
});
