import { ErrorCodes, OMTError } from '../../core/errors.js';
import { toAdapterError } from '../adapter-errors.js';
import { fetchAdapterResponse } from '../adapter-http.js';
import {
  SonarCloudAuthValidationSchema,
  SonarCloudIssueSearchSchema,
  SonarCloudProjectSearchSchema,
  type SonarCloudIssueSearch,
  type SonarCloudProject,
} from './sonarcloud-schemas.js';

const SONARCLOUD_API_BASE = 'https://sonarcloud.io';
const PAGE_SIZE = 100;

/** Configuration for SonarCloud Web API access. */
export type SonarCloudClientOptions = {
  token: string;
  organization?: string;
  projectKey?: string;
  apiBaseUrl?: string;
};

/** SonarCloud client for authentication, project discovery, and issue pagination. */
export class SonarCloudClient {
  private readonly token: string;
  private readonly organization?: string;
  private readonly apiBaseUrl: string;

  constructor(options: SonarCloudClientOptions) {
    this.token = options.token;
    this.organization = options.organization;
    this.apiBaseUrl = options.apiBaseUrl ?? SONARCLOUD_API_BASE;
  }

  /** Validate the configured SonarCloud token with /api/authentication/validate. */
  async validateToken(): Promise<boolean> {
    const response = await this.request('/api/authentication/validate');
    const body = await response.json() as unknown;
    const parsed = SonarCloudAuthValidationSchema.parse(body);
    if (!parsed.valid) {
      throw new OMTError({
        code: ErrorCodes.TOKEN_INVALID,
        message: 'SonarCloud token validation returned valid=false.',
        nextSteps: [
          'Generate a new SonarCloud user token.',
          'Update the oh-my-triage SonarCloud credential and rerun the connection test.',
        ],
        retryable: false,
      });
    }
    return true;
  }

  /** List projects visible to the token using /api/components/search pagination. */
  async listProjects(page = 1): Promise<{ projects: SonarCloudProject[]; total: number; hasMore: boolean }> {
    const params = new URLSearchParams({ p: String(page), ps: String(PAGE_SIZE), qualifiers: 'TRK' });
    if (this.organization) {
      params.set('organization', this.organization);
    }
    const response = await this.request(`/api/components/search?${params.toString()}`);
    const body = await response.json() as unknown;
    const parsed = SonarCloudProjectSearchSchema.parse(body);
    return {
      projects: parsed.components,
      total: parsed.paging.total,
      hasMore: parsed.paging.pageIndex * parsed.paging.pageSize < parsed.paging.total,
    };
  }

  /** Fetch one page of SonarCloud issues for a project with ps=100. */
  async searchIssues(projectKey: string, page: number): Promise<SonarCloudIssueSearch> {
    try {
      const params = new URLSearchParams({
        componentKeys: projectKey,
        p: String(page),
        ps: String(PAGE_SIZE),
      });
      const response = await this.request(`/api/issues/search?${params.toString()}`);
      const body = await response.json() as unknown;
      return SonarCloudIssueSearchSchema.parse(body);
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'SonarCloud issue search failed.',
        nextSteps: [
          'Verify the project key exists in SonarCloud and the token can browse issues.',
          'Run the SonarCloud connection test before fetching findings.',
        ],
      });
    }
  }

  private async request(path: string): Promise<Response> {
    return fetchAdapterResponse({
      source: 'SonarCloud',
      baseUrl: this.apiBaseUrl,
      path,
      token: this.token,
      accept: 'application/json',
      authorizationScheme: 'Bearer',
    });
  }
}
