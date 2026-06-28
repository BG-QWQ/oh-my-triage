import { ErrorCodes } from '../../core/errors.js';
import { toAdapterError } from '../adapter-errors.js';
import { fetchAdapterResponse } from '../adapter-http.js';
import {
  SnykIssuesResponseSchema,
  SnykOrganizationsResponseSchema,
  SnykProjectsResponseSchema,
  type SnykIssue,
  type SnykProject,
} from './snyk-schemas.js';

const SNYK_API_BASE = 'https://api.snyk.io/rest';
const DEFAULT_API_VERSION = '2024-10-15';
const DEFAULT_LIMIT = 100;

/** Configuration for Snyk REST API access. */
export type SnykClientOptions = {
  token: string;
  apiBaseUrl?: string;
  apiVersion?: string;
};

/** Minimal Snyk REST client for organization and issue listing. */
export class SnykClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;

  constructor(options: SnykClientOptions) {
    this.token = options.token;
    this.apiBaseUrl = options.apiBaseUrl ?? SNYK_API_BASE;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  }

  /** List organizations visible to the configured Snyk token. */
  async listOrganizations(
    options: { cursor?: string } = {}
  ): Promise<{ organizations: Array<{ id: string; name?: string; slug?: string }>; nextCursor?: string }> {
    try {
      const params = new URLSearchParams({ version: this.apiVersion });
      if (options.cursor) {
        params.set('starting_after', options.cursor);
      }
      const response = await this.request(`/orgs?${params.toString()}`);
      const body = (await response.json()) as unknown;
      const parsed = SnykOrganizationsResponseSchema.parse(body);
      return {
        organizations: parsed.data.map((organization) => ({
          id: organization.id,
          name: organization.attributes?.name,
          slug: organization.attributes?.slug,
        })),
        nextCursor: parseNextCursor(parsed.links?.next),
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Snyk organization listing failed.',
        nextSteps: [
          'Verify the Snyk token is active and has the required REST API scopes.',
          'Confirm the Snyk regional base URL matches your organization.',
        ],
      });
    }
  }

  /** List projects for an organization with optional target expansion.
   *
   * Target expansion is requested so project entries include the repository URL,
   * which lets oh-my-triage map Snyk projects to the current GitHub repository.
   */
  async listProjects(
    orgId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<{ projects: SnykProject[]; nextCursor?: string }> {
    try {
      const params = new URLSearchParams({
        version: this.apiVersion,
        limit: String(options.limit ?? DEFAULT_LIMIT),
        expand: 'target',
      });
      if (options.cursor) {
        params.set('starting_after', options.cursor);
      }
      const response = await this.request(`/orgs/${encodeURIComponent(orgId)}/projects?${params.toString()}`);
      const body = (await response.json()) as unknown;
      const parsed = SnykProjectsResponseSchema.parse(body);
      return {
        projects: parsed.data,
        nextCursor: parseNextCursor(parsed.links?.next),
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Snyk project listing failed.',
        nextSteps: [
          'Verify the organization ID exists and the token can access it.',
          'Confirm the token has the required REST API scopes for project access.',
        ],
      });
    }
  }

  /** List issues for an organization with cursor-based pagination. */
  async listIssues(
    orgId: string,
    options: { cursor?: string; limit?: number; projectId?: string } = {}
  ): Promise<{ issues: SnykIssue[]; nextCursor?: string }> {
    try {
      const params = new URLSearchParams({
        version: this.apiVersion,
        limit: String(options.limit ?? DEFAULT_LIMIT),
      });
      if (options.cursor) {
        params.set('starting_after', options.cursor);
      }
      if (options.projectId) {
        params.set('scan_item.id', options.projectId);
      }
      const response = await this.request(`/orgs/${encodeURIComponent(orgId)}/issues?${params.toString()}`);
      const body = (await response.json()) as unknown;
      const parsed = SnykIssuesResponseSchema.parse(body);
      return {
        issues: parsed.data,
        nextCursor: parseNextCursor(parsed.links?.next),
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Snyk issue fetch failed.',
        nextSteps: [
          'Verify the organization ID exists and the token can access it.',
          'Retry after confirming Snyk service health and token permissions.',
        ],
      });
    }
  }

  private async request(path: string): Promise<Response> {
    return fetchAdapterResponse({
      source: 'Snyk',
      baseUrl: this.apiBaseUrl,
      path,
      token: this.token,
      accept: 'application/vnd.api+json',
      authorizationScheme: 'token',
    });
  }
}

/** Extract the starting_after cursor from a Snyk links.next URL. */
function parseNextCursor(nextUrl?: string): string | undefined {
  if (!nextUrl) {
    return undefined;
  }
  try {
    const url = new URL(nextUrl, 'https://api.snyk.io');
    const cursor = url.searchParams.get('starting_after');
    return cursor ?? undefined;
  } catch {
    return undefined;
  }
}

