import { SocketClient } from '../adapters/socket/socket-client.js';
import { SnykClient } from '../adapters/snyk/snyk-client.js';
import { SemgrepClient } from '../adapters/semgrep/semgrep-client.js';
import { SonarCloudClient } from '../adapters/sonarcloud/sonarcloud-client.js';
import type { SonarCloudProject } from '../adapters/sonarcloud/sonarcloud-schemas.js';
import { CredentialStore } from '../config/credential-store.js';
import type { Config, SourceConfig } from '../config/validation.js';
import { OMTError, ErrorCodes } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';

const DEFAULT_MAX_PAGES = 10;

const DISCOVERABLE_SOURCE_TYPES = new Set<SourceConfig['type']>(['sonarcloud', 'socket', 'snyk', 'semgrep']);

type SonarCloudProjectListClient = Pick<SonarCloudClient, 'listProjects'>;
type SocketOrganizationListClient = Pick<SocketClient, 'listOrganizations'>;
type SnykOrganizationListClient = Pick<SnykClient, 'listOrganizations'>;
type SemgrepDeploymentListClient = Pick<SemgrepClient, 'listDeployments'>;

/** Redacted scanner project visible to a configured source credential. */
export type DiscoveredProject = {
  key: string;
  name: string;
  qualifier?: string;
  visibility?: string;
  organization?: string;
  last_analysis_date?: string;
};

/** Per-source project discovery result. */
export type SourceProjectDiscoveryResult = {
  source_id: string;
  source_type: SourceConfig['type'];
  status: 'success' | 'failed' | 'skipped';
  projects: DiscoveredProject[];
  total: number;
  pages_fetched: number;
  error_message?: string;
  next_steps: string[];
};

/** Aggregate project discovery result returned by MCP tools and future CLI callers. */
export type DiscoverProjectsResult = {
  sources_total: number;
  sources_succeeded: number;
  sources_failed: number;
  sources_skipped: number;
  results: SourceProjectDiscoveryResult[];
};

/** Options controlling project discovery across configured scanner sources. */
export type DiscoverProjectsOptions = {
  sourceIds?: string[];
  organizations?: Record<string, string>;
  maxPages?: number;
};

/** Dependencies for discovering visible scanner projects. */
export type ProjectDiscoveryServiceOptions = {
  config: Config;
  credentialStore?: CredentialStore;
  createSonarCloudClient?: (source: SourceConfig, token: string) => SonarCloudProjectListClient;
  createSocketClient?: (source: SourceConfig, token: string) => SocketOrganizationListClient;
  createSnykClient?: (source: SourceConfig, token: string) => SnykOrganizationListClient;
  createSemgrepClient?: (source: SourceConfig, token: string) => SemgrepDeploymentListClient;
};

/** Discover projects visible to configured scanner source credentials without modifying local state. */
export class ProjectDiscoveryService {
  private readonly credentialStore: CredentialStore;
  private readonly createSonarCloudClient: (source: SourceConfig, token: string) => SonarCloudProjectListClient;
  private readonly createSocketClient: (source: SourceConfig, token: string) => SocketOrganizationListClient;
  private readonly createSnykClient: (source: SourceConfig, token: string) => SnykOrganizationListClient;
  private readonly createSemgrepClient: (source: SourceConfig, token: string) => SemgrepDeploymentListClient;

  constructor(private readonly options: ProjectDiscoveryServiceOptions) {
    this.credentialStore = options.credentialStore ?? new CredentialStore();
    this.createSonarCloudClient =
      options.createSonarCloudClient ??
      ((source, token) =>
        new SonarCloudClient({
          token,
          organization: readStringOption(source, 'organization'),
          apiBaseUrl: source.api_url,
        }));
    this.createSocketClient =
      options.createSocketClient ??
      ((source, token) =>
        new SocketClient({
          token,
          apiBaseUrl: source.api_url,
        }));
    this.createSnykClient =
      options.createSnykClient ??
      ((source, token) =>
        new SnykClient({
          token,
          apiBaseUrl: source.api_url,
        }));
    this.createSemgrepClient =
      options.createSemgrepClient ??
      ((source, token) =>
        new SemgrepClient({
          token,
          apiBaseUrl: source.api_url,
        }));
  }

