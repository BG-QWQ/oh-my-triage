import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterFetchResult, BaseAdapter } from '../adapters/base-adapter.js';
import { GitHubAdapter } from '../adapters/github/github-adapter.js';
import { SarifAdapter } from '../adapters/sarif/sarif-adapter.js';
import { SocketAdapter } from '../adapters/socket/socket-adapter.js';
import { SnykAdapter } from '../adapters/snyk/snyk-adapter.js';
import { SemgrepAdapter } from '../adapters/semgrep/semgrep-adapter.js';
import { SonarCloudAdapter } from '../adapters/sonarcloud/sonarcloud-adapter.js';
import { SnykClient } from '../adapters/snyk/snyk-client.js';
import { SonarCloudClient } from '../adapters/sonarcloud/sonarcloud-client.js';
import type { SonarCloudProject } from '../adapters/sonarcloud/sonarcloud-schemas.js';
import { CredentialStore } from '../config/credential-store.js';
import type { Config, SourceConfig } from '../config/validation.js';
import { OMTError, ErrorCodes } from '../core/errors.js';
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
type SnykProjectListClient = Pick<SnykClient, 'listProjects'>;

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

/** Dependencies for synchronizing configured scanner sources into oh-my-triage storage. */
export type SourceSyncServiceOptions = {
  db: Database.Database;
  config: Config;
  databasePath?: string;
  credentialStore?: CredentialStore;
  createAdapter?: (source: SourceConfig, token?: string) => Promise<BaseAdapter>;
  createSonarCloudClient?: (source: SourceConfig, token: string) => SonarCloudProjectListClient;
  createSnykClient?: (source: SourceConfig, token: string) => SnykProjectListClient;
  detectCurrentGitHubRepository?: () => Promise<GitHubRepositoryIdentity | undefined>;
};

