import { ErrorCodes } from '../../core/errors.js';
import { createHttpAdapterError, toAdapterError } from '../adapter-errors.js';
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
      const organizations = Object.entries(parsed.organizations).map(([slug, organization]) => ({
        slug,
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
      if (options.repositoryFullName) {
        params.set('filters.repoFullName', options.repositoryFullName);
      }
      const response = await this.request(`/orgs/${encodeURIComponent(orgSlug)}/alerts?${params.toString()}`);
      const body = await response.json() as unknown;
      const parsed = SocketAlertsResponseSchema.parse(body);
      return {
        alerts: parsed.items,
        endCursor: parsed.endCursor,
        totalCount: parsed.totalCount,
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
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'oh-my-triage/0.1',
      },
    });

    if (!response.ok) {
      const body = await safeResponseText(response);
      throw createHttpAdapterError({
        source: 'Socket.dev',
        status: response.status,
        statusText: response.statusText,
        body,
      });
    }

    return response;
  }
}

async function safeResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}
