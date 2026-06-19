import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cosmiconfig } from 'cosmiconfig';
import { OMTError, ErrorCodes } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import { redactSecrets } from '../utils/redaction.js';
import {
  CONFIG_FILE_NAME,
  CONFIG_MODULE_NAME,
  createDefaultConfig,
  getDefaultConfigPath,
  getLegacyConfigPath,
  LEGACY_CONFIG_MODULE_NAME,
} from './defaults.js';
import { migrateLegacyConfig } from './migration.js';
import { ConfigSchema, type Config } from './validation.js';

const searchPlaces = [
  'package.json',
  `.${CONFIG_MODULE_NAME}rc`,
  `.${CONFIG_MODULE_NAME}rc.json`,
  `${CONFIG_MODULE_NAME}.config.json`,
  CONFIG_FILE_NAME,
];

const legacySearchPlaces = [
  `.${LEGACY_CONFIG_MODULE_NAME}rc`,
  `.${LEGACY_CONFIG_MODULE_NAME}rc.json`,
  `${LEGACY_CONFIG_MODULE_NAME}.config.json`,
];

const explorer = cosmiconfig(CONFIG_MODULE_NAME, { searchPlaces });
const legacyExplorer = cosmiconfig(LEGACY_CONFIG_MODULE_NAME, { searchPlaces: legacySearchPlaces });

type ConfigSearchResult = NonNullable<Awaited<ReturnType<typeof explorer.load>>>;

export type LoadedConfig = {
  config: Config;
  filepath: string;
};

/**
 * Resolve the effective SQLite database path from CLI flags, environment variables,
 * and configuration. Emits a deprecation warning when the legacy
 * `FINDINGBRIDGE_DB_PATH` environment variable is still in use.
 */
export function resolveDatabasePath(optionsDb?: string, configDb?: string): string | undefined {
  if (optionsDb) {
    return optionsDb;
  }

  if (process.env.OMT_DB_PATH) {
    return process.env.OMT_DB_PATH;
  }

  if (process.env.FINDINGBRIDGE_DB_PATH) {
    process.stderr.write(
      'Warning: FINDINGBRIDGE_DB_PATH is deprecated. Set OMT_DB_PATH for oh-my-triage; the legacy environment variable will be removed in a future release.\n',
    );
    return process.env.FINDINGBRIDGE_DB_PATH;
  }

  return configDb;
}

/** Load and validate oh-my-triage configuration from an explicit path or cosmiconfig search. */
export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  let result: ConfigSearchResult | null | undefined;
  try {
    result = configPath ? await explorer.load(resolve(configPath)) : await searchCanonicalConfig();
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_NOT_FOUND,
        message: 'oh-my-triage configuration was not found.',
        nextSteps: ['Run `oh-my-triage init` to create a configuration file.'],
      });
    }
    throw error;
  }

  if (!result) {
    const legacyResult = await tryLoadLegacyConfig(configPath);
    if (legacyResult) {
      result = legacyResult;
    }
  }

  if (!result) {
    throw new OMTError({
      code: ErrorCodes.CONFIG_NOT_FOUND,
      message: 'oh-my-triage configuration was not found.',
      nextSteps: ['Run `oh-my-triage init` to create a configuration file.'],
    });
  }

  const parsed = ConfigSchema.safeParse(result.config);
  if (!parsed.success) {
    throw new OMTError({
      code: ErrorCodes.CONFIG_INVALID,
      message: 'oh-my-triage configuration is invalid.',
      nextSteps: ['Fix the reported fields or run `oh-my-triage setup --reset` to recreate configuration.'],
      details: { issues: parsed.error.issues },
    });
  }

  return { config: parsed.data, filepath: result.filepath };
}

/**
 * Attempt to load a legacy configuration and migrate it safely.
 *
 * Migration only copies files when canonical targets do not exist, and legacy
 * files are left untouched.
 */
