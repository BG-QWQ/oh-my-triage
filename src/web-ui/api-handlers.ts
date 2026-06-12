import { type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { SonarCloudAdapter } from '../adapters/sonarcloud/sonarcloud-adapter.js';
import { GitHubAdapter } from '../adapters/github/github-adapter.js';
import { SarifAdapter } from '../adapters/sarif/sarif-adapter.js';
import { detectMcpClients } from '../config/mcp-client-detector.js';
import { writeMcpClientConfig } from '../config/mcp-config-writer.js';
import { loadOrCreateConfig, saveConfig } from '../config/config.js';
import { CredentialStore } from '../config/credential-store.js';
import { expandGitHubSetupSources, type GitHubRepositorySelection } from '../config/github-source-expansion.js';
import { TokenStorageSchema, type SourceConfig, type TokenStorage } from '../config/validation.js';
import type { ScannerType } from './setup-api.js';

const GitHubRepositorySelectionSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

const SetupSourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['sarif', 'github', 'sonarcloud']),
  name: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  path: z.string().optional(),
  project_key: z.string().optional(),
  token: z.string().optional(),
  options: z.record(z.string(), z.unknown()).default({}),
});

const SaveSetupRequestSchema = z.object({
  token_storage: TokenStorageSchema,
  sources: z.array(SetupSourceSchema).default([]),
});

type SetupSourceInput = z.infer<typeof SetupSourceSchema>;
type GitHubRepositorySelectionInput = z.infer<typeof GitHubRepositorySelectionSchema>;

type ApiRoute = {
  path: string;
  method: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

class SetupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupValidationError';
  }
}

/** Parse JSON body from incoming request */
async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Send JSON response */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Send error response */
function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Return true when a browser origin is allowed to call the local setup API. */
function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  const host = req.headers.host;
  if (!host) {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    return parsedOrigin.protocol === 'http:' && localHosts.has(parsedOrigin.hostname) && parsedOrigin.host === host;
  } catch {
    return false;
  }
}

/** Apply CORS headers only for trusted setup origins. */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** Return the CLI entrypoint used by generated MCP client configuration. */
function getServerCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [process.argv[1] ?? 'findingbridge', 'server'],
  };
}

/** Format a command for display in the browser without changing execution semantics. */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ');
}

/** Return true when an options object contains a secret-shaped key anywhere inside it. */
function hasSensitiveOptionKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (/token|api[_-]?key|secret|authorization|password|credential/i.test(key)) {
      return true;
    }
    if (hasSensitiveOptionKey(nestedValue)) {
      return true;
    }
  }

  return false;
}

/** Read an allowed string option without preserving arbitrary untrusted keys. */
function readStringOption(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Keep only scanner-specific non-secret options for persisted source config. */
function sanitizeSourceOptions(source: SetupSourceInput): Record<string, unknown> {
  if (hasSensitiveOptionKey(source.options)) {
    throw new SetupValidationError(`Options for ${source.name ?? source.id} include secret-shaped keys. Put scanner tokens in the token field instead.`);
  }

  switch (source.type) {
    case 'github': {
      const owner = readStringOption(source.options, 'owner');
      const repo = readStringOption(source.options, 'repo');
      if (!owner || !repo) {
        throw new SetupValidationError(`GitHub source ${source.name ?? source.id} requires a selected repository owner and name.`);
      }

      return {
        owner,
        repo,
      };
    }
    case 'sonarcloud': {
      return {
        organization: readStringOption(source.options, 'organization'),
      };
    }
    case 'sarif':
    default: {
      return {};
    }
  }
}

/** Handle GET /api/setup/status */
async function handleGetStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const config = await loadOrCreateConfig();
    const mcpClients = await detectMcpClients(config.config.mcp_client_paths);
    
    const configuredScanners: ScannerType[] = [];
    for (const source of config.config.sources) {
      if (source.type === 'sarif' || source.type === 'github' || source.type === 'sonarcloud') {
        configuredScanners.push(source.type as ScannerType);
      }
    }

    sendJson(res, 200, {
      initialized: true,
      configured_scanners: configuredScanners,
      total_findings: 0,
      mcp_clients_detected: mcpClients.filter(c => c.exists).map(c => c.name),
    });
  } catch (err) {
    logger.error('Setup status error', { error: String(err) });
    sendError(res, 500, 'Failed to get setup status');
  }
}

