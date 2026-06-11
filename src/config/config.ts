import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cosmiconfig } from 'cosmiconfig';
import { FindingBridgeError, ErrorCodes } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';
import { CONFIG_FILE_NAME, CONFIG_MODULE_NAME, createDefaultConfig, getDefaultConfigPath } from './defaults.js';
import { ConfigSchema, type Config } from './validation.js';

const explorer = cosmiconfig(CONFIG_MODULE_NAME, {
  searchPlaces: [
    'package.json',
    `.${CONFIG_MODULE_NAME}rc`,
    `.${CONFIG_MODULE_NAME}rc.json`,
    `${CONFIG_MODULE_NAME}.config.json`,
    CONFIG_FILE_NAME,
  ],
});

export type LoadedConfig = {
  config: Config;
  filepath: string;
};

/** Load and validate FindingBridge configuration from an explicit path or cosmiconfig search. */
export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  let result;
  try {
    result = configPath ? await explorer.load(resolve(configPath)) : await explorer.search();
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new FindingBridgeError({
        code: ErrorCodes.CONFIG_NOT_FOUND,
        message: 'FindingBridge configuration was not found.',
        nextSteps: ['Run `findingbridge init` or `findingbridge setup` to create a configuration file.'],
      });
    }
    throw error;
  }

  if (!result) {
    throw new FindingBridgeError({
      code: ErrorCodes.CONFIG_NOT_FOUND,
      message: 'FindingBridge configuration was not found.',
      nextSteps: ['Run `findingbridge init` or `findingbridge setup` to create a configuration file.'],
    });
  }

  const parsed = ConfigSchema.safeParse(result.config);
  if (!parsed.success) {
    throw new FindingBridgeError({
      code: ErrorCodes.CONFIG_INVALID,
      message: 'FindingBridge configuration is invalid.',
      nextSteps: ['Fix the reported fields or run `findingbridge setup --reset` to recreate configuration.'],
      details: { issues: parsed.error.issues },
    });
  }

  return { config: parsed.data, filepath: result.filepath };
}

/** Save validated FindingBridge configuration as JSON without overwriting unrelated files. */
export async function saveConfig(config: Config, configPath = getDefaultConfigPath()): Promise<string> {
  const normalizedConfig = ConfigSchema.parse({ ...config, updated_at: new Date().toISOString() });
  const targetPath = resolve(configPath);

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, { encoding: 'utf-8', flag: 'w' });
    explorer.clearCaches();
    return targetPath;
  } catch (error: unknown) {
    throw new FindingBridgeError({
      code: ErrorCodes.CONFIG_WRITE_FAILED,
      message: 'Unable to write FindingBridge configuration.',
      nextSteps: ['Check directory permissions and retry the command.'],
      details: { config_path: targetPath, error: redactSecrets(String(error)) },
    });
  }
}

/** Create an initial FindingBridge configuration file. */
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
      if (!(error instanceof FindingBridgeError) || error.code !== ErrorCodes.CONFIG_NOT_FOUND) {
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
    if (error instanceof FindingBridgeError && error.code === ErrorCodes.CONFIG_NOT_FOUND) {
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
