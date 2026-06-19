import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, TokenStorage } from './validation.js';

/** Canonical application name used for directories, configs, and MCP identity. */
export const APP_NAME = 'oh-my-triage';

/** Legacy application name used only for one-time migration of existing user data. */
export const LEGACY_APP_NAME = 'FindingBridge';

/** Cosmiconfig module name for oh-my-triage configuration discovery. */
export const CONFIG_MODULE_NAME = 'oh-my-triage';

/** Legacy Cosmiconfig module name used to detect old configuration files. */
export const LEGACY_CONFIG_MODULE_NAME = 'findingbridge';

/** Default configuration file name for new installations. */
export const CONFIG_FILE_NAME = 'oh-my-triage.config.json';

/** Legacy configuration file name used to detect old installations. */
export const LEGACY_CONFIG_FILE_NAME = 'findingbridge.config.json';

export const DEFAULT_SETUP_HOST = '127.0.0.1';
export const DEFAULT_SETUP_PORT = 3456;

/** Default MCP server key written into client configs. */
export const DEFAULT_MCP_SERVER_NAME = 'oh-my-triage';

/** Legacy MCP server key used to detect old client configs. */
export const LEGACY_MCP_SERVER_NAME = 'findingbridge';

/** Keychain service name for storing scanner tokens. */
export const CREDENTIAL_SERVICE_NAME = 'oh-my-triage';

/** Legacy keychain service name used to migrate existing credentials. */
export const LEGACY_CREDENTIAL_SERVICE_NAME = 'FindingBridge';

/** Resolve the per-user oh-my-triage config directory for the current platform. */
export function getDefaultConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), APP_NAME);
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_NAME);
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_NAME);
}

/** Resolve the legacy per-user FindingBridge config directory for migration detection. */
export function getLegacyConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), LEGACY_APP_NAME);
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', LEGACY_APP_NAME);
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), LEGACY_CONFIG_MODULE_NAME);
}

/** Resolve the default configuration file path used by init and setup. */
export function getDefaultConfigPath(): string {
  return join(getDefaultConfigDir(), CONFIG_FILE_NAME);
}

/** Resolve the legacy configuration file path used for migration detection. */
export function getLegacyConfigPath(): string {
  return join(getLegacyConfigDir(), LEGACY_CONFIG_FILE_NAME);
}

/** Resolve the default SQLite database path for normal CLI/server use. */
export function getDefaultDatabasePath(): string {
  return join(getDefaultConfigDir(), 'oh-my-triage.db');
}

/** Resolve the legacy SQLite database path used for migration detection. */
export function getLegacyDatabasePath(): string {
  return join(getLegacyConfigDir(), 'findingbridge.db');
}

/** Resolve a disposable database path for demo mode. */
export function getDemoDatabasePath(): string {
  return join(tmpdir(), `oh-my-triage-demo-${process.pid}.db`);
}

/** Resolve the development credential fallback path that stores local-only tokens. */
export function getDevCredentialPath(): string {
  return join(getDefaultConfigDir(), 'credentials.dev.json');
}

/** Resolve the legacy development credential fallback path used for migration detection. */
export function getLegacyDevCredentialPath(): string {
  return join(getLegacyConfigDir(), 'credentials.dev.json');
}

/** Create a new default configuration with fresh timestamps. */
export function createDefaultConfig(overrides?: Partial<Config>): Config {
  const now = new Date().toISOString();
  const tokenStorage: TokenStorage = overrides?.token_storage ?? 'keychain';

  return {
    version: '1',
    created_at: overrides?.created_at ?? now,
    updated_at: overrides?.updated_at ?? now,
    token_storage: tokenStorage,
    sources: overrides?.sources ?? [],
    database_path: overrides?.database_path ?? getDefaultDatabasePath(),
    mcp_client_paths: overrides?.mcp_client_paths,
  };
}
