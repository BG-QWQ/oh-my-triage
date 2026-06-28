import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '../base-adapter.js';
import { ErrorCodes, OMTError } from '../../core/errors.js';
import type { Finding } from '../../core/models/finding.js';
import { FindingStatus } from '../../core/models/common.js';
import { generateFingerprint } from '../../utils/hash.js';
import { mapFields } from '../../core/normalization/field-mapper.js';
import { normalizeSeverity } from '../../core/normalization/severity-mapper.js';
import { connectionFailure } from '../connection-result.js';

import { SemgrepClient, type SemgrepClientOptions } from './semgrep-client.js';
import type { SemgrepFinding } from './semgrep-schemas.js';

/** Configuration for syncing Semgrep findings. */
export type SemgrepAdapterOptions = SemgrepClientOptions & {
  deploymentSlug?: string;
  repositoryFullName?: string;
  issueType?: 'sast' | 'sca';
  projectRoot?: string;
};

/** Adapter that imports Semgrep findings into oh-my-triage findings. */
export class SemgrepAdapter implements BaseAdapter {
  readonly sourceType = 'semgrep';
  readonly displayName = 'Semgrep';

  private readonly client: SemgrepClient;
  private readonly deploymentSlug?: string;
  private readonly repositoryFullName?: string;
  private readonly issueType?: 'sast' | 'sca';
  private readonly projectRoot?: string;

  constructor(options: SemgrepAdapterOptions) {
    this.client = new SemgrepClient(options);
    this.deploymentSlug = options.deploymentSlug;
    this.repositoryFullName = options.repositoryFullName;
    this.issueType = options.issueType;
    this.projectRoot = options.projectRoot;
  }

  /** Validate the Semgrep token and report how many deployments are visible. */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.client.listDeployments();
      return {
        valid: true,
        reason: `Semgrep token validated and ${result.deployments.length} deployment(s) are visible.`,
        projects_found: result.deployments.length,
      };
    } catch (error: unknown) {
      return connectionFailure(error, 'Semgrep connection test failed.', [
        'Verify the Semgrep token is active and has the Web API scope.',
        'Confirm the token can list deployments.',
      ]);
    }
  }

  /** Fetch a page of Semgrep findings using page-based pagination. */
  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    if (!this.deploymentSlug) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'Semgrep deploymentSlug is required to fetch findings.',
        nextSteps: [
          'Run the setup wizard and provide a Semgrep deployment slug.',
          'Set the Semgrep deployment slug in the adapter configuration options.',
        ],
        retryable: false,
      });
    }
    const page = parsePageCursor(options.cursor);
    const result = await this.client.listFindings(this.deploymentSlug, {
      page,
      pageSize: options.limit,
      issueType: this.issueType,
      repos: this.repositoryFullName ? [this.repositoryFullName] : undefined,
    });
    return {
      findings: result.findings.map((finding) => mapSemgrepFindingToFinding(finding, this.projectRoot)),
      total: result.findings.length,
      has_more: result.hasMore,
      next_cursor: result.hasMore ? String(page + 1) : undefined,
    };
  }
}

/** Map one Semgrep finding into the canonical Finding model. */
export function mapSemgrepFindingToFinding(finding: SemgrepFinding, projectRoot?: string): Finding {
  const ruleId = finding.ruleId ?? finding.rule?.id ?? finding.rule_name ?? 'semgrep-finding';
  const ruleName = finding.rule?.name ?? finding.title ?? finding.rule_name ?? ruleId;
  const message = finding.message ?? finding.rule?.message ?? finding.rule_message ?? ruleName;
  const filePath = finding.path ?? finding.location?.path ?? finding.location?.file_path ?? 'semgrep:unknown';
  const startLine = finding.location?.line ?? 1;
  const rawSeverity = finding.severity ?? 'INFO';
  const mapped = mapFields({
    tool: 'Semgrep',
    ruleId,
    ruleName,
    originalId: String(finding.id),
    message,
    filePath,
    startLine,
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
    severity: normalizeSeverity(rawSeverity, 'semgrep'),
    raw_severity: rawSeverity,
    cwe_id: extractCweId(finding),
    location: mapped.location,
    status: mapSemgrepStatus(finding),
    fingerprint,
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: finding.created_at ?? new Date().toISOString(),
    last_seen_at: finding.triaged_at ?? finding.created_at ?? new Date().toISOString(),
    raw_data: finding,
  };
}

function parsePageCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const page = Number.parseInt(cursor, 10);
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function mapSemgrepStatus(finding: SemgrepFinding): FindingStatus {
  const status = finding.status?.toLowerCase();
  if (status === 'fixed' || status === 'resolved') {
    return FindingStatus.enum.fixed;
  }
  if (status === 'false_positive' || status === 'falsepositive' || finding.triage_state === 'false_positive') {
    return FindingStatus.enum.false_positive;
  }
  if (status === 'ignored' || status === 'dismissed') {
    return FindingStatus.enum.dismissed;
  }
  return FindingStatus.enum.open;
}

function extractCweId(finding: SemgrepFinding): string | undefined {
  const names = finding.rule?.cweNames ?? finding.rule?.cwe_names;
  if (Array.isArray(names) && names.length > 0) {
    const match = /CWE-(\d+)/i.exec(String(names[0]));
    return match ? `CWE-${match[1]}` : undefined;
  }
  return undefined;
}

