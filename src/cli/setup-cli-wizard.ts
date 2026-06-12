import { confirm, input, password, select } from '@inquirer/prompts';
import { loadOrCreateConfig, saveConfig } from '../config/config.js';
import { CredentialStore } from '../config/credential-store.js';
import { expandGitHubSetupSources, type GitHubRepositorySelection } from '../config/github-source-expansion.js';
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
  let sources = [...currentConfig.sources];
  if (shouldAddSource) {
    const newSources = await promptForSource(tokenStorage, currentConfig.sources);
    sources = upsertSources(sources, newSources);
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

function upsertSources(existingSources: SourceConfig[], nextSources: SourceConfig[]): SourceConfig[] {
  const sourcesById = new Map(existingSources.map((source) => [source.id, source]));
  for (const source of nextSources) {
    sourcesById.set(source.id, source);
  }
  return [...sourcesById.values()];
}

async function promptForSource(tokenStorage: TokenStorage, existingSources: SourceConfig[]): Promise<SourceConfig[]> {
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
  const id = await input({ message: 'Source ID', default: type === 'github' ? 'github-code-scanning' : 'local-sarif' });
  const name = await input({ message: 'Display name', default: id });
  const path = type === 'sarif' ? await input({ message: 'Default SARIF path (optional)', required: false }) : undefined;
  const normalizedPath = path?.trim();
  const options = type === 'sonarcloud' ? await promptForSonarCloudOptions() : {};
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

  if (type === 'github') {
    const repositories = await promptForGitHubRepositories();
    return expandGitHubSetupSources({
      baseId: id,
      displayName: name,
      repositories,
      existingSources,
      tokenRef,
    });
  }

  return [{
    id,
    type,
    name,
    enabled: true,
    path: normalizedPath === '' ? undefined : normalizedPath,
    token_ref: tokenRef,
    options,
  }];
}

async function promptForGitHubRepositories(): Promise<GitHubRepositorySelection[]> {
  const owner = await input({ message: 'GitHub repository owner or organization' });
  const repos = await input({ message: 'GitHub repository name(s), comma-separated. Use owner/repo to override owner.' });
  return parseGitHubRepositoryEntries(owner, repos);
}

async function promptForSonarCloudOptions(): Promise<Record<string, unknown>> {
  const organization = await input({ message: 'SonarCloud organization key' });
  const projectKey = await input({ message: 'SonarCloud project key (optional)', required: false });
  return { organization: organization.trim(), project_key: projectKey.trim() || undefined };
}

function parseGitHubRepositoryEntries(defaultOwner: string, inputValue: string): GitHubRepositorySelection[] {
  const owner = defaultOwner.trim();
  return inputValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const slashIndex = entry.indexOf('/');
      if (slashIndex === -1) {
        return { owner, repo: entry };
      }

      return {
        owner: entry.slice(0, slashIndex).trim(),
        repo: entry.slice(slashIndex + 1).trim(),
      };
    });
}
