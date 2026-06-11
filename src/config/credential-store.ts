import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { FindingBridgeError, ErrorCodes } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import { redactSecrets } from '../utils/redaction.js';
import { CREDENTIAL_SERVICE_NAME, getDevCredentialPath } from './defaults.js';
import type { TokenStorage } from './validation.js';

const DevCredentialFileSchema = z.record(z.string(), z.string());

type KeytarModule = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

export type CredentialWriteResult = {
  storage: TokenStorage;
  tokenRef: string;
  warning?: string;
};

/** Store scanner credentials using keychain first, environment references second, and local dev file last. */
export class CredentialStore {
  constructor(private readonly devCredentialPath = getDevCredentialPath()) {}

  /** Store a token and return the config-safe token reference. */
  async setToken(sourceId: string, token: string, preferredStorage: TokenStorage = 'keychain'): Promise<CredentialWriteResult> {
    if (preferredStorage === 'env') {
      return { storage: 'env', tokenRef: this.envName(sourceId), warning: 'Set this environment variable before running FindingBridge.' };
    }

    if (preferredStorage === 'keychain') {
      const keytar = await this.loadKeytar();
      if (keytar) {
        await keytar.setPassword(CREDENTIAL_SERVICE_NAME, sourceId, token);
        return { storage: 'keychain', tokenRef: sourceId };
      }
    }

    await this.writeDevToken(sourceId, token);
    return {
      storage: 'encrypted-file',
      tokenRef: sourceId,
      warning: `Keychain unavailable; token stored in development file at ${this.devCredentialPath}. Do not use this for production secrets.`,
    };
  }

  /** Read a token from the configured storage backend. */
  async getToken(sourceId: string, storage: TokenStorage, tokenRef?: string): Promise<string | undefined> {
    const account = tokenRef ?? sourceId;

    if (storage === 'env') {
      return process.env[account];
    }

    if (storage === 'keychain') {
      const keytar = await this.loadKeytar();
      const value = keytar ? await keytar.getPassword(CREDENTIAL_SERVICE_NAME, account) : null;
      return value ?? undefined;
    }

    const credentials = await this.readDevCredentials();
    return credentials[account];
  }

  /** Delete a token from keychain or the local development credential file. */
  async deleteToken(sourceId: string, storage: TokenStorage, tokenRef?: string): Promise<void> {
    const account = tokenRef ?? sourceId;
    if (storage === 'keychain') {
      const keytar = await this.loadKeytar();
      if (keytar) {
        await keytar.deletePassword(CREDENTIAL_SERVICE_NAME, account);
      }
      return;
    }

    if (storage === 'encrypted-file') {
      const credentials = await this.readDevCredentials();
      delete credentials[account];
      await this.writeDevCredentials(credentials);
    }
  }

  /** Return the conventional environment variable name for a source token. */
  envName(sourceId: string): string {
    return `FINDINGBRIDGE_TOKEN_${sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  }

  private async loadKeytar(): Promise<KeytarModule | undefined> {
    try {
      const imported = await import('keytar');
      const keytar = imported.default ?? imported;
      return keytar as KeytarModule;
    } catch (error: unknown) {
      logger.warn('System keychain is unavailable; falling back to development credential storage.', {
        error: redactSecrets(String(error)),
      });
      return undefined;
    }
  }

  private async readDevCredentials(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.devCredentialPath, 'utf-8');
      return DevCredentialFileSchema.parse(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  private async writeDevToken(sourceId: string, token: string): Promise<void> {
    const credentials = await this.readDevCredentials();
    credentials[sourceId] = token;
    await this.writeDevCredentials(credentials);
  }

  private async writeDevCredentials(credentials: Record<string, string>): Promise<void> {
    try {
      await mkdir(dirname(this.devCredentialPath), { recursive: true });
      await writeFile(this.devCredentialPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf-8', flag: 'w', mode: 0o600 });
    } catch (error: unknown) {
      throw new FindingBridgeError({
        code: ErrorCodes.CONFIG_WRITE_FAILED,
        message: 'Unable to write development credential file.',
        nextSteps: ['Check config directory permissions or configure token_storage as env.'],
        details: { error: redactSecrets(String(error)) },
      });
    }
  }
}
