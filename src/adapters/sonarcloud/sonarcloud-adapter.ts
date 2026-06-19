import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '../base-adapter.js';
import { ErrorCodes, OMTError } from '../../core/errors.js';
import type { Finding } from '../../core/models/finding.js';
import { FindingStatus } from '../../core/models/common.js';
import { mapFields } from '../../core/normalization/field-mapper.js';
import { normalizeSeverity } from '../../core/normalization/severity-mapper.js';
import { generateFingerprint } from '../../utils/hash.js';
import { toAdapterError } from '../adapter-errors.js';
import { SonarCloudClient, type SonarCloudClientOptions } from './sonarcloud-client.js';
import type { SonarCloudIssue } from './sonarcloud-schemas.js';

/** Configuration for importing SonarCloud issues. */
export type SonarCloudAdapterOptions = SonarCloudClientOptions & {
  projectRoot?: string;
};

/** Adapter that imports SonarCloud issues into oh-my-triage findings. */
export class SonarCloudAdapter implements BaseAdapter {
  readonly sourceType = 'sonarcloud';
  readonly displayName = 'SonarCloud';

  private readonly client: SonarCloudClient;
  private readonly projectKey?: string;
  private readonly projectRoot?: string;

  constructor(options: SonarCloudAdapterOptions) {
    this.client = new SonarCloudClient(options);
    this.projectKey = options.projectKey;
    this.projectRoot = options.projectRoot;
  }

  /** Validate the SonarCloud token and report how many visible projects were found. */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.client.validateToken();
      
      // Try to list projects, but if organization is missing, just report token is valid
      try {
        const projects = await this.client.listProjects();
        return {
          valid: true,
          reason: `SonarCloud token validated and ${projects.total} project(s) are visible.`,
          projects_found: projects.total,
        };
      } catch (listError: unknown) {
        const message = listError instanceof Error ? listError.message : String(listError);
        // If the error is about missing organization, return partial success
        if (message.includes('organization') || message.includes('Organization')) {
          return {
            valid: true,
            reason: 'SonarCloud token validated successfully.',
            suggestion: 'Provide an organization to list projects.',
          };
        }
        throw listError;
      }
    } catch (error: unknown) {
      const adapterError = toAdapterError(error, {
        code: ErrorCodes.ADAPTER_CONNECTION_FAILED,
        message: 'SonarCloud connection test failed.',
        nextSteps: [
          'Verify the SonarCloud token is active.',
          'Confirm the token can browse the configured organization and projects.',
        ],
      });
      return { valid: false, reason: adapterError.message, suggestion: adapterError.nextSteps.join(' ') };
    }
  }

  /** Fetch a page of SonarCloud issues using /api/issues/search pagination. */
  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    if (!this.projectKey) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'SonarCloud projectKey is required to fetch findings.',
        nextSteps: [
          'Run the setup wizard and select a SonarCloud project.',
          'Set the SonarCloud project key in the adapter configuration.',
        ],
        retryable: false,
      });
    }
    const page = parsePageCursor(options.cursor);
    const issuePage = await this.client.searchIssues(this.projectKey, page);
    const limit = options.limit ? Math.max(1, options.limit) : issuePage.issues.length;
    const selected = issuePage.issues.slice(0, limit);
    const pageIndex = issuePage.paging?.pageIndex ?? issuePage.p ?? page;
    const pageSize = issuePage.paging?.pageSize ?? issuePage.ps ?? 100;
    const total = issuePage.paging?.total ?? issuePage.total;
    return {
      findings: selected.map((issue) => mapSonarCloudIssueToFinding(issue, this.projectRoot)),
      total,
      has_more: pageIndex * pageSize < total,
      next_cursor: pageIndex * pageSize < total ? String(pageIndex + 1) : undefined,
    };
  }
}

/** Map one SonarCloud issue into the canonical Finding model. */
export function mapSonarCloudIssueToFinding(issue: SonarCloudIssue, projectRoot?: string): Finding {
  const filePath = componentToPath(issue.component, issue.project);
  const startLine = issue.textRange?.startLine ?? issue.line ?? 1;
  const mapped = mapFields({
    tool: 'SonarCloud',
    ruleId: issue.rule,
    originalId: issue.key,
    message: issue.message,
    filePath,
    startLine,
    endLine: issue.textRange?.endLine,
    startColumn: offsetToColumn(issue.textRange?.startOffset),
    endColumn: offsetToColumn(issue.textRange?.endOffset),
    cweId: cweFromTags(issue.tags),
    owaspCategory: owaspFromTags(issue.tags),
    projectRoot,
  });
  const fingerprint = generateFingerprint({
    tool: mapped.source.tool,
    ruleId: `${issue.project}:${mapped.source.rule_id}`,
    filePath: mapped.location.file_path,
    startLine: mapped.location.start_line,
    message: issue.message,
  });

  return {
    id: `fb-${fingerprint.slice(0, 24)}`,
    source: mapped.source,
    title: mapped.title,
    message: issue.message,
    severity: normalizeSeverity(issue.severity, 'sonarcloud'),
    raw_severity: issue.severity,
    cwe_id: cweFromTags(issue.tags),
    owasp_category: owaspFromTags(issue.tags),
    location: mapped.location,
    status: mapSonarCloudStatus(issue),
    fingerprint,
    is_duplicate: false,
    priority_score: 50,
    fix_suggestion: issue.effort
      ? {
          description: `Estimated remediation effort: ${issue.effort}.`,
          effort_estimate: issue.effort,
        }
      : undefined,
    first_seen_at: normalizeSonarCloudTimestamp(issue.creationDate),
    last_seen_at: normalizeSonarCloudTimestamp(issue.updateDate),
    dismissed_reason: issue.resolution,
    raw_data: issue,
  };
}

/** Parse the SonarCloud adapter cursor as a one-based page number. */
export function parsePageCursor(cursor?: string): number {
  if (!cursor) {
    return 1;
  }
  const page = Number.parseInt(cursor, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function componentToPath(component: string, project: string): string {
  const prefix = `${project}:`;
  return component.startsWith(prefix) ? component.slice(prefix.length) : component;
}

function offsetToColumn(offset?: number): number | undefined {
  return offset === undefined ? undefined : offset + 1;
}

function mapSonarCloudStatus(issue: SonarCloudIssue): FindingStatus {
  if (issue.resolution === 'FALSE-POSITIVE') {
    return FindingStatus.enum.false_positive;
  }
  if (issue.resolution) {
    return FindingStatus.enum.dismissed;
  }
  if (issue.status === 'CLOSED' || issue.status === 'RESOLVED') {
    return FindingStatus.enum.fixed;
  }
  return FindingStatus.enum.open;
}

function cweFromTags(tags?: string[]): string | undefined {
  return tags?.find((tag) => /^cwe\d+$/i.test(tag) || /^CWE-\d+$/i.test(tag))?.replace(/^cwe/i, 'CWE-').toUpperCase();
}

function owaspFromTags(tags?: string[]): string | undefined {
  return tags?.find((tag) => /^owasp/i.test(tag));
}

function normalizeSonarCloudTimestamp(value: string): string {
  const normalizedOffset = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const timestamp = Date.parse(normalizedOffset);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toISOString();
}
