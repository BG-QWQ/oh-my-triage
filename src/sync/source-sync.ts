import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AdapterFetchResult, BaseAdapter } from '../adapters/base-adapter.js';
import { GitHubAdapter } from '../adapters/github/github-adapter.js';
import { SarifAdapter } from '../adapters/sarif/sarif-adapter.js';
import { SonarCloudAdapter } from '../adapters/sonarcloud/sonarcloud-adapter.js';
import { CredentialStore } from '../config/credential-store.js';
import type { Config, SourceConfig } from '../config/validation.js';
import { FindingBridgeError, ErrorCodes } from '../core/errors.js';
import { Finding, type Finding as FindingModel } from '../core/models/finding.js';
import type { SyncLog } from '../core/models/sync-log.js';
import { FindingRepository } from '../database/repositories/finding-repo.js';
import { SyncRepository } from '../database/repositories/sync-repo.js';
import { redactSecrets } from '../utils/redaction.js';

const DEFAULT_MAX_PAGES = 20;

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
};

/** Dependencies for synchronizing configured scanner sources into FindingBridge storage. */
export type SourceSyncServiceOptions = {
  db: Database.Database;
  config: Config;
  databasePath?: string;
  credentialStore?: CredentialStore;
  createAdapter?: (source: SourceConfig, token?: string) => Promise<BaseAdapter>;
};

/** Synchronize configured scanner sources into the local FindingBridge database. */
export class SourceSyncService {
  private readonly findings: FindingRepository;
  private readonly syncLogs: SyncRepository;
  private readonly credentialStore: CredentialStore;
  private readonly createAdapter: (source: SourceConfig, token?: string) => Promise<BaseAdapter>;

  constructor(private readonly options: SourceSyncServiceOptions) {
    this.findings = new FindingRepository(options.db);
    this.syncLogs = new SyncRepository(options.db);
    this.credentialStore = options.credentialStore ?? new CredentialStore();
    this.createAdapter = options.createAdapter ?? ((source, token) => this.createConfiguredAdapter(source, token));
  }

  /** Sync enabled configured sources, optionally narrowed to specific source IDs. */
  async syncSources(options: SyncSourcesOptions = {}): Promise<SyncSourcesResult> {
    const selected = this.selectSources(options.sourceIds);
    const results: SourceSyncResult[] = [];

    for (const source of selected) {
      results.push(await this.syncOneSource(source, options));
    }

    return {
      database_path: this.options.databasePath ?? this.options.config.database_path,
      sources_total: selected.length,
      sources_synced: results.filter((result) => result.status === 'success').length,
      sources_failed: results.filter((result) => result.status === 'failed').length,
      sources_skipped: results.filter((result) => result.status === 'skipped').length,
      findings_imported: results.reduce((sum, result) => sum + result.findings_imported, 0),
      results,
    };
  }

  private selectSources(sourceIds?: string[]): SourceConfig[] {
    const enabled = this.options.config.sources.filter((source) => source.enabled);
    if (!sourceIds?.length) {
      return enabled;
    }

    const requested = new Set(sourceIds);
    return enabled.filter((source) => requested.has(source.id));
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
  const projectKey = options.projectKeys?.[source.id];
  if (source.type !== 'sonarcloud' || !projectKey) {
    return source;
  }

  return {
    ...source,
    project_key: projectKey,
  };
}