/** Handle POST /api/setup/test-connection */
async function handleTestConnection(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ scanner_type: ScannerType; config: Record<string, unknown> }>(req);
    const { scanner_type, config } = body;

    let result;
    switch (scanner_type) {
      case 'sonarcloud': {
        const token = configString(config, 'token');
        const organization = configString(config, 'organization') || undefined;
        
        if (!token) {
          sendError(res, 400, 'SonarCloud token is required');
          return;
        }
        
        // If no organization provided, try to validate token only
        if (organization) {
          const adapter = new SonarCloudAdapter({ token, organization });
          result = await adapter.testConnection();
        } else {
          const client = new SonarCloudAdapter({ token });
          result = await client.testConnection();
        }
        break;
      }
      case 'github': {
        const adapter = new GitHubAdapter({
          token: configString(config, 'token'),
          owner: firstConfigString(config, 'owner', 'org'),
          repo: configString(config, 'repo'),
        });
        result = await adapter.testConnection();
        break;
      }
      case 'sarif': {
        const adapter = new SarifAdapter({
          filePath: firstConfigString(config, 'file_path', 'path'),
        });
        result = await adapter.testConnection();
        break;
      }
      default:
        sendError(res, 400, `Unknown scanner type: ${scanner_type}`);
        return;
    }

    sendJson(res, 200, result);
  } catch (err) {
    logger.error('Connection test error', { error: String(err) });
    const message = err instanceof Error ? err.message : 'Connection test failed';
    sendError(res, 500, message);
  }
}

function configString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function firstConfigString(config: Record<string, unknown>, firstKey: string, secondKey: string): string {
  return configString(config, firstKey) || configString(config, secondKey);
}

/** Handle POST /api/setup/detect-mcp-clients */
async function handleDetectMcpClients(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const config = await loadOrCreateConfig();
    const clients = await detectMcpClients(config.config.mcp_client_paths);
    
    // Only return clients that actually exist on the system
    const existingClients = clients.filter(c => c.exists);
    
    sendJson(res, 200, {
      clients: existingClients.map(c => ({
        name: c.name,
        config_path: c.configPath,
        exists: c.exists,
      })),
    });
  } catch (err) {
    logger.error('MCP client detection error', { error: String(err) });
    sendError(res, 500, 'Failed to detect MCP clients');
  }
}

/** Handle POST /api/setup/write-config */
async function handleWriteConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ client_name: string; config: Record<string, unknown>; backup?: boolean }>(req);
    const { client_name } = body;

    const loadedConfig = await loadOrCreateConfig();
    const clients = await detectMcpClients(loadedConfig.config.mcp_client_paths);
    const client = clients.find(c => c.name === client_name);

    if (!client) {
      sendError(res, 404, `MCP client '${client_name}' not found`);
      return;
    }

    const result = await writeMcpClientConfig({
      client,
      command: process.execPath,
      args: [process.argv[1] ?? 'findingbridge', 'server'],
    });

    sendJson(res, 200, {
      success: true,
      config_path: result.configPath,
      backup_path: result.backupPath,
      message: 'Configuration written successfully',
    });
  } catch (err) {
    logger.error('Write config error', { error: String(err) });
    sendError(res, 500, 'Failed to write configuration');
  }
}

