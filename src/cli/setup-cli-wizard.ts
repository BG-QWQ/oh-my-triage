import { confirm, input, password, select } from '@inquirer/prompts';
import { loadOrCreateConfig, saveConfig } from '../config/config.js';
import { CredentialStore } from '../config/credential-store.js';
import { runSetupService, type SetupResult } from '../config/setup-service.js';
import type { SourceConfig, TokenStorage } from '../config/validation.js';

export type CliSetupOptions = {
  configPath?: string;
  add?: boolean;
  reset?: boolean;
};

/** Run the headless setup wizard using interactive terminal prompts. */
export async function runCliSetupWizard(options?: CliSetupOptions): Promise<SetupResult> {
  const loaded = options?.reset
    ? await runSetupService({ configPath: options.configPath, reset: true })
    : { config: await loadOrCreateConfig(options?.configPath), mcpWrites: [] };
  const currentConfig = loaded.config.config;

  const tokenStorage = await select<TokenStorage>({
    message: 'Where should scanner tokens be stored?',
    default: currentConfig.token_storage,
    choices: [
      { name: 'System keychain (recommended)', value: 'keychain' },
      { name: 'Environment variables', value: 'env' },
      { name: 'Development file fallback', value: 'encrypted-file' },
    ],
  });

  const shouldAddSource = options?.add ?? (await confirm({ message: 'Add a scanner source now?', default: currentConfig.sources.length === 0 }));
  const sources = [...currentConfig.sources];
  if (shouldAddSource) {
    const source = await promptForSource(tokenStorage);
    sources.push(source);
  }

  const nextConfig = {
    ...currentConfig,
    token_storage: tokenStorage,
    sources,
  };
  await saveConfig(nextConfig, loaded.config.filepath);
  const writeMcp = await confirm({ message: 'Merge FindingBridge into detected MCP client configs?', default: true });
  const setupResult = writeMcp ? await runSetupService({ configPath: loaded.config.filepath, writeMcp: true }) : { config: { config: nextConfig, filepath: loaded.config.filepath }, mcpWrites: [] };
  return setupResult;
}

async function promptForSource(tokenStorage: TokenStorage): Promise<SourceConfig> {
  const id = await input({ message: 'Source ID', default: 'local-sarif' });
  const type = await select<SourceConfig['type']>({
    message: 'Source type',
    default: 'sarif',
    choices: [
      { name: 'SARIF file', value: 'sarif' },
      { name: 'GitHub Code Scanning', value: 'github' },
      { name: 'SonarCloud', value: 'sonarcloud' },
      { name: 'Socket.dev', value: 'socket' },
    ],
  });
  const name = await input({ message: 'Display name', default: id });
  const path = type === 'sarif' ? await input({ message: 'Default SARIF path (optional)', required: false }) : undefined;
  const normalizedPath = path?.trim();
  const options = await promptForSourceOptions(type);
  let tokenRef: string | undefined;
  if (type !== 'sarif') {
    const token = await password({ message: `Token for ${id}` });
    const credentialStore = new CredentialStore();
    const result = await credentialStore.setToken(id, token, tokenStorage);
    tokenRef = result.tokenRef;
    if (result.warning) {
      console.warn(result.warning);
    }
  }

  return {
    id,
    type,
    name,
    enabled: true,
    path: normalizedPath !== '' ? normalizedPath : undefined,
    token_ref: tokenRef,
    options,
  };
}

async function promptForSourceOptions(type: SourceConfig['type']): Promise<Record<string, unknown>> {
  if (type === 'github') {
    const owner = await input({ message: 'GitHub repository owner or organization' });
    const repo = await input({ message: 'GitHub repository name' });
    return { owner: owner.trim(), repo: repo.trim() };
  }

  if (type === 'sonarcloud') {
    const organization = await input({ message: 'SonarCloud organization key' });
    const projectKey = await input({ message: 'SonarCloud project key (optional)', required: false });
    return { organization: organization.trim(), project_key: projectKey.trim() || undefined };
  }

  return {};
}
