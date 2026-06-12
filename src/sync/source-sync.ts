import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterFetchResult, BaseAdapter } from '../adapters/base-adapter.js';
import { GitHubAdapter } from '../adapters/github/github-adapter.js';
import { SarifAdapter } from '../adapters/sarif/sarif-adapter.js';
import { SonarCloudAdapter } from '../adapters/sonarcloud/sonarcloud-adapter.js';
import { SonarCloudClient } from '../adapters/sonarcloud/sonarcloud-client.js';
import type { SonarCloudProject } from '../adapters/sonarcloud/sonarcloud-schemas.js';
import { CredentialStore } from '../config/credential-store.js';
import type { Config, SourceConfig } from '../config/validation.js';
import { FindingBridgeError, ErrorCodes } from '../core/errors.js';
import { Finding, type Finding as FindingModel } from '../core/models/finding.js';
import type { SyncLog } from '../core/models/sync-log.js';
import { FindingRepository } from '../database/repositories/finding-repo.js';
import { SyncRepository } from '../database/repositories/sync-repo.js';
import { redactSecrets } from '../utils/redaction.js';

const DEFAULT_MAX_PAGES = 20;
const execFileAsync = promisify(execFile);

type GitHubRepositoryIdentity = {
  owner: string;
  repo: string;
};

type SonarCloudProjectListClient = Pick<SonarCloudClient, 'listProjects'>;

type SourceSelection = {
  sources: SourceConfig[];
  skipped: SourceSyncResult[];
};

type SonarCloudProjectMatch =
  | { status: 'matched'; project: SonarCloudProject }
  | { status: 'missing' }
  | { status: 'ambiguous'; projects: SonarCloudProject[] };

type SonarCloudProjectListResult = {
  projects: SonarCloudProject[];
  truncated: boolean;
};

/** Status for one configured source synchronization attempt. */
export type SourceSyncStatus = 'success' | 'failed' | 'skipped';

/** Structured result for one configured source synchronization attempt. */
export type SourceSyncResult = {
  source_id: string;
  source_type: SourceConfig['type'];
  status: SourceSyncStatus;
  findings_found: number;
  findings_imported: number;
  findings_stale_marked: number;
  stale_isolation_applied: boolean;
  pages_fetched: number;
  error_message?: string;
  next_steps: string[];
};

/** Aggregate result returned by CLI and MCP sync entrypoints. */
export type SyncSourcesResult = {
  database_path?: string;
  sources_total: number;
  sources_synced: number;
  sources_failed: number;
  sources_skipped: number;
  findings_imported: number;
  results: SourceSyncResult[];
};

/** Options controlling a sync run across configured scanner sources. */
export type SyncSourcesOptions = {
  sourceIds?: string[];
  projectKeys?: Record<string, string>;
  maxPages?: number;
  allSources?: boolean;
};

/** Dependencies for synchronizing configured scanner sources into FindingBridge storage. */
export type SourceSyncServiceOptions = {
  db: Database.Database;
  config: Config;
  databasePath?: string;
  credentialStore?: CredentialStore;
  createAdapter?: (source: SourceConfig, token?: string) => Promise<BaseAdapter>;
  createSonarCloudClient?: (source: SourceConfig, token: string) => SonarCloudProjectListClient;
  detectCurrentGitHubRepository?: () => Promise<GitHubRepositoryIdentity | undefined>;
};

/** Synchronize configured scanner sources into the local FindingBridge database. */
export class SourceSyncService {
  private readonly findings: FindingRepository;
  private readonly syncLogs: SyncRepository;
  private readonly credentialStore: CredentialStore;
  private readonly createAdapter: (source: SourceConfig, token?: string) => Promise<BaseAdapter>;
  private readonly createSonarCloudClient: (source: SourceConfig, token: string) => SonarCloudProjectListClient;
  private readonly detectCurrentGitHubRepository: () => Promise<GitHubRepositoryIdentity | undefined>;

