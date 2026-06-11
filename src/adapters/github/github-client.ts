import { ErrorCodes, FindingBridgeError } from '../../core/errors.js';
import { createHttpAdapterError, toAdapterError } from '../adapter-errors.js';
import {
  GitHubCodeScanningAlertPageSchema,
  GitHubAuthenticatedUserSchema,
  GitHubRepositoryPageSchema,
  type GitHubCodeScanningAlertPage,
  type GitHubRepository,
} from './github-schemas.js';

const GITHUB_API_BASE = 'https://api.github.com';
const REQUIRED_SCOPES = ['security_events'];
const DEFAULT_PER_PAGE = 100;

/** Configuration for GitHub REST API access. */
export type GitHubClientOptions = {
  token: string;
  owner?: string;
  repo?: string;
  apiBaseUrl?: string;
};

/** Result returned after validating GitHub token and scope access. */
export type GitHubConnectionValidation = {
  valid: true;
  observedScopes: string[];
};

/** Minimal GitHub Code Scanning REST client with validated pagination. */
export class GitHubClient {
  private readonly token: string;
  private readonly owner?: string;
  private readonly repo?: string;
  private readonly apiBaseUrl: string;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.apiBaseUrl = options.apiBaseUrl ?? GITHUB_API_BASE;
  }

  /** Validate the token and, when configured, repository access without exposing credentials. */
  async validateConnection(): Promise<GitHubConnectionValidation> {
    const response = this.owner && this.repo
      ? await this.request(`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`)
      : await this.request('/user');
    const body = await response.json() as unknown;
    if (this.owner && this.repo) {
      GitHubRepositoryPageSchema.element.parse(body);
    } else {
      GitHubAuthenticatedUserSchema.parse(body);
    }
    const observedScopes = parseScopes(response.headers.get('x-oauth-scopes'));
    const missingScopes = missingRequiredScopes(observedScopes, REQUIRED_SCOPES);
    if (observedScopes.length > 0 && missingScopes.length > 0) {
      throw new FindingBridgeError({
        code: ErrorCodes.PERMISSION_DENIED,
        message: `GitHub token is missing required scope(s): ${missingScopes.join(', ')}.`,
        nextSteps: [
          'Create a GitHub token with code scanning/security events read access for the repository.',
          'Update the FindingBridge GitHub token and rerun the connection test.',
        ],
        retryable: false,
        details: { observed_scopes: observedScopes, required_scopes: REQUIRED_SCOPES },
      });
    }
    return { valid: true, observedScopes };
  }

  /** Fetch one page of Code Scanning alerts with per_page fixed at 100. */
  async listCodeScanningAlerts(page: number): Promise<GitHubCodeScanningAlertPage> {
    try {
      if (!this.owner || !this.repo) {
        throw new FindingBridgeError({
          code: ErrorCodes.CONFIG_INVALID,
          message: 'GitHub Code Scanning sync requires repository owner and name.',
          nextSteps: ['Run FindingBridge setup and select a GitHub repository before syncing findings.'],
          retryable: false,
        });
      }
      const response = await this.request(
        `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/code-scanning/alerts?per_page=100&page=${page}`
      );
      const body = await response.json() as unknown;
      return GitHubCodeScanningAlertPageSchema.parse(body);
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'GitHub Code Scanning alert fetch failed.',
        nextSteps: [
          'Verify code scanning is enabled for the repository.',
          'Confirm the token has repository security event read permissions.',
        ],
      });
    }
  }

  /** List repositories visible to the token for setup-time owner/repo selection. */
  async listAccessibleRepositories(options: { maxPages?: number } = {}): Promise<GitHubRepository[]> {
    const maxPages = Math.max(1, options.maxPages ?? 10);
    const repositories: GitHubRepository[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const response = await this.request(
        `/user/repos?per_page=${DEFAULT_PER_PAGE}&page=${page}&visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc`
      );
      const body = await response.json() as unknown;
      const pageRepositories = GitHubRepositoryPageSchema.parse(body);
      repositories.push(...pageRepositories);

      if (pageRepositories.length < DEFAULT_PER_PAGE) {
        break;
      }
    }

    return repositories;
  }

  private async request(path: string): Promise<Response> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'FindingBridge/0.1',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const body = await safeResponseText(response);
      throw createHttpAdapterError({
        source: 'GitHub',
        status: response.status,
        statusText: response.statusText,
        body,
        requiredScopes: REQUIRED_SCOPES,
        observedScopes: parseScopes(response.headers.get('x-oauth-scopes')),
      });
    }

    return response;
  }
}

/** Parse the X-OAuth-Scopes header into scope names. */
export function parseScopes(header: string | null): string[] {
  if (!header) {
    return [];
  }
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/** Return required GitHub scopes not represented by the observed token scopes. */
export function missingRequiredScopes(observedScopes: string[], requiredScopes: string[]): string[] {
  if (observedScopes.includes('repo')) {
    return [];
  }
  return requiredScopes.filter((scope) => !observedScopes.includes(scope));
}

async function safeResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}