/** Handle POST /api/setup/save */
async function handleSaveSetup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const parsed = SaveSetupRequestSchema.safeParse(await parseBody<unknown>(req));
    if (!parsed.success) {
      sendJson(res, 400, {
        error: 'Invalid setup payload',
        issues: parsed.error.issues,
      });
      return;
    }

    const loadedConfig = await loadOrCreateConfig();
    const credentialStore = new CredentialStore();
    const warnings: string[] = [];
    const sourceMap = new Map(loadedConfig.config.sources.map((source) => [source.id, source]));
    const sources: SourceConfig[] = [];
    let actualTokenStorage = parsed.data.token_storage;

    for (const source of parsed.data.sources) {
      const existingSource = sourceMap.get(source.id);
      if (source.type === 'github') {
        if (hasSensitiveOptionKey(source.options)) {
          throw new SetupValidationError(`Options for ${source.name ?? source.id} include secret-shaped keys. Put scanner tokens in the token field instead.`);
        }

        const repositories = readGitHubRepositorySelections(source);
        const reusableExistingSource = existingSource ?? findExistingGitHubTokenSource(loadedConfig.config.sources, repositories);
        const resolvedToken = await resolveTokenRef({
          source,
          existingSource: reusableExistingSource,
          tokenStorage: parsed.data.token_storage,
          credentialStore,
          warnings,
        });
        if (resolvedToken.storage) {
          actualTokenStorage = resolvedToken.storage;
        }

        sources.push(...expandGitHubSetupSources({
          baseId: source.id,
          displayName: source.name ?? source.id,
          repositories,
          existingSources: loadedConfig.config.sources,
          tokenRef: resolvedToken.tokenRef,
        }));
        continue;
      }

      const resolvedToken = await resolveTokenRef({
        source,
        existingSource,
        tokenStorage: parsed.data.token_storage,
        credentialStore,
        warnings,
      });
      if (resolvedToken.storage) {
        actualTokenStorage = resolvedToken.storage;
      }

      sources.push({
        id: source.id,
        type: source.type,
        name: source.name,
        enabled: source.enabled,
        path: source.path,
        project_key: source.project_key,
        token_ref: resolvedToken.tokenRef,
        options: sanitizeSourceOptions(source),
      });
    }

    const managedTypes = new Set<ScannerType>(['sarif', 'github', 'sonarcloud']);
    const unmanagedSources = loadedConfig.config.sources.filter((source) => !managedTypes.has(source.type as ScannerType));
    const nextConfig = {
      ...loadedConfig.config,
      token_storage: actualTokenStorage,
      sources: upsertSources([...unmanagedSources, ...loadedConfig.config.sources.filter((source) => managedTypes.has(source.type as ScannerType))], sources),
    };

    const configPath = await saveConfig(nextConfig, loadedConfig.filepath);
    const configuredScanners = [...new Set(sources.map((source) => source.type as ScannerType))];
    sendJson(res, 200, {
      success: true,
      config_path: configPath,
      configured_scanners: configuredScanners,
      warnings,
    });
  } catch (err) {
    logger.error('Save setup error', { error: String(err) });
    const message = err instanceof Error ? err.message : 'Failed to save setup';
    sendError(res, err instanceof SetupValidationError ? 400 : 500, message);
  }
}

function upsertSources(existingSources: SourceConfig[], nextSources: SourceConfig[]): SourceConfig[] {
  const sourcesById = new Map(existingSources.map((source) => [source.id, source]));
  for (const source of nextSources) {
    sourcesById.set(source.id, source);
  }
  return [...sourcesById.values()];
}

function readGitHubRepositorySelections(source: SetupSourceInput): GitHubRepositorySelection[] {
  const repositoriesValue = source.options.repositories;
  if (repositoriesValue !== undefined) {
    const parsed = z.array(GitHubRepositorySelectionSchema).safeParse(repositoriesValue);
    if (!parsed.success) {
      throw new SetupValidationError(`GitHub source ${source.name ?? source.id} has invalid repository selections.`);
    }

    const repositories = parsed.data.map(normalizeRepositorySelection).filter((repository): repository is GitHubRepositorySelection => Boolean(repository));
    if (repositories.length === 0) {
      throw new SetupValidationError(`GitHub source ${source.name ?? source.id} requires at least one selected repository.`);
    }
    return repositories;
  }

  const owner = readStringOption(source.options, 'owner');
  const repo = readStringOption(source.options, 'repo');
  if (!owner || !repo) {
    throw new SetupValidationError(`GitHub source ${source.name ?? source.id} requires a selected repository owner and name.`);
  }
  return [{ owner, repo }];
}

function normalizeRepositorySelection(selection: GitHubRepositorySelectionInput): GitHubRepositorySelection | undefined {
  const repo = selection.repo ?? selection.name;
  if (!selection.owner.trim() || !repo?.trim()) {
    return undefined;
  }
  return { owner: selection.owner.trim(), repo: repo.trim() };
}

