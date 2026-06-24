import { resolve } from 'node:path';
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
import { readValidBackup, writeFileAtomically } from './atomic-file.js';

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
  const defaultPath = getDefaultConfigPath();
  const explicitPath = configPath ? resolve(configPath) : undefined;

  try {
    return await tryLoadValidConfig(explicitPath);
  } catch (error: unknown) {
    const isInvalid =
      error instanceof OMTError &&
      (error.code === ErrorCodes.CONFIG_INVALID || error.code === ErrorCodes.CONFIG_NOT_FOUND);
    if (!isInvalid) {
      throw error;
    }

    const restorePath = explicitPath ?? defaultPath;
    const restored = await restoreConfigFromBackup(restorePath);
    if (restored) {
      return restored;
    }

    if (error instanceof OMTError && error.code === ErrorCodes.CONFIG_NOT_FOUND) {
      throw error;
    }

    throw new OMTError({
      code: ErrorCodes.CONFIG_INVALID,
      message: `oh-my-triage configuration at ${restorePath} is invalid and no usable backup was found.`,
      nextSteps: [
        'Restore a valid oh-my-triage.config.json backup manually.',
        'Run `oh-my-triage init --force` to replace the invalid configuration.',
        'Run `oh-my-triage setup --reset` to recreate configuration through the wizard.',
      ],
      details: error instanceof OMTError ? error.details : undefined,
    });
  }
}

/** Attempt to load and validate the config at the given path or by searching upward.
 *
 * When no path is given, cosmiconfig searches from the current working directory
 * and falls back to the platform default config path so project-local and user
 * configs are both discovered.
 */
async function tryLoadValidConfig(targetPath?: string): Promise<LoadedConfig> {
  let result: ConfigSearchResult | null | undefined;
  try {
    result = targetPath
      ? await explorer.load(targetPath)
      : (await explorer.search()) ?? (await loadOptionalConfig(explorer, getDefaultConfigPath()));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_NOT_FOUND,
        message: 'oh-my-triage configuration was not found.',
        nextSteps: ['Run `oh-my-triage init` to create a configuration file.'],
      });
    }

    if (error instanceof Error && error.message.includes('JSON')) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'oh-my-triage configuration contains invalid JSON.',
        nextSteps: [
          'Run `oh-my-triage init --force` to replace the invalid configuration.',
          'Run `oh-my-triage setup --reset` to recreate configuration through the wizard.',
        ],
        details: { error: redactSecrets(error.message) },
      });
    }

    throw error;
  }

  if (!result) {
    const legacyResult = await tryLoadLegacyConfig(targetPath);
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
      nextSteps: [
        'Fix the reported fields or run `oh-my-triage setup --reset` to recreate configuration.',
      ],
      details: { issues: parsed.error.issues },
    });
  }

  return { config: parsed.data, filepath: result.filepath };
}

/** Restore the config file from the newest valid backup and reload it. */
async function restoreConfigFromBackup(targetPath: string): Promise<LoadedConfig | undefined> {
  const backup = await readValidBackup(targetPath);
  if (!backup) {
    return undefined;
  }

  await writeFileAtomically(targetPath, backup.content, { backup: false });
  explorer.clearCaches();
  legacyExplorer.clearCaches();

  const reloaded = await explorer.load(targetPath);
  const parsed = ConfigSchema.safeParse(reloaded?.config);
  if (!parsed.success) {
    return undefined;
  }

  logger.warn('Restored oh-my-triage configuration from backup.', { backup_path: backup.backupPath });
  return { config: parsed.data, filepath: reloaded?.filepath ?? targetPath };
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

/** Save validated oh-my-triage configuration as JSON without overwriting unrelated files.
 *
 * Writes atomically through a same-directory temp file and renames it into place,
 * and creates a timestamped backup of any existing config file first. This prevents
 * truncated configs if the process is killed during the write.
 */
export async function saveConfig(config: Config, configPath = getDefaultConfigPath()): Promise<string> {
  const normalizedConfig = ConfigSchema.parse({ ...config, updated_at: new Date().toISOString() });
  const targetPath = resolve(configPath);

  try {
    await writeFileAtomically(targetPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, {
      backup: true,
    });
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
