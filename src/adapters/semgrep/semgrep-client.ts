import { ErrorCodes, OMTError } from '../../core/errors.js';
import { createHttpAdapterError, toAdapterError } from '../adapter-errors.js';
import { redactSecrets } from '../../utils/redaction.js';
import {
  SemgrepDeploymentListSchema,
  SemgrepFindingsResponseSchema,
  type SemgrepFinding,
} from './semgrep-schemas.js';

const SEMGREP_API_BASE = 'https://semgrep.dev';
const DEFAULT_PAGE_SIZE = 100;

/** Configuration for Semgrep API access. */
export type SemgrepClientOptions = {
  token: string;
  apiBaseUrl?: string;
};

/** Minimal Semgrep client for deployment discovery and findings pagination. */
export class SemgrepClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;

  constructor(options: SemgrepClientOptions) {
    this.token = options.token;
    this.apiBaseUrl = options.apiBaseUrl ?? SEMGREP_API_BASE;
  }

  /** List Semgrep deployments visible to the configured token. */
  async listDeployments(): Promise<{ deployments: Array<{ slug: string; name?: string }>; hasMore: boolean }> {
    try {
      const response = await this.request('/api/v1/deployments');
      const body = (await response.json()) as unknown;
      const parsed = SemgrepDeploymentListSchema.parse(body);
      return {
        deployments: parsed.deployments,
        hasMore: false,
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Semgrep deployment listing failed.',
        nextSteps: [
          'Verify the Semgrep token is active.',
          'Confirm the token can access the Semgrep Web API.',
        ],
      });
    }
  }

  /** List Semgrep findings for a deployment with page-based pagination. */
  async listFindings(
    deploymentSlug: string,
    options: { page?: number; pageSize?: number; issueType?: 'sast' | 'sca'; repos?: string[] } = {}
  ): Promise<{ findings: SemgrepFinding[]; hasMore: boolean }> {
    try {
      const page = options.page ?? 0;
      const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (options.issueType) {
        params.set('issue_type', options.issueType);
      }
      if (options.repos && options.repos.length > 0) {
        params.set('repos', options.repos.join(','));
      }
      const response = await this.request(`/api/v1/deployments/${encodeURIComponent(deploymentSlug)}/findings?${params.toString()}`);
      const body = (await response.json()) as unknown;
      const parsed = SemgrepFindingsResponseSchema.parse(body);
      const findings = parsed.sastFindings?.findings ?? parsed.findings ?? [];
      return {
        findings,
        hasMore: findings.length === pageSize,
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.ADAPTER_FETCH_FAILED,
        message: 'Semgrep findings fetch failed.',
        nextSteps: [
          'Verify the deployment slug exists in Semgrep.',
          'Confirm the token can access the Semgrep Web API.',
        ],
      });
    }
  }

  private async request(path: string): Promise<Response> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'oh-my-triage/0.1',
      },
    });

    if (!response.ok) {
      const body = await safeResponseText(response);
      const redactedBody = body ? redactSemgrepBody(body) : undefined;
      const bodySuffix = redactedBody ? ` Body: ${redactedBody.slice(0, 500)}` : '';

      if (response.status === 404) {
        throw new OMTError({
          code: ErrorCodes.ADAPTER_FETCH_FAILED,
          message: `Semgrep resource was not found.${bodySuffix}`,
          nextSteps: [
            'Grant the Semgrep Web API scope to the token.',
            'Verify the deployment slug is spelled correctly.',
            'Retry the connection test before fetching findings.',
          ],
          retryable: false,
        });
      }

      throw createHttpAdapterError({
        source: 'Semgrep',
        status: response.status,
        statusText: response.statusText,
        body: redactedBody,
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

function redactSemgrepBody(body: string): string {
  return redactSecrets(body).replace(/\b(token)\s+([^\s"'}]+)/gi, '$1 ***REDACTED***');
}