  constructor(private readonly options: SourceSyncServiceOptions) {
    this.findings = new FindingRepository(options.db);
    this.syncLogs = new SyncRepository(options.db);
    this.credentialStore = options.credentialStore ?? new CredentialStore();
    this.createAdapter = options.createAdapter ?? ((source, token) => this.createConfiguredAdapter(source, token));
    this.createSonarCloudClient =
      options.createSonarCloudClient ??
      ((source, token) =>
        new SonarCloudClient({
          token,
          organization: readStringOption(source, 'organization'),
          apiBaseUrl: source.api_url,
        }));
    this.detectCurrentGitHubRepository = options.detectCurrentGitHubRepository ?? detectCurrentGitHubRepository;
  }

  /** Sync enabled configured sources, optionally narrowed to specific source IDs. */
  async syncSources(options: SyncSourcesOptions = {}): Promise<SyncSourcesResult> {
    const selection = await this.selectSources(options);
    const results: SourceSyncResult[] = [];

    for (const source of selection.sources) {
      results.push(await this.syncOneSource(source, options));
    }
    results.push(...selection.skipped);

    return {
      database_path: this.options.databasePath ?? this.options.config.database_path,
      sources_total: selection.sources.length + selection.skipped.length,
      sources_synced: results.filter((result) => result.status === 'success').length,
      sources_failed: results.filter((result) => result.status === 'failed').length,
      sources_skipped: results.filter((result) => result.status === 'skipped').length,
      findings_imported: results.reduce((sum, result) => sum + result.findings_imported, 0),
      results,
    };
  }