async function tryLoadLegacyConfig(configPath?: string): Promise<ConfigSearchResult | undefined> {
  if (configPath) {
    return undefined;
  }

  let legacyResult: ConfigSearchResult | null;
  try {
    legacyResult = await searchLegacyConfig();
  } catch {
    return undefined;
  }

  if (!legacyResult) {
    return undefined;
  }

  try {
    const migration = await migrateLegacyConfig();
    const migratedItems = migration.migrated.length > 0 ? ` Migrated: ${migration.migrated.join(', ')}.` : '';
    console.warn(`Loaded legacy configuration for oh-my-triage. Old files were left untouched.${migratedItems}`);
  } catch (error: unknown) {
    logger.warn('Legacy configuration migration failed; continuing with legacy config in place.', {
      error: redactSecrets(error instanceof Error ? error.message : String(error)),
    });
    return legacyResult;
  }

  explorer.clearCaches();
  const migratedResult = await searchCanonicalConfig();
  return migratedResult ?? legacyResult;
}

async function searchCanonicalConfig(): Promise<ConfigSearchResult | null> {
  const discovered = await explorer.search();
  return discovered ?? loadOptionalConfig(explorer, getDefaultConfigPath());
}

async function searchLegacyConfig(): Promise<ConfigSearchResult | null> {
  const discovered = await legacyExplorer.search();
  return discovered ?? loadOptionalConfig(legacyExplorer, getLegacyConfigPath());
}

async function loadOptionalConfig(
  configExplorer: typeof explorer,
  configPath: string
): Promise<ConfigSearchResult | null> {
  try {
    return await configExplorer.load(configPath);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return null;
    }
    throw error;
  }
}

/** Save validated oh-my-triage configuration as JSON without overwriting unrelated files. */
export async function saveConfig(config: Config, configPath = getDefaultConfigPath()): Promise<string> {
  const normalizedConfig = ConfigSchema.parse({ ...config, updated_at: new Date().toISOString() });
  const targetPath = resolve(configPath);

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, { encoding: 'utf-8', flag: 'w' });
    explorer.clearCaches();
    legacyExplorer.clearCaches();
    return targetPath;
  } catch (error: unknown) {
    throw new OMTError({
      code: ErrorCodes.CONFIG_WRITE_FAILED,
      message: 'Unable to write oh-my-triage configuration.',
      nextSteps: ['Check directory permissions and retry the command.'],
      details: { config_path: targetPath, error: redactSecrets(String(error)) },
    });
  }
}

/** Create an initial oh-my-triage configuration file. */
export async function initializeConfig(params?: {
  configPath?: string;
  force?: boolean;
  config?: Partial<Config>;
}): Promise<LoadedConfig> {
  const targetPath = resolve(params?.configPath ?? getDefaultConfigPath());

  if (!params?.force) {
    try {
      const existing = await loadConfig(targetPath);
      return existing;
    } catch (error: unknown) {
      if (!(error instanceof OMTError) || error.code !== ErrorCodes.CONFIG_NOT_FOUND) {
        throw error;
      }
    }
  }

  const config = createDefaultConfig(params?.config);
  const filepath = await saveConfig(config, targetPath);
  return { config: ConfigSchema.parse(config), filepath };
}

/** Load configuration when present, otherwise create a default file. */
export async function loadOrCreateConfig(configPath?: string): Promise<LoadedConfig> {
  try {
    return await loadConfig(configPath);
  } catch (error: unknown) {
    if (error instanceof OMTError && error.code === ErrorCodes.CONFIG_NOT_FOUND) {
      return initializeConfig({ configPath });
    }
    throw error;
  }
}

/** Update an existing configuration through a pure transformation callback. */
export async function updateConfig(
  updater: (config: Config) => Config,
  configPath?: string
): Promise<LoadedConfig> {
  const loaded = await loadOrCreateConfig(configPath);
  const nextConfig = updater(loaded.config);
  const filepath = await saveConfig(nextConfig, loaded.filepath);
  return { config: ConfigSchema.parse(nextConfig), filepath };
}