/** Synchronize configured scanner sources into the local oh-my-triage database. */
export class SourceSyncService {
  private readonly findings: FindingRepository;
  private readonly syncLogs: SyncRepository;
  private readonly credentialStore: CredentialStore;
  private readonly createAdapter: (source: SourceConfig, token?: string) => Promise<BaseAdapter>;
  private readonly createSonarCloudClient: (source: SourceConfig, token: string) => SonarCloudProjectListClient;
  private readonly createSnykClient: (source: SourceConfig, token: string) => SnykProjectListClient;
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
    this.createSnykClient =
      options.createSnykClient ??
      ((source, token) =>
        new SnykClient({
          token,
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

      if (enabled.length <= 1 && enabled.every((source) => canSyncWithoutCurrentRepository(source, options.projectKeys))) {
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

      throw new OMTError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'Multiple scanner sources are configured, and oh-my-triage could not infer any current project sources to synchronize.',
        nextSteps: [
          'Pass source_ids to omt_sync_sources or repeat --source with the source IDs you want to sync.',
          'Pass all_sources: true or use oh-my-triage sync --all when you intentionally want to synchronize every configured source.',
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

      if (source.type === 'sonarcloud') {
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
        continue;
      }

      if (source.type === 'socket') {
        if (repository === undefined) {
          skipped.push(createScopedSourceNeedsRepositorySkip(source));
          continue;
        }

        const orgSlug =
          readStringOption(source, 'organization') ??
          readStringOption(source, 'org_slug') ??
          projectKeys?.[source.id]?.trim();
        if (!orgSlug) {
          skipped.push(
            createSkippedSourceResult(source, {
              message: `Socket.dev source ${source.id} needs an organization before oh-my-triage can scope it to a project.`,
              nextSteps: [
                `Configure options.organization for ${source.id}.`,
                `Call omt_sync_sources with source_ids: ['${source.id}'] or all_sources: true to sync without current-project scoping.`,
              ],
            })
          );
          continue;
        }

        selected.push(scopedSource(source, repository));
        continue;
      }

      if (source.type === 'semgrep') {
        if (repository === undefined) {
          skipped.push(createScopedSourceNeedsRepositorySkip(source));
          continue;
        }

        const deploymentSlug =
          readStringOption(source, 'deployment') ??
          readStringOption(source, 'deployment_slug') ??
          source.project_key ??
          projectKeys?.[source.id]?.trim();
        if (!deploymentSlug) {
          skipped.push(
            createSkippedSourceResult(source, {
              message: `Semgrep source ${source.id} needs a deployment before oh-my-triage can scope it to a project.`,
              nextSteps: [
                `Configure options.deployment or options.deployment_slug for ${source.id}.`,
                `Call omt_sync_sources with source_ids: ['${source.id}'] or all_sources: true to sync without current-project scoping.`,
              ],
            })
          );
          continue;
        }

        selected.push(scopedSource(source, repository));
        continue;
      }

      if (source.type === 'snyk') {
        if (repository === undefined) {
          skipped.push(createScopedSourceNeedsRepositorySkip(source));
          continue;
        }

        const inferred = await this.inferSnykProjectSource(source, repository, maxPages);
        if ('source' in inferred) {
          selected.push(inferred.source);
        } else {
          skipped.push(inferred.skipped);
        }
        continue;
      }

      // SARIF paths cannot be inferred from the current repository, so SARIF
      // sources are skipped unless the caller explicitly requests them.
      skipped.push(createSkippedSourceResult(source, createDefaultScopeSkipReason(source)));
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
          message: `SonarCloud source ${source.id} needs a current GitHub repository before oh-my-triage can infer a project key.`,
          nextSteps: [
            'Run sync from a GitHub repository whose origin remote matches the workspace under review.',
            `Call omt_list_source_projects for ${source.id}, choose the matching key, and pass project_keys[${source.id}] when syncing outside a GitHub repository.`,
          ],
        }),
      };
    }

    const organization = readStringOption(source, 'organization');
    if (!organization) {
      return {
        skipped: createSkippedSourceResult(source, {
          message: `SonarCloud source ${source.id} needs an organization before oh-my-triage can infer a project key.`,
          nextSteps: [
            `Configure options.organization for ${source.id} or pass organizations[${source.id}] to omt_list_source_projects.`,
            `Choose the matching project key and pass project_keys[${source.id}] to omt_sync_sources.`,
          ],
        }),
      };
    }

    try {
      const token = await this.tokenForSource(source);
      if (!token) {
        throw new OMTError({
          code: ErrorCodes.TOKEN_MISSING,
          message: `Token is missing for source ${source.id}.`,
          nextSteps: [`Run oh-my-triage config set-token ${source.id} or rerun oh-my-triage setup.`],
          retryable: false,
        });
      }
      const projectList = await listSonarCloudProjects(this.createSonarCloudClient(source, token), maxPages);
      if (projectList.truncated) {
        return {
          skipped: createSkippedSourceResult(source, {
            message: `SonarCloud source ${source.id} project discovery reached max_pages before oh-my-triage could prove a unique project match.`,
            nextSteps: [
              'Rerun omt_sync_sources with a higher max_pages value before relying on automatic SonarCloud project inference.',
              `Alternatively call omt_list_source_projects, confirm the intended key, and pass project_keys[${source.id}].`,
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
              `oh-my-triage will not fuzzy auto-sync ambiguous SonarCloud projects: ${formatProjectCandidates(match.projects)}.`,
              `Choose the intended project and pass project_keys[${source.id}] to omt_sync_sources.`,
            ],
          }),
        };
      }

      return {
        skipped: createSkippedSourceResult(source, {
          message: `SonarCloud source ${source.id} had no exact project match for ${repository.owner}/${repository.repo}.`,
          nextSteps: [
            `Call omt_list_source_projects for ${source.id} to inspect visible SonarCloud projects.`,
            `Pass the confirmed key as project_keys[${source.id}] to omt_sync_sources or save it as this source project_key.`,
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

  private async inferSnykProjectSource(
    source: SourceConfig,
    repository: GitHubRepositoryIdentity,
    maxPages: number
  ): Promise<{ source: SourceConfig } | { skipped: SourceSyncResult }> {
    const organization = readStringOption(source, 'organization') ?? readStringOption(source, 'org_id');
    if (!organization) {
      return {
        skipped: createSkippedSourceResult(source, {
          message: `Snyk source ${source.id} needs an organization before oh-my-triage can infer project IDs.`,
          nextSteps: [
            `Configure options.organization or options.org_id for ${source.id}.`,
            `Alternatively pass project_ids directly to omt_sync_sources when syncing outside a GitHub repository.`,
          ],
        }),
      };
    }

    try {
      const token = await this.tokenForSource(source);
      if (!token) {
        throw new OMTError({
          code: ErrorCodes.TOKEN_MISSING,
          message: `Token is missing for source ${source.id}.`,
          nextSteps: [`Run oh-my-triage config set-token ${source.id} or rerun oh-my-triage setup.`],
          retryable: false,
        });
      }

      const projectList = await listSnykProjects(organization, this.createSnykClient(source, token), maxPages);
      if (projectList.truncated) {
        return {
          skipped: createSkippedSourceResult(source, {
            message: `Snyk source ${source.id} project discovery reached max_pages before oh-my-triage could prove project matches.`,
            nextSteps: [
              'Rerun omt_sync_sources with a higher max_pages value before relying on automatic Snyk project inference.',
              `Alternatively call omt_list_source_projects, confirm the intended project IDs, and pass them to omt_sync_sources.`,
            ],
          }),
        };
      }

      const projectIds = findSnykProjectIdsForRepository(projectList.projects, repository);
      if (projectIds.length === 0) {
        return {
          skipped: createSkippedSourceResult(source, {
            message: `Snyk source ${source.id} had no project match for ${repository.owner}/${repository.repo}.`,
            nextSteps: [
              `Call omt_list_source_projects for ${source.id} to inspect visible Snyk projects.`,
              `Pass the confirmed project IDs to omt_sync_sources or save them as this source options.project_ids.`,
            ],
          }),
        };
      }

      return {
        source: scopedSource(source, repository, projectIds),
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
    if (['github', 'sonarcloud', 'socket', 'snyk', 'semgrep'].includes(source.type)) {
      const token = await this.credentialStore.getToken(source.id, this.options.config.token_storage, source.token_ref);
      if (!token) {
        throw new OMTError({
          code: ErrorCodes.TOKEN_MISSING,
          message: `Token is missing for source ${source.id}.`,
          nextSteps: [`Run oh-my-triage config set-token ${source.id} or rerun oh-my-triage setup.`],
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
          throw new OMTError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `SARIF source ${source.id} has no path configured.`,
            nextSteps: ['Set the SARIF path in setup or use oh-my-triage ingest --sarif path/to/results.sarif.'],
            retryable: false,
          });
        }
        return new SarifAdapter({ filePath: source.path });
      }
      case 'github': {
        const owner = readStringOption(source, 'owner');
        const repo = readStringOption(source, 'repo');
        if (!token || !owner || !repo) {
          throw new OMTError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `GitHub source ${source.id} requires token, owner, and repo.`,
            nextSteps: ['Run oh-my-triage setup and select a GitHub repository, then retry sync.'],
            retryable: false,
          });
        }
        return new GitHubAdapter({ token, owner, repo, apiBaseUrl: source.api_url });
      }
      case 'sonarcloud': {
        if (!token || !source.project_key) {
          throw new OMTError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `SonarCloud source ${source.id} requires token and project_key.`,
            nextSteps: [
              'Call omt_list_source_projects with organizations[source_id] if the SonarCloud source configuration does not include an organization.',
              'Choose the matching project key and pass it to omt_sync_sources as project_keys[source_id], or save it as this source project_key before retrying sync.',
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
      case 'socket': {
        const orgSlug = readStringOption(source, 'organization') ?? readStringOption(source, 'org_slug');
        if (!token || !orgSlug) {
          throw new OMTError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `Socket.dev source ${source.id} requires token and organization/org_slug.`,
            nextSteps: [
              'Call omt_list_source_projects to list visible Socket.dev organizations.',
              'Save the organization slug in the source options or pass it when syncing.',
            ],
            retryable: false,
          });
        }
        return new SocketAdapter({
          token,
          orgSlug,
          repositoryFullName: readStringOption(source, 'repository_full_name'),
          apiBaseUrl: source.api_url,
        });
      }
      case 'snyk': {
        const orgId = readStringOption(source, 'organization') ?? readStringOption(source, 'org_id');
        if (!token || !orgId) {
          throw new OMTError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `Snyk source ${source.id} requires token and organization/org_id.`,
            nextSteps: [
              'Call omt_list_source_projects to list visible Snyk organizations.',
              'Save the organization ID in the source options or pass it when syncing.',
            ],
            retryable: false,
          });
        }
        return new SnykAdapter({
          token,
          orgId,
          projectIds: readStringArrayOption(source, 'project_ids'),
          apiBaseUrl: source.api_url,
        });
      }
      case 'semgrep': {
        const deploymentSlug =
          readStringOption(source, 'deployment') ??
          readStringOption(source, 'deployment_slug') ??
          source.project_key;
        if (!token || !deploymentSlug) {
          throw new OMTError({
            code: ErrorCodes.CONFIG_INVALID,
            message: `Semgrep source ${source.id} requires token and deployment/deployment_slug/project_key.`,
            nextSteps: [
              'Call omt_list_source_projects to list visible Semgrep deployments.',
              'Save the deployment slug in the source options or pass it when syncing.',
            ],
            retryable: false,
          });
        }
        return new SemgrepAdapter({
          token,
          deploymentSlug,
          repositoryFullName: readStringOption(source, 'repository_full_name'),
          apiBaseUrl: source.api_url,
        });
      }
      default: {
        throw new OMTError({
          code: ErrorCodes.CONFIG_INVALID,
          message: `Source type ${source.type} is configured but does not have a sync adapter yet.`,
          nextSteps: ['Export the platform results as SARIF and run oh-my-triage ingest --sarif, or add a scanner adapter.'],
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
        ? ['Call omt_summary or omt_list_findings to inspect synchronized findings.']
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
    if (error instanceof OMTError && error.nextSteps.length) {
      return error.nextSteps.map((step) => redactSecrets(step));
    }

    return [
      `Check the ${source.type} source configuration and credentials.`,
      'Run oh-my-triage config test before retrying synchronization.',
    ];
  }
}

function hasEffectiveProjectKey(source: SourceConfig, projectKeys?: Record<string, string>): boolean {
  if (source.project_key?.trim()) {
    return true;
  }

  return Boolean(projectKeys?.[source.id]?.trim());
}

/** Determine whether a single enabled source can sync without current-repo inference.
 *
 * GitHub and SARIF carry their own scope (owner/repo or file path). SonarCloud
 * can sync when a project key is already known. Account-scoped sources such as
 * Socket.dev, Snyk, and Semgrep need the current GitHub repository to narrow
 * the sync, so they are never bypassed.
 */
function canSyncWithoutCurrentRepository(source: SourceConfig, projectKeys?: Record<string, string>): boolean {
  if (source.type === 'github' || source.type === 'sarif') {
    return true;
  }

  if (source.type === 'sonarcloud') {
    return hasEffectiveProjectKey(source, projectKeys);
  }

  if (source.type === 'socket' || source.type === 'snyk' || source.type === 'semgrep') {
    return false;
  }

  return true;
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

/** Build a source copy scoped to the current repository for default sync. */
function scopedSource(
  source: SourceConfig,
  repository: GitHubRepositoryIdentity,
  projectIds?: string[]
): SourceConfig {
  const repositoryFullName = `${repository.owner}/${repository.repo}`;
  return {
    ...source,
    options: {
      ...source.options,
      repository_full_name: repositoryFullName,
      ...(projectIds && projectIds.length > 0 ? { project_ids: projectIds } : {}),
    },
  };
}

/** Build a skip result for account-scoped sources that need a current repository. */
function createScopedSourceNeedsRepositorySkip(source: SourceConfig): SourceSyncResult {
  return createSkippedSourceResult(source, {
    message: `${source.type} source ${source.id} needs a current GitHub repository before oh-my-triage can scope it to a project.`,
    nextSteps: [
      'Run sync from a GitHub repository whose origin remote matches the workspace under review.',
      `Call omt_sync_sources with source_ids: ['${source.id}'] or all_sources: true to sync without a current repository.`,
    ],
  });
}

async function listSnykProjects(
  orgId: string,
  client: SnykProjectListClient,
  maxPages: number
): Promise<{ projects: Array<{ id: string; targetUrl?: string }>; truncated: boolean }> {
  const projects: Array<{ id: string; targetUrl?: string }> = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let hasMore = false;

  do {
    const result = await client.listProjects(orgId, { cursor });
    projects.push(...result.projects.map((project) => ({ id: project.id, targetUrl: extractSnykProjectTargetUrl(project) })));
    cursor = result.nextCursor;
    hasMore = cursor !== undefined;
    pagesFetched += 1;
  } while (hasMore && pagesFetched < maxPages);

  return { projects, truncated: hasMore };
}

function extractSnykProjectTargetUrl(project: { id: string; targetUrl?: string } | { relationships?: { target?: { data?: { attributes?: { url?: string } } } } }): string | undefined {
  if ('targetUrl' in project && project.targetUrl) {
    return project.targetUrl;
  }
  const relationships = (project as { relationships?: unknown }).relationships;
  if (relationships && typeof relationships === 'object' && relationships !== null) {
    const target = (relationships as { target?: { data?: { attributes?: { url?: string } } } }).target;
    return target?.data?.attributes?.url;
  }
  return undefined;
}

function findSnykProjectIdsForRepository(
  projects: Array<{ id: string; targetUrl?: string }>,
  repository: GitHubRepositoryIdentity
): string[] {
  const fullName = `${repository.owner}/${repository.repo}`.toLowerCase();
  return projects
    .filter((project) => {
      if (!project.targetUrl) {
        return false;
      }
      const normalized = project.targetUrl.toLowerCase().replace(/\.git$/, '');
      return normalized.includes(fullName) || normalized.endsWith(fullName.split('/')[1] ?? '');
    })
    .map((project) => project.id);
}

/** Build a skip reason for sources that cannot be auto-scoped to the current project. */
function createDefaultScopeSkipReason(source: SourceConfig): { message: string; nextSteps: string[] } {
  const typeLabel = source.type === 'sarif' ? 'SARIF' : source.type;
  const baseMessage = `${typeLabel} source ${source.id} cannot be scoped to the current project, so it is not synced by default.`;

  if (source.type === 'sarif') {
    return {
      message: `${baseMessage} SARIF paths cannot be inferred from the current repository.`,
      nextSteps: [
        `Call omt_sync_sources with source_ids: ['${source.id}'] to sync this SARIF source.`,
        'Call omt_sync_sources with all_sources: true to sync every configured source.',
      ],
    };
  }

  return {
    message: `${baseMessage} Syncing it would pull every organization or deployment the token can access.`,
    nextSteps: [
      `Call omt_sync_sources with source_ids: ['${source.id}'] to sync this source only.`,
      'Call omt_sync_sources with all_sources: true to sync every configured source.',
    ],
  };
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
  const repositoryFullName = readStringOption(source, 'repository_full_name');
  if (repositoryFullName) {
    parts.push(`repo:${repositoryFullName}`);
  }
  const projectIds = source.options.project_ids;
  if (Array.isArray(projectIds) && projectIds.length > 0) {
    parts.push(`project_ids:${projectIds.join(',')}`);
  }
  return parts.join('|');
}

function readStringOption(source: SourceConfig, key: string): string | undefined {
  const value = source.options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArrayOption(source: SourceConfig, key: string): string[] | undefined {
  const value = source.options[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return undefined;
}

function applySyncOverrides(source: SourceConfig, options: SyncSourcesOptions): SourceConfig {
  const projectKey = options.projectKeys?.[source.id]?.trim();
  if (!projectKey) {
    return source;
  }

  switch (source.type) {
    case 'sonarcloud': {
      return { ...source, project_key: projectKey };
    }
    case 'socket': {
      return {
        ...source,
        options: { ...source.options, organization: projectKey },
      };
    }
    case 'snyk': {
      return {
        ...source,
        options: { ...source.options, organization: projectKey },
      };
    }
    case 'semgrep': {
      return {
        ...source,
        project_key: projectKey,
        options: { ...source.options, deployment: projectKey },
      };
    }
    default: {
      return source;
    }
  }
}