  private async selectSources(options: SyncSourcesOptions): Promise<SourceSelection> {
    const enabled = this.options.config.sources.filter((source) => source.enabled);
    const sourceIds = options.sourceIds;
    if (!sourceIds?.length) {
      if (options.allSources) {
        return { sources: enabled, skipped: [] };
      }

      if (enabled.length <= 1 && enabled.every((source) => source.type !== 'sonarcloud' || hasEffectiveProjectKey(source, options.projectKeys))) {
        return { sources: enabled, skipped: [] };
      }

      const currentRepository = await this.detectCurrentGitHubRepository();
      const selection = await this.selectCurrentProjectSources(
        enabled,
        currentRepository,
        options.projectKeys,
        options.maxPages ?? DEFAULT_MAX_PAGES
      );
      if (selection.sources.length > 0 || selection.skipped.length > 0) {
        return selection;
      }

      throw new FindingBridgeError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'Multiple scanner sources are configured, and FindingBridge could not infer any current project sources to synchronize.',
        nextSteps: [
          'Pass source_ids to findingbridge_sync_sources or repeat --source with the source IDs you want to sync.',
          'Pass all_sources: true or use findingbridge sync --all when you intentionally want to synchronize every configured source.',
          'Run sync from a GitHub repository whose origin remote matches one or more configured GitHub sources.',
          'For SonarCloud, save the matching project_key on the source or pass project_keys[source_id] for this sync run.',
          'Select SARIF sources explicitly with source_ids or all_sources because SARIF paths cannot be inferred from the current repository.',
        ],
        retryable: false,
      });
    }

    const requested = new Set(sourceIds);
    return { sources: enabled.filter((source) => requested.has(source.id)), skipped: [] };
  }

  private async selectCurrentProjectSources(
    sources: SourceConfig[],
    repository: GitHubRepositoryIdentity | undefined,
    projectKeys: Record<string, string> | undefined,
    maxPages: number
  ): Promise<SourceSelection> {
    const selected: SourceConfig[] = [];
    const skipped: SourceSyncResult[] = [];

    for (const source of sources) {
      if (source.type === 'github') {
        if (repository !== undefined && matchesGitHubRepository(source, repository)) {
          selected.push(source);
        }
        continue;
      }

      if (source.type !== 'sonarcloud') {
        continue;
      }

      if (hasEffectiveProjectKey(source, projectKeys)) {
        selected.push(source);
        continue;
      }

      const inferred = await this.inferSonarCloudProjectSource(source, repository, maxPages);
      if ('source' in inferred) {
        selected.push(inferred.source);
      } else {
        skipped.push(inferred.skipped);
      }
    }

    return { sources: selected, skipped };
  }

  private async inferSonarCloudProjectSource(
    source: SourceConfig,
    repository: GitHubRepositoryIdentity | undefined,
    maxPages: number
  ): Promise<{ source: SourceConfig } | { skipped: SourceSyncResult }> {
    if (!repository) {
      return {
        skipped: createSkippedSourceResult(source, {
          message: `SonarCloud source ${source.id} needs a current GitHub repository before FindingBridge can infer a project key.`,
          nextSteps: [
            'Run sync from a GitHub repository whose origin remote matches the workspace under review.',
            `Call findingbridge_list_source_projects for ${source.id}, choose the matching key, and pass project_keys[${source.id}] when syncing outside a GitHub repository.`,
          ],
        }),
      };
    }

    const organization = readStringOption(source, 'organization');
    if (!organization) {
      return {
        skipped: createSkippedSourceResult(source, {
          message: `SonarCloud source ${source.id} needs an organization before FindingBridge can infer a project key.`,
          nextSteps: [
            `Configure options.organization for ${source.id} or pass organizations[${source.id}] to findingbridge_list_source_projects.`,
            `Choose the matching project key and pass project_keys[${source.id}] to findingbridge_sync_sources.`,
          ],
        }),
      };
    }

    try {
      const token = await this.tokenForSource(source);
      if (!token) {
        throw new FindingBridgeError({
          code: ErrorCodes.TOKEN_MISSING,
          message: `Token is missing for source ${source.id}.`,
          nextSteps: [`Run findingbridge config set-token ${source.id} or rerun findingbridge setup.`],
          retryable: false,
        });
      }
      const projectList = await listSonarCloudProjects(this.createSonarCloudClient(source, token), maxPages);
      if (projectList.truncated) {
        return {
          skipped: createSkippedSourceResult(source, {
            message: `SonarCloud source ${source.id} project discovery reached max_pages before FindingBridge could prove a unique project match.`,
            nextSteps: [
              'Rerun findingbridge_sync_sources with a higher max_pages value before relying on automatic SonarCloud project inference.',
              `Alternatively call findingbridge_list_source_projects, confirm the intended key, and pass project_keys[${source.id}].`,
            ],
          }),
        };
      }

      const match = findUniqueCurrentRepositoryProject(projectList.projects, repository);
      if (match.status === 'matched') {
        return { source: { ...source, project_key: match.project.key } };
      }

      if (match.status === 'ambiguous') {
        return {
          skipped: createSkippedSourceResult(source, {
            message: `SonarCloud source ${source.id} matched multiple projects for ${repository.owner}/${repository.repo}.`,
            nextSteps: [
              `FindingBridge will not fuzzy auto-sync ambiguous SonarCloud projects: ${formatProjectCandidates(match.projects)}.`,
              `Choose the intended project and pass project_keys[${source.id}] to findingbridge_sync_sources.`,
            ],
          }),
        };
      }

      return {
        skipped: createSkippedSourceResult(source, {
          message: `SonarCloud source ${source.id} had no exact project match for ${repository.owner}/${repository.repo}.`,
          nextSteps: [
            `Call findingbridge_list_source_projects for ${source.id} to inspect visible SonarCloud projects.`,
            `Pass the confirmed key as project_keys[${source.id}] to findingbridge_sync_sources or save it as this source project_key.`,
          ],
        }),
      };
    } catch (error: unknown) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      return {
        skipped: createSkippedSourceResult(source, {
          message,
          nextSteps: this.nextStepsForError(source, error),
        }),
      };
    }
  }

  private async syncOneSource(source: SourceConfig, options: SyncSourcesOptions): Promise<SourceSyncResult> {
    const startedAt = new Date().toISOString();
    const logId = `sync-${source.id}-${randomUUID()}`;
    this.syncLogs.create(this.createInitialLog(logId, source.id, startedAt));

    try {
      const adapterContext = await this.adapterForSource(source, options);
      const syncResult = await this.fetchAndPersist(adapterContext.source, adapterContext.adapter, options, logId);
      this.syncLogs.update(logId, {
        completed_at: new Date().toISOString(),
        status: 'success',
        findings_found: syncResult.findings_found,
        findings_new: syncResult.findings_imported,
        findings_updated: 0,
        findings_stale_marked: syncResult.findings_stale_marked,
        stale_isolation_applied: syncResult.stale_isolation_applied,
      });
      return syncResult;
    } catch (error: unknown) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      this.syncLogs.update(logId, {
        completed_at: new Date().toISOString(),
        status: 'failed',
        error_message: message,
      });
      return {
        source_id: source.id,
        source_type: source.type,
        status: 'failed',
        findings_found: 0,
        findings_imported: 0,
        findings_stale_marked: 0,
        stale_isolation_applied: false,
        pages_fetched: 0,
        error_message: message,
        next_steps: this.nextStepsForError(source, error),
      };
    }
  }

  private async adapterForSource(
    source: SourceConfig,
    options: SyncSourcesOptions
  ): Promise<{ source: SourceConfig; adapter: BaseAdapter }> {
    const token = await this.tokenForSource(source);
    const sourceWithOverrides = applySyncOverrides(source, options);
    return {
      source: sourceWithOverrides,
      adapter: await this.createAdapter(sourceWithOverrides, token),
    };
  }

  private async tokenForSource(source: SourceConfig): Promise<string | undefined> {
    if (source.type === 'github' || source.type === 'sonarcloud') {
      const token = await this.credentialStore.getToken(source.id, this.options.config.token_storage, source.token_ref);
      if (!token) {
        throw new FindingBridgeError({
          code: ErrorCodes.TOKEN_MISSING,
          message: `Token is missing for source ${source.id}.`,
          nextSteps: [`Run findingbridge config set-token ${source.id} or rerun findingbridge setup.`],
          retryable: false,
        });
      }
      return token;
    }

    return undefined;
  }

  private async createConfiguredAdapter(source: SourceConfig, token?: string): Promise<BaseAdapter> {
    switch (source.type) {
      case 'sarif': {
        if (!source.path) {
          throw new FindingBridgeError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `SARIF source ${source.id} has no path configured.`,
            nextSteps: ['Set the SARIF path in setup or use findingbridge ingest --sarif path/to/results.sarif.'],
            retryable: false,
          });
        }
        return new SarifAdapter({ filePath: source.path });
      }
      case 'github': {
        const owner = readStringOption(source, 'owner');
        const repo = readStringOption(source, 'repo');
        if (!token || !owner || !repo) {
          throw new FindingBridgeError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `GitHub source ${source.id} requires token, owner, and repo.`,
            nextSteps: ['Run findingbridge setup and select a GitHub repository, then retry sync.'],
            retryable: false,
          });
        }
        return new GitHubAdapter({ token, owner, repo, apiBaseUrl: source.api_url });
      }
      case 'sonarcloud': {
        if (!token || !source.project_key) {
          throw new FindingBridgeError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `SonarCloud source ${source.id} requires token and project_key.`,
            nextSteps: [
              'Call findingbridge_list_source_projects with organizations[source_id] if the SonarCloud source configuration does not include an organization.',
              'Choose the project that matches the current repository and pass it to findingbridge_sync_sources as project_keys[source_id], or save it as this source project_key before retrying sync.',
            ],
            retryable: false,
          });
        }
        return new SonarCloudAdapter({
          token,
          projectKey: source.project_key,
          organization: readStringOption(source, 'organization'),
          apiBaseUrl: source.api_url,
        });
      }
      default: {
        throw new FindingBridgeError({
          code: ErrorCodes.CONFIG_INVALID,
          message: `Source type ${source.type} is configured but does not have a sync adapter yet.`,
          nextSteps: ['Export the platform results as SARIF and run findingbridge ingest --sarif, or add a scanner adapter.'],
          retryable: false,
        });
      }
    }
  }

  private async fetchAndPersist(
    source: SourceConfig,
    adapter: BaseAdapter,
    options: SyncSourcesOptions,
    syncRunId: string
  ): Promise<SourceSyncResult> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const syncSeenAt = new Date().toISOString();
    const syncScopeKey = buildSyncScopeKey(source);
    const activeFingerprints = new Set<string>();
    let cursor: string | undefined;
    let findingsFound = 0;
    let findingsImported = 0;
    let pagesFetched = 0;
    let fetchComplete = false;

    do {
      const result = await adapter.fetchFindings({ cursor });
      const findings = this.parseFindings(result);
      for (const finding of findings) {
        activeFingerprints.add(finding.fingerprint);
        this.findings.upsert(finding, {
          sourceId: source.id,
          scopeKey: syncScopeKey,
          syncRunId,
          seenAt: syncSeenAt,
          provisional: true,
        });
      }
      findingsFound += findings.length;
      findingsImported += findings.length;
      pagesFetched += 1;
      if (!result.has_more) {
        fetchComplete = true;
        cursor = undefined;
      } else if (result.next_cursor) {
        cursor = result.next_cursor;
      } else {
        cursor = undefined;
      }
    } while (cursor && pagesFetched < maxPages);

    const staleIsolationApplied = fetchComplete;
    const findingsStaleMarked = staleIsolationApplied
      ? this.findings.markStaleForSyncScope({
          sourceId: source.id,
          scopeKey: syncScopeKey,
          activeFingerprints: [...activeFingerprints],
          staleSinceAt: syncSeenAt,
        })
      : 0;
    if (staleIsolationApplied) {
      this.findings.promoteSyncedFingerprints(source.id, syncScopeKey, [...activeFingerprints]);
      this.findings.markCurrentSyncScope(source.id, syncScopeKey);
    }

    return {
      source_id: source.id,
      source_type: source.type,
      status: 'success',
      findings_found: findingsFound,
      findings_imported: findingsImported,
      findings_stale_marked: findingsStaleMarked,
      stale_isolation_applied: staleIsolationApplied,
      pages_fetched: pagesFetched,
      next_steps: fetchComplete
        ? ['Call findingbridge_summary or findingbridge_list_findings to inspect synchronized findings.']
        : ['More pages are available. Rerun sync with a higher max_pages value if you need the full scanner result set.'],
    };
  }

  private parseFindings(result: AdapterFetchResult): FindingModel[] {
    return result.findings.map((finding) => Finding.parse(finding));
  }

  private createInitialLog(id: string, source: string, startedAt: string): SyncLog {
    return {
      id,
      source,
      started_at: startedAt,
      status: 'running',
      findings_found: 0,
      findings_new: 0,
      findings_updated: 0,
      findings_stale_marked: 0,
      stale_isolation_applied: false,
    };
  }

  private nextStepsForError(source: SourceConfig, error: unknown): string[] {
    if (error instanceof FindingBridgeError && error.nextSteps.length) {
      return error.nextSteps.map((step) => redactSecrets(step));
    }

    return [
      `Check the ${source.type} source configuration and credentials.`,
      'Run findingbridge config test before retrying synchronization.',
    ];
  }
}

