import { ErrorCodes } from '../../core/errors.js';
import { toAdapterError } from '../adapter-errors.js';
import { fetchAdapterResponse } from '../adapter-http.js';
import {
  SocketAlertsResponseSchema,
  SocketOrganizationsResponseSchema,
  type SocketAlert,
} from './socket-schemas.js';

const SOCKET_API_BASE = 'https://api.socket.dev/v0';
const DEFAULT_PER_PAGE = 1000;

/** Configuration for Socket.dev API access. */
export type SocketClientOptions = {
  token: string;
  apiBaseUrl?: string;
};

/** Minimal Socket.dev client for organization and alert listing. */
export class SocketClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;

  constructor(options: SocketClientOptions) {
    this.token = options.token;
    this.apiBaseUrl = options.apiBaseUrl ?? SOCKET_API_BASE;
  }

  /** List organizations visible to the configured Socket token.
   *
   * The API returns organizations as a slug-keyed object; this method converts
   * that object into a stable array of { slug, name } entries.
   */
  async listOrganizations(
    _options: { cursor?: string } = {}
  ): Promise<{ organizations: Array<{ slug: string; name?: string }>; hasMore: boolean }> {
    try {
      const response = await this.request('/organizations');
      const body = (await response.json()) as unknown;
      const parsed = SocketOrganizationsResponseSchema.parse(body);
      const organizations = Object.entries(parsed.organizations).map(([key, organization]) => ({
        slug: organization.slug ?? key,
        name: organization.name ?? undefined,
      }));
      return { organizations, hasMore: false };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Socket.dev organization listing failed.',
        nextSteps: [
          'Verify the Socket.dev token is active and has organization access.',
          'Retry after confirming Socket.dev service health.',
        ],
      });
    }
  }

  /** List alerts for an organization with cursor-based pagination. */
  async listAlerts(
    orgSlug: string,
    options: { startAfterCursor?: string; perPage?: number; repositoryFullName?: string } = {}
  ): Promise<{ alerts: SocketAlert[]; endCursor: string | null; totalCount: number }> {
    try {
      const params = new URLSearchParams({ per_page: String(options.perPage ?? DEFAULT_PER_PAGE) });
      if (options.startAfterCursor) {
        params.set('startAfterCursor', options.startAfterCursor);
      }
      let queryString = params.toString();
      if (options.repositoryFullName) {
        queryString += `&filters.repoFullName=${encodeSocketRepoFilter(options.repositoryFullName)}`;
      }
      const response = await this.request(`/orgs/${encodeURIComponent(orgSlug)}/alerts?${queryString}`);
      const body = await response.json() as unknown;
      const parsed = SocketAlertsResponseSchema.parse(body);
      return {
        alerts: parsed.items,
        endCursor: parsed.endCursor,
        totalCount: parsed.totalCount ?? parsed.items.length,
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Socket.dev alert fetch failed.',
        nextSteps: [
          'Verify the organization slug exists and the token can access it.',
          'Retry after confirming Socket.dev service health and token permissions.',
        ],
      });
    }
  }

  private async request(path: string): Promise<Response> {
    return fetchAdapterResponse({
      source: 'Socket.dev',
      baseUrl: this.apiBaseUrl,
      path,
      token: this.token,
      accept: 'application/json',
      authorizationScheme: 'Bearer',
    });
  }
}

/** Encode a Socket.dev repoFullName filter value.
 *
 * Socket.dev documents `filters.repoFullName` as a comma-separated list of
 * `owner/repo` values with literal `/` and `,` delimiters. This helper keeps
 * those delimiters literal while still percent-encoding other unsafe characters
 * so the query string remains valid.
 */
function encodeSocketRepoFilter(value: string): string {
  return value
    .split(',')
    .map((repo) => repo.split('/').map(encodeURIComponent).join('/'))
    .join(',');
}