  /** Discover visible projects for enabled configured sources, optionally narrowed by source ID. */
  async discoverProjects(options: DiscoverProjectsOptions = {}): Promise<DiscoverProjectsResult> {
    const selected = this.selectSources(options.sourceIds);
    const results: SourceProjectDiscoveryResult[] = [];

    for (const source of selected) {
      results.push(await this.discoverOneSource(source, options));
    }

    return {
      sources_total: selected.length,
      sources_succeeded: results.filter((result) => result.status === 'success').length,
      sources_failed: results.filter((result) => result.status === 'failed').length,
      sources_skipped: results.filter((result) => result.status === 'skipped').length,
      results,
    };
  }

  private selectSources(sourceIds?: string[]): SourceConfig[] {
    const enabled = this.options.config.sources.filter((source) => source.enabled);
    if (!sourceIds?.length) {
      return enabled.filter((source) => DISCOVERABLE_SOURCE_TYPES.has(source.type));
    }

    const requested = new Set(sourceIds);
    return enabled.filter((source) => requested.has(source.id));
  }

  private async discoverOneSource(
    source: SourceConfig,
    options: DiscoverProjectsOptions
  ): Promise<SourceProjectDiscoveryResult> {
    if (!DISCOVERABLE_SOURCE_TYPES.has(source.type)) {
      return {
        source_id: source.id,
        source_type: source.type,
        status: 'skipped',
        projects: [],
        total: 0,
        pages_fetched: 0,
        next_steps: [`Project discovery does not support ${source.type} sources.`],
      };
    }

    try {
      const token = await this.tokenForSource(source);
      const sourceWithOverrides = applyDiscoveryOverrides(source, options);

      switch (source.type) {
        case 'sonarcloud': {
          const organization = readStringOption(sourceWithOverrides, 'organization');
          if (!organization) {
            throw missingOrganizationError(source.id);
          }
          const client = this.createSonarCloudClient(sourceWithOverrides, token);
          return await this.discoverSonarCloudProjects(sourceWithOverrides, client, options.maxPages ?? DEFAULT_MAX_PAGES);
        }
        case 'socket': {
          const client = this.createSocketClient(sourceWithOverrides, token);
          return await this.discoverSocketOrganizations(sourceWithOverrides, client, options.maxPages ?? DEFAULT_MAX_PAGES);
        }
        case 'snyk': {
          const client = this.createSnykClient(sourceWithOverrides, token);
          return await this.discoverSnykOrganizations(sourceWithOverrides, client, options.maxPages ?? DEFAULT_MAX_PAGES);
        }
        case 'semgrep': {
          const client = this.createSemgrepClient(sourceWithOverrides, token);
          return await this.discoverSemgrepDeployments(sourceWithOverrides, client, options.maxPages ?? DEFAULT_MAX_PAGES);
        }
      }

      throw new OMTError({
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: `Project discovery encountered an unexpected source type: ${source.type}.`,
        nextSteps: ['Report this issue with the source configuration that triggered it.'],
        retryable: false,
      });
    } catch (error: unknown) {
      return {
        source_id: source.id,
        source_type: source.type,
        status: 'failed',
        projects: [],
        total: 0,
        pages_fetched: 0,
        error_message: redactSecrets(error instanceof Error ? error.message : String(error)),
        next_steps: this.nextStepsForError(source, error),
      };
    }
  }