function hasEffectiveProjectKey(source: SourceConfig, projectKeys?: Record<string, string>): boolean {
  if (source.project_key?.trim()) {
    return true;
  }

  return Boolean(projectKeys?.[source.id]?.trim());
}

function matchesGitHubRepository(source: SourceConfig, repository: GitHubRepositoryIdentity): boolean {
  return readStringOption(source, 'owner')?.toLowerCase() === repository.owner.toLowerCase()
    && readStringOption(source, 'repo')?.toLowerCase() === repository.repo.toLowerCase();
}

async function listSonarCloudProjects(
  client: SonarCloudProjectListClient,
  maxPages: number
): Promise<SonarCloudProjectListResult> {
  const projects: SonarCloudProject[] = [];
  let page = 1;
  let pagesFetched = 0;
  let hasMore = false;

  do {
    const result = await client.listProjects(page);
    projects.push(...result.projects);
    hasMore = result.hasMore;
    page += 1;
    pagesFetched += 1;
  } while (hasMore && pagesFetched < maxPages);

  return { projects, truncated: hasMore };
}

function findUniqueCurrentRepositoryProject(
  projects: SonarCloudProject[],
  repository: GitHubRepositoryIdentity
): SonarCloudProjectMatch {
  const expectedExactValues = expectedProjectIdentityValues(repository);
  const expectedNormalizedValues = new Set([...expectedExactValues].map(normalizeProjectIdentity));
  const matches = projects.filter((project) => {
    const values = [project.key, project.name, project.project].filter(isNonEmptyString);
    return values.some((value) =>
      expectedExactValues.has(value.toLowerCase()) || expectedNormalizedValues.has(normalizeProjectIdentity(value))
    );
  });

  if (matches.length === 1) {
    return { status: 'matched', project: matches[0] };
  }

  if (matches.length > 1) {
    return { status: 'ambiguous', projects: matches };
  }

  return { status: 'missing' };
}

