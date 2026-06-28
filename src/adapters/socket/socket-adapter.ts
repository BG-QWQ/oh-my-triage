import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '../base-adapter.js';
import { ErrorCodes, OMTError } from '../../core/errors.js';
import type { Finding } from '../../core/models/finding.js';
import { FindingStatus } from '../../core/models/common.js';
import { generateFingerprint } from '../../utils/hash.js';
import { mapFields } from '../../core/normalization/field-mapper.js';
import { normalizeSeverity } from '../../core/normalization/severity-mapper.js';
import { connectionFailure } from '../connection-result.js';
import { SocketClient, type SocketClientOptions } from './socket-client.js';
import type { SocketAlert } from './socket-schemas.js';

/** Configuration for syncing Socket.dev alerts. */
export type SocketAdapterOptions = SocketClientOptions & {
  orgSlug?: string;
  repositoryFullName?: string;
  projectRoot?: string;
};

/** Adapter that imports Socket.dev alerts into oh-my-triage findings. */
export class SocketAdapter implements BaseAdapter {
  readonly sourceType = 'socket';
  readonly displayName = 'Socket.dev';

  private readonly client: SocketClient;
  private readonly orgSlug?: string;
  private readonly repositoryFullName?: string;
  private readonly projectRoot?: string;

  constructor(options: SocketAdapterOptions) {
    this.client = new SocketClient(options);
    this.orgSlug = options.orgSlug;
    this.repositoryFullName = options.repositoryFullName;
    this.projectRoot = options.projectRoot;
  }

  /** Validate the Socket.dev token and report how many organizations are visible. */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.client.listOrganizations();
      return {
        valid: true,
        reason: `Socket.dev token validated and ${result.organizations.length} organization(s) are visible.`,
        orgs_found: result.organizations.length,
      };
    } catch (error: unknown) {
      return connectionFailure(error, 'Socket.dev connection test failed.', [
        'Verify the Socket.dev token is active.',
        'Confirm the token can list organizations.',
      ]);
    }
  }

  /** Fetch a page of Socket.dev alerts using cursor-based pagination. */
  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    if (!this.orgSlug) {
      throw new OMTError({
        code: ErrorCodes.CONFIG_INVALID,
        message: 'Socket.dev orgSlug is required to fetch findings.',
        nextSteps: [
          'Run the setup wizard and provide a Socket.dev organization slug.',
          'Set the Socket.org slug in the adapter configuration options.',
        ],
        retryable: false,
      });
    }
    const result = await this.client.listAlerts(this.orgSlug, {
      startAfterCursor: options.cursor,
      perPage: options.limit,
      repositoryFullName: this.repositoryFullName,
    });
    return {
      findings: result.alerts.map((alert) => mapSocketAlertToFinding(alert, this.projectRoot)),
      total: result.alerts.length,
      has_more: result.endCursor !== null,
      next_cursor: result.endCursor ?? undefined,
    };
  }
}

/** Map one Socket.dev alert into the canonical Finding model. */
export function mapSocketAlertToFinding(alert: SocketAlert, projectRoot?: string): Finding {
  const branchSuffix = alert.branch ? `:${alert.branch}` : '';
  const locationPrefix = alert.repo_full_name;
  const locationPath = alert.repo_full_name
    ? `${locationPrefix}${branchSuffix}`
    : `socket://orgs/${alert.organization ?? 'unknown'}/alerts/${alert.id}`;
  const message = alert.title ?? alert.description ?? `Socket.dev ${alert.type ?? 'alert'}`;
  const mapped = mapFields({
    tool: 'Socket.dev',
    ruleId: alert.type ?? alert.cve_id ?? alert.cwe_id ?? 'socket-alert',
    ruleName: alert.type,
    originalId: alert.id,
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
    severity: normalizeSeverity(alert.severity ?? 'low', 'socket'),
    raw_severity: alert.severity ?? 'low',
    cwe_id: alert.cwe_id ? normalizeCweId(alert.cwe_id) : undefined,
    location: mapped.location,
    status: mapSocketStatus(alert),
    fingerprint,
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: alert.created_at,
    last_seen_at: alert.updated_at ?? alert.created_at,
    raw_data: alert,
  };
}

function mapSocketStatus(alert: SocketAlert): FindingStatus {
  if (alert.state === 'resolved' || alert.state === 'fixed') {
    return FindingStatus.enum.fixed;
  }
  if (alert.state === 'dismissed') {
    return FindingStatus.enum.dismissed;
  }
  return FindingStatus.enum.open;
}

function normalizeCweId(value: string): string | undefined {
  const match = /CWE-(\d+)/i.exec(value);
  return match ? `CWE-${match[1]}` : undefined;
}