  private async tokenForSource(source: SourceConfig): Promise<string> {
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

  private async discoverSonarCloudProjects(
    source: SourceConfig,
    client: SonarCloudProjectListClient,
    maxPages: number
  ): Promise<SourceProjectDiscoveryResult> {
    const projects: DiscoveredProject[] = [];
    let total = 0;
    let page = 1;
    let pagesFetched = 0;
    let hasMore = false;

    do {
      const result = await client.listProjects(page);
      projects.push(...result.projects.map(mapSonarCloudProject));
      total = result.total;
      hasMore = result.hasMore;
      pagesFetched += 1;
      page += 1;
    } while (hasMore && pagesFetched < maxPages);

    return {
      source_id: source.id,
      source_type: source.type,
      status: 'success',
      projects,
      total,
      pages_fetched: pagesFetched,
      next_steps: nextStepsForProjectCount(projects.length, hasMore, 'SonarCloud'),
    };
  }

  private async discoverSocketOrganizations(
    source: SourceConfig,
    client: SocketOrganizationListClient,
    maxPages: number
  ): Promise<SourceProjectDiscoveryResult> {
    const projects: DiscoveredProject[] = [];
    let pagesFetched = 0;
    let cursor: string | undefined;
    let hasMore = false;

    do {
      const result = await client.listOrganizations({ cursor });
      projects.push(
        ...result.organizations.map((organization) => ({
          key: redactSecrets(organization.slug),
          name: redactSecrets(organization.name ?? organization.slug),
          organization: redactSecrets(organization.slug),
        }))
      );
      cursor = undefined;
      hasMore = result.hasMore;
      pagesFetched += 1;
    } while (hasMore && pagesFetched < maxPages);

    return {
      source_id: source.id,
      source_type: source.type,
      status: 'success',
      projects,
      total: projects.length,
      pages_fetched: pagesFetched,
      next_steps: nextStepsForProjectCount(projects.length, hasMore, 'Socket.dev'),
    };
  }

  private async discoverSnykOrganizations(
    source: SourceConfig,
    client: SnykOrganizationListClient,
    maxPages: number
  ): Promise<SourceProjectDiscoveryResult> {
    const projects: DiscoveredProject[] = [];
    let pagesFetched = 0;
    let cursor: string | undefined;
    let hasMore = false;

    do {
      const result = await client.listOrganizations({ cursor });
      projects.push(
        ...result.organizations.map((organization) => ({
          key: redactSecrets(organization.id),
          name: redactSecrets(organization.name ?? organization.id),
          organization: redactSecrets(organization.slug ?? organization.id),
        }))
      );
      cursor = result.nextCursor;
      hasMore = cursor !== undefined;
      pagesFetched += 1;
    } while (hasMore && pagesFetched < maxPages);

    return {
      source_id: source.id,
      source_type: source.type,
      status: 'success',
      projects,
      total: projects.length,
      pages_fetched: pagesFetched,
      next_steps: nextStepsForProjectCount(projects.length, hasMore, 'Snyk'),
    };
  }

  private async discoverSemgrepDeployments(
    source: SourceConfig,
    client: SemgrepDeploymentListClient,
    _maxPages: number
  ): Promise<SourceProjectDiscoveryResult> {
    const result = await client.listDeployments();
    const projects = result.deployments.map((deployment) => ({
      key: redactSecrets(deployment.slug),
      name: redactSecrets(deployment.name ?? deployment.slug),
    }));

    return {
      source_id: source.id,
      source_type: source.type,
      status: 'success',
      projects,
      total: projects.length,
      pages_fetched: 1,
      next_steps: nextStepsForProjectCount(projects.length, result.hasMore, 'Semgrep'),
    };
  }

  private nextStepsForError(source: SourceConfig, error: unknown): string[] {
    if (error instanceof OMTError && error.nextSteps.length) {
      return error.nextSteps.map((step) => redactSecrets(step));
    }

    return [
      `Verify the ${source.type} source token can browse projects.`,
      'Run oh-my-triage config test before retrying project discovery.',
    ];
  }
}

function mapSonarCloudProject(project: SonarCloudProject): DiscoveredProject {
  return {
    key: redactSecrets(project.key),
    name: redactSecrets(project.name),
    qualifier: project.qualifier,
    visibility: project.visibility,
    organization: project.organization,
    last_analysis_date: project.lastAnalysisDate ?? project.analysisDate,
  };
}

function nextStepsForProjectCount(count: number, hasMore: boolean, scannerName: string): string[] {
  if (count === 0) {
    return [`No ${scannerName} projects were visible to this token. Check token permissions and organization settings.`];
  }

  const steps = [
    'Choose every discovered project key that matches the current workspace repository across configured scanner sources before running omt_sync_sources.',
    'Call omt_sync_sources without source_ids and pass project_keys for each matching source that needs a key, so default inference can include every current-project scanner source.',
    'Optionally save each selected key as that source project_key in oh-my-triage configuration for future syncs.',
  ];

  if (hasMore) {
    steps.push('More projects are available. Rerun discovery with a higher max_pages value if needed.');
  }

  return steps;
}

function readStringOption(source: SourceConfig, key: string): string | undefined {
  const value = source.options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function applyDiscoveryOverrides(source: SourceConfig, options: DiscoverProjectsOptions): SourceConfig {
  const organization = options.organizations?.[source.id];
  if (source.type !== 'sonarcloud' || !organization) {
    return source;
  }

  return {
    ...source,
    options: {
      ...source.options,
      organization,
    },
  };
}

function missingOrganizationError(sourceId: string): OMTError {
  return new OMTError({
    code: ErrorCodes.CONFIG_INVALID,
    message: `SonarCloud source ${sourceId} requires organization to list projects.`,
    nextSteps: [
      `Call omt_list_source_projects with organizations: { "${sourceId}": "your-org-key" } to list projects without editing configuration.`,
      'Optionally save the organization in oh-my-triage source configuration for future project discovery.',
    ],
    retryable: false,
  });
}
