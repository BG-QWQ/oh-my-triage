import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '../base-adapter.js';
import type { Finding } from '../../core/models/finding.js';
import { FindingStatus } from '../../core/models/common.js';
import { generateFingerprint } from '../../utils/hash.js';
import { mapFields } from '../../core/normalization/field-mapper.js';
import { normalizeSeverity } from '../../core/normalization/severity-mapper.js';
import { connectionFailure } from '../connection-result.js';
import { GitHubClient, type GitHubClientOptions, type GitHubConnectionValidation } from './github-client.js';
import type { GitHubCodeScanningAlert, GitHubRepository } from './github-schemas.js';

/** Configuration for syncing GitHub Code Scanning alerts. */
export type GitHubAdapterOptions = GitHubClientOptions & {
  projectRoot?: string;
};

/** Adapter that imports GitHub Code Scanning alerts through the REST API. */
export class GitHubAdapter implements BaseAdapter {
  readonly sourceType = 'github';
  readonly displayName = 'GitHub Code Scanning';

  private readonly client: GitHubClient;
  private readonly projectRoot?: string;

  constructor(options: GitHubAdapterOptions) {
    this.client = new GitHubClient(options);
    this.projectRoot = options.projectRoot;
  }

  /**
   * Test GitHub repository access and token scopes.
   *
   * Validates the token and lists accessible repositories as two separate
   * steps so that an invalid token is not confused with a
   * repository-permission failure. Each failure path returns a distinct,
   * actionable error message.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    // Step 1: validate token identity and scopes.
    let validation: GitHubConnectionValidation;
    try {
      validation = await this.client.validateConnection();
    } catch (error: unknown) {
      return connectionFailure(error, 'GitHub token validation failed.', [
        'Verify the token is correct and not expired.',
        'Regenerate the token if GitHub reports it as invalid or expired.',
      ]);
    }

    // Step 2: list repositories accessible to the token.
    let repositories: GitHubRepository[];
    try {
      repositories = await this.client.listAccessibleRepositories();
    } catch (error: unknown) {
      return connectionFailure(error, 'GitHub token is valid but repository listing failed.', [
        'Ensure the token has the "repo" scope to list repositories.',
        'Fine-grained tokens require "Metadata" and "Contents" read permissions.',
      ]);
    }

    const owners = new Set(repositories.map((repository) => repository.owner.login));
    return {
      valid: true,
      reason: validation.observedScopes.length
        ? `GitHub connection validated with scopes: ${validation.observedScopes.join(', ')}.`
        : 'GitHub connection validated; GitHub did not return OAuth scope headers.',
      projects_found: repositories.length,
      orgs_found: owners.size,
      repositories: repositories.map(mapGitHubRepositoryOption),
    };
  }

  /** Fetch a page of GitHub Code Scanning alerts using REST pagination with per_page=100. */
  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    const page = parsePageCursor(options.cursor);
    const pageAlerts = await this.client.listCodeScanningAlerts(page);
    const limit = options.limit ? Math.max(1, options.limit) : pageAlerts.length;
    const selected = pageAlerts.slice(0, limit);
    return {
      findings: selected.map((alert) => mapGitHubAlertToFinding(alert, this.projectRoot)),
      total: selected.length,
      has_more: pageAlerts.length === 100,
      next_cursor: pageAlerts.length === 100 ? String(page + 1) : undefined,
    };
  }
}

function mapGitHubRepositoryOption(repository: GitHubRepository): NonNullable<ConnectionTestResult['repositories']>[number] {
  return {
    owner: repository.owner.login,
    name: repository.name,
    full_name: repository.full_name,
    private: repository.private,
    archived: repository.archived,
    disabled: repository.disabled,
  };
}

/** Map one GitHub Code Scanning alert into the canonical Finding model. */
export function mapGitHubAlertToFinding(alert: GitHubCodeScanningAlert, projectRoot?: string): Finding {
  const location = alert.most_recent_instance.location;
  const message = alert.most_recent_instance.message?.text ?? alert.rule.description ?? alert.rule.name ?? alert.rule.id;
  const rawSeverity = alert.rule.security_severity_level ?? alert.rule.severity ?? 'warning';
  const mapped = mapFields({
    tool: alert.tool.name,
    ruleId: alert.rule.id,
    ruleName: alert.rule.name ?? alert.rule.id,
    ruleDescription: alert.rule.full_description ?? alert.rule.description ?? alert.rule.help ?? undefined,
    originalId: `github-code-scanning:${alert.number}`,
    originalUrl: alert.html_url ?? undefined,
    message,
    filePath: location.path,
    startLine: location.start_line,
    startColumn: location.start_column ?? undefined,
    endLine: location.end_line ?? undefined,
    endColumn: location.end_column ?? undefined,
    cweId: cweFromTags(alert.rule.tags ?? undefined),
    owaspCategory: owaspFromTags(alert.rule.tags ?? undefined),
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
    source: {
      ...mapped.source,
      tool_version: alert.tool.version ?? undefined,
    },
    title: mapped.title,
    message,
    severity: normalizeSeverity(rawSeverity, 'github'),
    raw_severity: rawSeverity,
    cwe_id: cweFromTags(alert.rule.tags ?? undefined),
    owasp_category: owaspFromTags(alert.rule.tags ?? undefined),
    location: mapped.location,
    status: mapGitHubStatus(alert),
    fingerprint,
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: alert.created_at,
    last_seen_at: alert.updated_at ?? alert.created_at,
    dismissed_at: alert.dismissed_at ?? undefined,
    dismissed_reason: alert.dismissed_reason ?? undefined,
    raw_data: alert,
  };
}

/** Parse the GitHub adapter cursor as a one-based REST page number. */
export function parsePageCursor(cursor?: string): number {
  if (!cursor) {
    return 1;
  }
  const page = Number.parseInt(cursor, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function mapGitHubStatus(alert: GitHubCodeScanningAlert): FindingStatus {
  if (alert.state === 'fixed' || alert.fixed_at) {
    return FindingStatus.enum.fixed;
  }
  if (alert.state === 'dismissed' || alert.dismissed_at) {
    if (alert.dismissed_reason === 'false positive') {
      return FindingStatus.enum.false_positive;
    }
    return FindingStatus.enum.dismissed;
  }
  return FindingStatus.enum.open;
}

function cweFromTags(tags?: string[] | null): string | undefined {
  return tags?.find((tag) => /^CWE-\d+$/i.test(tag))?.toUpperCase();
}

function owaspFromTags(tags?: string[] | null): string | undefined {
  return tags?.find((tag) => /^OWASP/i.test(tag));
}

