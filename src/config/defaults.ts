import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, TokenStorage } from './validation.js';

export const CONFIG_MODULE_NAME = 'findingbridge';
export const CONFIG_FILE_NAME = 'findingbridge.config.json';
export const DEFAULT_SETUP_HOST = '127.0.0.1';
export const DEFAULT_SETUP_PORT = 3456;
export const DEFAULT_MCP_SERVER_NAME = 'findingbridge';
export const CREDENTIAL_SERVICE_NAME = 'FindingBridge';

/** Resolve the per-user FindingBridge config directory for the current platform. */
export function getDefaultConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'FindingBridge');
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'FindingBridge');
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'findingbridge');
}

/** Resolve the default configuration file path used by init and setup. */
export function getDefaultConfigPath(): string {
  return join(getDefaultConfigDir(), CONFIG_FILE_NAME);
}

/** Resolve the default SQLite database path for normal CLI/server use. */
export function getDefaultDatabasePath(): string {
  return join(getDefaultConfigDir(), 'findingbridge.db');
}

/** Resolve a disposable database path for demo mode. */
export function getDemoDatabasePath(): string {
  return join(tmpdir(), `findingbridge-demo-${process.pid}.db`);
}

/** Resolve the development credential fallback path that stores local-only tokens. */
export function getDevCredentialPath(): string {
  return join(getDefaultConfigDir(), 'credentials.dev.json');
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