function findExistingGitHubTokenSource(sources: SourceConfig[], repositories: GitHubRepositorySelection[]): SourceConfig | undefined {
  for (const repository of repositories) {
    const match = sources.find((source) => {
      if (source.type !== 'github' || !source.token_ref) {
        return false;
      }
      return repositoryMatches(source, repository);
    });
    if (match) {
      return match;
    }
  }
  return sources.find((source) => source.type === 'github' && Boolean(source.token_ref));
}

function repositoryMatches(source: SourceConfig, repository: GitHubRepositorySelection): boolean {
  return readSourceOption(source, 'owner')?.toLowerCase() === repository.owner.toLowerCase()
    && readSourceOption(source, 'repo')?.toLowerCase() === repository.repo.toLowerCase();
}

function readSourceOption(source: SourceConfig, key: string): string | undefined {
  const value = source.options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Resolve a config-safe token reference for one setup source. */
async function resolveTokenRef(params: {
  source: SetupSourceInput;
  existingSource?: SourceConfig;
  tokenStorage: TokenStorage;
  credentialStore: CredentialStore;
  warnings: string[];
}): Promise<{ tokenRef?: string; storage?: TokenStorage }> {
  const { source, existingSource, tokenStorage, credentialStore, warnings } = params;
  if (source.type === 'sarif') {
    return {};
  }

  const trimmedToken = source.token?.trim();
  if (trimmedToken) {
    const result = await credentialStore.setToken(source.id, trimmedToken, tokenStorage);
    if (result.warning) {
      warnings.push(result.warning);
    }
    return { tokenRef: result.tokenRef, storage: result.storage };
  }

  if (existingSource?.token_ref) {
    return { tokenRef: existingSource.token_ref };
  }

  if (tokenStorage === 'env') {
    const tokenRef = credentialStore.envName(source.id);
    warnings.push(`Set ${tokenRef} before running FindingBridge.`);
    return { tokenRef, storage: 'env' };
  }

  throw new SetupValidationError(`Token is required for ${source.name ?? source.id}.`);
}

/** Handle POST /api/setup/start-server */
async function handleStartServer(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const loadedConfig = await loadOrCreateConfig();
    if (!loadedConfig.config.database_path) {
      sendError(res, 400, 'Database path is not configured. Save setup first, then retry.');
      return;
    }

    const { command, args } = getServerCommand();
    sendJson(res, 200, {
      success: true,
      command,
      args,
      cwd: process.cwd(),
      message: `Run ${formatCommand(command, args)} in a terminal, or restart your configured MCP client so it launches FindingBridge over stdio.`,
    });
  } catch (err) {
    logger.error('Start server command error', { error: String(err) });
    sendError(res, 500, 'Failed to prepare server command');
  }
}

/** Handle GET /api/setup/health */
async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  });
}

const SETUP_API_ROUTES: ApiRoute[] = [
  { path: '/api/setup/status', method: 'GET', handler: handleGetStatus },
  { path: '/api/setup/test-connection', method: 'POST', handler: handleTestConnection },
  { path: '/api/setup/detect-mcp-clients', method: 'POST', handler: handleDetectMcpClients },
  { path: '/api/setup/write-config', method: 'POST', handler: handleWriteConfig },
  { path: '/api/setup/save', method: 'POST', handler: handleSaveSetup },
  { path: '/api/setup/start-server', method: 'POST', handler: handleStartServer },
  { path: '/api/setup/health', method: 'GET', handler: handleHealth },
];

/** Find the setup API route matching one normalized request path and method. */
function findApiRoute(url: string, method: string): ApiRoute | undefined {
  return SETUP_API_ROUTES.find((route) => route.path === url && route.method === method);
}

/** Route API requests */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url?.split('?')[0] ?? '';
  const method = req.method ?? 'GET';

  if (!url.startsWith('/api/')) {
    return false;
  }

  setCorsHeaders(req, res);

  if (!isAllowedOrigin(req)) {
    sendError(res, 403, 'Cross-origin setup API requests are not allowed. Open the local FindingBridge setup wizard and retry.');
    return true;
  }

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    const route = findApiRoute(url, method);
    if (route) {
      await route.handler(req, res);
      return true;
    }

    sendError(res, 404, `API endpoint not found: ${method} ${url}`);
    return true;
  } catch (err) {
    logger.error('API request error', { error: String(err), url, method });
    sendError(res, 500, 'Internal server error');
    return true;
  }
}