function expectedProjectIdentityValues(repository: GitHubRepositoryIdentity): Set<string> {
  const owner = repository.owner.toLowerCase();
  const repo = repository.repo.toLowerCase();
  return new Set([repo, `${owner}/${repo}`, `${owner}_${repo}`, `${owner}-${repo}`, `${owner}:${repo}`]);
}

function normalizeProjectIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatProjectCandidates(projects: SonarCloudProject[]): string {
  return projects.map((project) => `${redactSecrets(project.key)} (${redactSecrets(project.name)})`).join(', ');
}

function createSkippedSourceResult(
  source: SourceConfig,
  options: { message: string; nextSteps: string[] }
): SourceSyncResult {
  return {
    source_id: source.id,
    source_type: source.type,
    status: 'skipped',
    findings_found: 0,
    findings_imported: 0,
    findings_stale_marked: 0,
    stale_isolation_applied: false,
    pages_fetched: 0,
    error_message: redactSecrets(options.message),
    next_steps: options.nextSteps.map((step) => redactSecrets(step)),
  };
}

async function detectCurrentGitHubRepository(): Promise<GitHubRepositoryIdentity | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url']);
    return parseGitHubRemoteUrl(stdout.trim());
  } catch {
    return undefined;
  }
}

function parseGitHubRemoteUrl(remoteUrl: string): GitHubRepositoryIdentity | undefined {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i.exec(remoteUrl.trim());
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return { owner: match[1], repo: match[2] };
}

function buildSyncScopeKey(source: SourceConfig): string {
  const parts: string[] = [`source:${source.id}`, `type:${source.type}`];
  if (source.api_url) {
    parts.push(`api:${source.api_url}`);
  }
  if (source.project_key) {
    parts.push(`project:${source.project_key}`);
  }
  if (source.path) {
    parts.push(`path:${source.path}`);
  }
  for (const key of ['organization', 'owner', 'repo']) {
    const value = readStringOption(source, key);
    if (value) {
      parts.push(`${key}:${value}`);
    }
  }
  return parts.join('|');
}

function readStringOption(source: SourceConfig, key: string): string | undefined {
  const value = source.options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function applySyncOverrides(source: SourceConfig, options: SyncSourcesOptions): SourceConfig {
  const projectKey = options.projectKeys?.[source.id]?.trim();
  if (source.type !== 'sonarcloud' || !projectKey) {
    return source;
  }

  return {
    ...source,
    project_key: projectKey,
  };
}
