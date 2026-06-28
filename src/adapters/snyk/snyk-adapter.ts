import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '../base-adapter.js';
import { ErrorCodes, OMTError } from '../../core/errors.js';
import type { Finding } from '../../core/models/finding.js';
import { FindingStatus } from '../../core/models/common.js';
import { generateFingerprint } from '../../utils/hash.js';
import { mapFields } from '../../core/normalization/field-mapper.js';
import { normalizeSeverity } from '../../core/normalization/severity-mapper.js';
import { connectionFailure } from '../connection-result.js';

import { SnykClient, type SnykClientOptions } from './snyk-client.js';
import type { SnykIssue } from './snyk-schemas.js';

/** Configuration for syncing Snyk issues. */
export type SnykAdapterOptions = SnykClientOptions & {
  orgId?: string;
  projectIds?: string[];
  projectRoot?: string;
};

/** Adapter that imports Snyk issues into oh-my-triage findings. */
export class SnykAdapter implements BaseAdapter {
  readonly sourceType = 'snyk';
  readonly displayName = 'Snyk';

  private readonly client: SnykClient;
  private readonly orgId?: string;
  private readonly projectIds?: string[];
  private readonly projectRoot?: string;

  constructor(options: SnykAdapterOptions) {
    this.client = new SnykClient(options);
    this.orgId = options.orgId;
    this.projectIds = options.projectIds;
    this.projectRoot = options.projectRoot;
  }

  /** Validate the Snyk token and report how many organizations are visible. */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.client.listOrganizations();
      return {
        valid: true,
        reason: `Snyk token validated and ${result.organizations.length} organization(s) are visible.`,
        orgs_found: result.organizations.length,
      };
    } catch (error: unknown) {
      return connectionFailure(error, 'Snyk connection test failed.', [
        'Verify the Snyk token is active.',
        'Confirm the token has REST API read access.',
      ]);
    }
  }

  /** Fetch a page of Snyk issues using cursor-based pagination.
   *
   * When projectIds are provided, the adapter iterates through the project IDs
   * sequentially. The cursor encodes both the current project index and the
   * Snyk issue cursor so pagination can resume across project boundaries.
   */
  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    if (!this.orgId) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'Snyk orgId is required to fetch findings.',
        nextSteps: [
          'Run the setup wizard and provide a Snyk organization ID.',
          'Set the Snyk org ID in the adapter configuration options.',
        ],
        retryable: false,
      });
    }

    if (this.projectIds && this.projectIds.length > 0) {
      return this.fetchFindingsForProjects(options.cursor, options.limit);
    }

    const result = await this.client.listIssues(this.orgId, {
      cursor: options.cursor,
      limit: options.limit,
    });
    return {
      findings: result.issues.map((issue) => mapSnykIssueToFinding(issue, this.orgId, this.projectRoot)),
      total: result.issues.length,
      has_more: result.nextCursor !== undefined,
      next_cursor: result.nextCursor,
    };
  }

  private async fetchFindingsForProjects(cursor?: string, limit?: number): Promise<AdapterFetchResult> {
    if (!this.orgId || !this.projectIds || this.projectIds.length === 0) {
      return { findings: [], total: 0, has_more: false };
    }

    const { projectIndex, issueCursor } = parseSnykProjectCursor(cursor);
    let currentProjectIndex = projectIndex;
    let currentIssueCursor = issueCursor;

    while (currentProjectIndex < this.projectIds.length) {
      const projectId = this.projectIds[currentProjectIndex];
      const result = await this.client.listIssues(this.orgId, {
        cursor: currentIssueCursor,
        limit,
        projectId,
      });

      const findings = result.issues.map((issue) => mapSnykIssueToFinding(issue, this.orgId, this.projectRoot));

      if (result.nextCursor !== undefined) {
        return {
          findings,
          total: findings.length,
          has_more: true,
          next_cursor: encodeSnykProjectCursor(currentProjectIndex, result.nextCursor),
        };
      }

      if (findings.length > 0) {
        const nextProjectIndex = currentProjectIndex + 1;
        const hasMoreProjects = nextProjectIndex < this.projectIds.length;
        return {
          findings,
          total: findings.length,
          has_more: hasMoreProjects,
          ...(hasMoreProjects ? { next_cursor: encodeSnykProjectCursor(nextProjectIndex) } : {}),
        };
      }

      currentProjectIndex += 1;
      currentIssueCursor = undefined;
    }

    return { findings: [], total: 0, has_more: false };
  }
}

function parseSnykProjectCursor(cursor?: string): { projectIndex: number; issueCursor?: string } {
  if (!cursor) {
    return { projectIndex: 0 };
  }
  const separatorIndex = cursor.indexOf(':');
  if (separatorIndex === -1) {
    return { projectIndex: Number.parseInt(cursor, 10) };
  }
  const projectIndex = Number.parseInt(cursor.slice(0, separatorIndex), 10);
  const issueCursor = cursor.slice(separatorIndex + 1);
  return {
    projectIndex: Number.isInteger(projectIndex) && projectIndex >= 0 ? projectIndex : 0,
    issueCursor: issueCursor || undefined,
  };
}

function encodeSnykProjectCursor(projectIndex: number, issueCursor?: string): string {
  return issueCursor ? `${projectIndex}:${issueCursor}` : String(projectIndex);
}

/** Map one Snyk issue into the canonical Finding model. */
export function mapSnykIssueToFinding(issue: SnykIssue, orgId?: string, projectRoot?: string): Finding {
  const packageId = issue.relationships?.package?.data?.id;
  const fallbackPath = orgId
    ? `snyk:orgs/${orgId}/issues/${issue.id}`
    : `snyk:issues/${issue.id}`;
  const locationPath = packageId ?? fallbackPath;
  const message = issue.attributes?.title ?? issue.attributes?.key ?? issue.id;
  const rawSeverity = selectSnykSeverity(issue);
  const mapped = mapFields({
    tool: 'Snyk',
    ruleId: issue.attributes?.key ?? issue.id,
    ruleName: issue.attributes?.title,
    originalId: issue.id,
    message,
    filePath: locationPath,
    startLine: 1,
    projectRoot,
  });
  const fingerprint = generateFingerprint({
    tool: mapped.source.tool,
    ruleId: mapped.source.rule_id,
    filePath: mapped.location.file_path,
    startLine: mapped.location.start_line,
    message,
  });

  return {
    id: `fb-${fingerprint.slice(0, 24)}`,
    source: mapped.source,
    title: mapped.title,
    message,
    severity: normalizeSeverity(rawSeverity, 'snyk'),
    raw_severity: rawSeverity,
    location: mapped.location,
    status: mapSnykStatus(issue),
    fingerprint,
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: issue.attributes?.created_at ?? new Date().toISOString(),
    last_seen_at: issue.attributes?.updated_at ?? issue.attributes?.created_at ?? new Date().toISOString(),
    raw_data: issue,
  };
}

function selectSnykSeverity(issue: SnykIssue): string {
  const severities = issue.attributes?.severities ?? [];
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  let best: string | undefined;
  for (const level of order) {
    const match = severities.find((severity) => severity.level?.toLowerCase() === level);
    if (match) {
      best = match.level;
      break;
    }
  }
  return best ?? severities[0]?.level ?? 'low';
}

function mapSnykStatus(issue: SnykIssue): FindingStatus {
  const status = issue.attributes?.status;
  if (status === 'fixed' || status === 'resolved') {
    return FindingStatus.enum.fixed;
  }
  if (status === 'ignored') {
    return FindingStatus.enum.dismissed;
  }
  return FindingStatus.enum.open;
}

