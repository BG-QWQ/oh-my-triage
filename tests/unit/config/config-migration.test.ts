import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, saveConfig } from '@/config/config.js';
import {
  CONFIG_FILE_NAME,
  createDefaultConfig,
  getDefaultConfigPath,
  getDefaultDatabasePath,
  getDevCredentialPath,
  getLegacyConfigPath,
  getLegacyDatabasePath,
  getLegacyDevCredentialPath,
  LEGACY_CONFIG_FILE_NAME,
} from '@/config/defaults.js';
import { detectLegacyConfig, migrateLegacyConfig } from '@/config/migration.js';
import { OMTError, ErrorCodes } from '@/core/errors.js';
import type { Config } from '@/config/validation.js';

describe('configuration migration', () => {
  let tempDir: string;
  let appData: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'omt-config-migration-'));
    appData = join(tempDir, 'appdata');
    rmSync(appData, { force: true, recursive: true });
    writeFileSync(join(tempDir, '.keep'), '', 'utf-8');
    vi.stubEnv('APPDATA', appData);
    vi.stubEnv('XDG_CONFIG_HOME', appData);
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await saveConfig(createConfig('cache-clear'), join(tempDir, 'cache-clear.config.json'));
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('loads canonical configuration without migrating legacy artifacts', async () => {
    writeConfig(CONFIG_FILE_NAME, createConfig('canonical'));

    const loaded = await loadConfig();
    const detection = await detectLegacyConfig();

    expect(loaded.filepath).toBe(join(tempDir, CONFIG_FILE_NAME));
    expect(loaded.config.sources[0]?.id).toBe('canonical');
    expect(detection.hasLegacyConfig).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('migrates legacy-only configuration files to canonical locations', async () => {
    const legacyConfig = createConfig('legacy');
    writeTextFile(getLegacyConfigPath(), `${JSON.stringify(legacyConfig, null, 2)}\n`);
    writeTextFile(getLegacyDatabasePath(), 'legacy-db');
    writeTextFile(getLegacyDevCredentialPath(), '{"token":"legacy"}\n');

    const loaded = await loadConfig();

    expect(loaded.filepath).toBe(getDefaultConfigPath());
    expect(loaded.config.sources[0]?.id).toBe('legacy');
    expect(readJsonConfig(getDefaultConfigPath()).sources[0]?.id).toBe('legacy');
    expect(readFileSync(getDefaultDatabasePath(), 'utf-8')).toBe('legacy-db');
    expect(readFileSync(getDevCredentialPath(), 'utf-8')).toBe('{"token":"legacy"}\n');
    expect(existsSync(getLegacyConfigPath())).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Loaded legacy configuration for oh-my-triage'));
  });

  it('keeps canonical configuration when both canonical and legacy files exist', async () => {
    writeTextFile(getDefaultConfigPath(), `${JSON.stringify(createConfig('canonical'), null, 2)}\n`);
    writeTextFile(getDefaultDatabasePath(), 'canonical-db');
    writeTextFile(getLegacyConfigPath(), `${JSON.stringify(createConfig('legacy'), null, 2)}\n`);
    writeTextFile(getLegacyDatabasePath(), 'legacy-db');

    const loaded = await loadConfig();

    expect(loaded.filepath).toBe(getDefaultConfigPath());
    expect(loaded.config.sources[0]?.id).toBe('canonical');
    expect(readJsonConfig(getDefaultConfigPath()).sources[0]?.id).toBe('canonical');
    expect(readFileSync(getDefaultDatabasePath(), 'utf-8')).toBe('canonical-db');
    expect(readFileSync(getLegacyDatabasePath(), 'utf-8')).toBe('legacy-db');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reports canonical missing-config guidance when no configuration exists', async () => {
    await expect(loadConfig()).rejects.toMatchObject({
      code: ErrorCodes.CONFIG_NOT_FOUND,
      message: 'oh-my-triage configuration was not found.',
      nextSteps: ['Run `oh-my-triage init` to create a configuration file.'],
    } satisfies Partial<OMTError>);
  });

  it('copies legacy artifacts only when canonical equivalents are absent', async () => {
    writeTextFile(getDefaultDatabasePath(), 'canonical-db');
    writeTextFile(getLegacyConfigPath(), `${JSON.stringify(createConfig('legacy'), null, 2)}\n`);
    writeTextFile(getLegacyDatabasePath(), 'legacy-db');

    const summary = await migrateLegacyConfig();

    expect(summary.migrated).toEqual(expect.arrayContaining(['configFile']));
    expect(summary.skippedExisting).toEqual(expect.arrayContaining(['database']));
    expect(readJsonConfig(getDefaultConfigPath()).sources[0]?.id).toBe('legacy');
    expect(readFileSync(getDefaultDatabasePath(), 'utf-8')).toBe('canonical-db');
    expect(existsSync(getLegacyConfigPath())).toBe(true);
  });

  it('loads project-local legacy config names through legacy cosmiconfig search places', async () => {
    writeConfig(LEGACY_CONFIG_FILE_NAME, createConfig('project-legacy'));

    const loaded = await loadConfig();

    expect(loaded.config.sources[0]?.id).toBe('project-legacy');
    expect(loaded.filepath).toBe(join(tempDir, LEGACY_CONFIG_FILE_NAME));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Loaded legacy configuration for oh-my-triage'));
  });

  it('rewrites legacy database_path and token_ref prefixes in migrated config', async () => {
    const legacyConfig: Config = {
      ...createConfig('legacy'),
      database_path: getLegacyDatabasePath(),
      sources: [
        { id: 'github', type: 'github', enabled: true, token_ref: 'FINDINGBRIDGE_TOKEN_GITHUB', options: {} },
        { id: 'sonar', type: 'sonarcloud', enabled: true, token_ref: 'OMT_TOKEN_SONAR', options: {} },
      ],
    };
    writeTextFile(getLegacyConfigPath(), `${JSON.stringify(legacyConfig, null, 2)}\n`);

    await migrateLegacyConfig();

    const migrated = readJsonConfig(getDefaultConfigPath());
    expect(migrated.database_path).toBe(getDefaultDatabasePath());
    expect(migrated.sources[0]?.token_ref).toBe('OMT_TOKEN_GITHUB');
    expect(migrated.sources[1]?.token_ref).toBe('OMT_TOKEN_SONAR');
  });

});

function createConfig(id: string): Config {
  return createDefaultConfig({
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    sources: [{ id, type: 'sarif', enabled: true, path: `${id}.sarif`, options: {} }],
  });
}

function writeConfig(fileName: string, config: Config): void {
  writeTextFile(join(process.cwd(), fileName), `${JSON.stringify(config, null, 2)}\n`);
}

function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function readJsonConfig(path: string): Config {
  return JSON.parse(readFileSync(path, 'utf-8')) as Config;
}
