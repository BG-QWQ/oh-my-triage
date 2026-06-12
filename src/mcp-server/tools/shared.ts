import type { Finding } from '../../core/models/finding.js';
import type { SourceType } from '../../core/models/common.js';
import { getSourceDisplayName } from '../../core/normalization/source-metadata.js';
import { redactCodeSnippet, redactSecrets } from '../../utils/redaction.js';
import type { FindingBridgeMcpContext } from '../context.js';

const MAX_SCOPE_LIMIT = 1000;

/**
 * Represent a minimal redacted finding for MCP responses.
 *
 * Summaries intentionally omit raw scanner payloads and full code context so
 * list-like tools stay compact and privacy-preserving.
 */
export interface FindingSummary {
  id: string;
  title: string;
  severity: Finding['severity'];
  status: Finding['status'];
  tool: string;
  rule_id: string;
  file_path: string;
  start_line: number;
  cwe_id?: string;
  priority_score: number;
  is_duplicate: boolean;
  is_stale: boolean;
  duplicate_group_id?: string;
  last_seen_at: string;
}

/** Explain the database scope represented by a read-only MCP response. */
export interface FindingBridgeDataScope {
  type: 'global_database';
  project_scope_supported: false;
  current_project_matched: false;
  message: string;
  agent_instruction: string;
}

/** Describe whether a response contains usable findings for the requested scope. */
export interface FindingBridgeDataAvailability {
  has_findings: boolean;
  no_data_reason: string | null;
  agent_instruction: string;
}

/** Warn callers when stored findings do not match the configured scanner sources. */
export interface FindingBridgeProvenanceWarning {
  code: 'demo_data' | 'source_tool_mismatch' | 'unconfigured_findings';
  message: string;
  configured_sources: Array<{ id: string; type: string; expected_tools: string[] }>;
  observed_tools: string[];
  remediation_steps: string[];
  agent_instruction: string;
}

const SOURCE_TOOL_ALIASES: Record<SourceType, string[]> = {
  sarif: ['SARIF'],
  github: ['GitHub Code Scanning', 'CodeQL'],
  sonarcloud: ['SonarCloud'],
  socket: ['Socket.dev'],
  snyk: ['Snyk'],
  semgrep: ['Semgrep'],
  trivy: ['Trivy'],
  sbom: ['SBOM'],
};

/** Build scope metadata that requires user confirmation before current-workspace claims. */
export function globalFindingScope(): FindingBridgeDataScope {
  return {
    type: 'global_database',
    project_scope_supported: false,
    current_project_matched: false,
    message:
      'FindingBridge is returning data from its configured local findings database. It cannot verify that this data matches the current workspace repository/project under review.',
    agent_instruction:
      'Confirm the current workspace repository/project with the user before relying on these findings. Do not claim these findings apply to the current project unless the user confirms this FindingBridge database was populated or synchronized for that repository/project.',
  };
}

/** Build explicit data-availability metadata for list and summary responses. */
export function findingDataAvailability(totalFindings: number): FindingBridgeDataAvailability {
  if (totalFindings > 0) {
    return {
      has_findings: true,
      no_data_reason: null,
      agent_instruction:
        'Report only the findings returned by FindingBridge. Do not add vulnerabilities that are not present in this response. If the user asked for current or latest scanner platform results and you have not already synchronized this turn, call findingbridge_sync_sources before relying on this data.',
    };
  }

  return {
    has_findings: false,
    no_data_reason: 'No stored findings matched this FindingBridge database request.',
    agent_instruction:
      'Report that FindingBridge returned no findings for this request. If filters were provided, say no stored findings matched those filters. If the user asked for current or latest scanner platform results, call findingbridge_sync_sources before concluding the scanner platform has no findings. Do not invent vulnerabilities, file paths, severities, or remediation steps.',
  };
}

/** Detect demo, stale, or unconfigured finding provenance for MCP responses. */
export function findingProvenanceWarnings(
  context: FindingBridgeMcpContext,
  options: { includeStale?: boolean } = {}
): FindingBridgeProvenanceWarning[] {
  const observedTools = context.findings.listTools({ includeStale: options.includeStale });
  const redactedObservedTools = observedTools.map((tool) => redactSecrets(tool));
  if (observedTools.length === 0) {
    return [];
  }

  const configuredSources = context.runtime.configuredSources
    .filter((source) => source.enabled)
    .map((source) => ({
      id: redactSecrets(source.id),
      type: source.type,
      expected_tools: expectedToolsForSource(source.type),
    }));

  if (context.runtime.demoMode) {
    return [
      {
        code: 'demo_data',
        message: 'This MCP server is running in demo mode, so findings come from bundled sample data.',
        configured_sources: configuredSources,
        observed_tools: redactedObservedTools,
        remediation_steps: demoDataRemediationSteps(),
        agent_instruction:
          'Tell the user these are demo findings. Do not present them as code review platform results. Restart without demo mode and call findingbridge_sync_sources before reading current platform findings.',
      },
    ];
  }

  if (configuredSources.length === 0) {
    return [
      {
        code: 'unconfigured_findings',
        message: 'The database contains findings, but no enabled scanner sources are configured for this MCP server.',
        configured_sources: configuredSources,
        observed_tools: redactedObservedTools,
        remediation_steps: staleDatabaseRemediationSteps(),
        agent_instruction:
          'Treat these as local/stale/imported findings until the user confirms which scanner produced them. If configured sources exist, call findingbridge_sync_sources before reporting current platform findings. Tell the user to clear or replace the stale database before importing current scanner results.',
      },
    ];
  }

  const expected = new Set(configuredSources.flatMap((source) => source.expected_tools.map(normalizeToolName)));
  const mismatchedTools = observedTools.filter((tool) => !expected.has(normalizeToolName(tool)));
  if (mismatchedTools.length === 0) {
    return [];
  }

  return [
    {
      code: 'source_tool_mismatch',
      message:
        'The database contains findings from scanner tools that do not match the currently configured FindingBridge sources.',
      configured_sources: configuredSources,
      observed_tools: redactedObservedTools,
      remediation_steps: staleDatabaseRemediationSteps(),
      agent_instruction:
        'Warn the user that these findings may be stale, demo, or manually imported data rather than results from the configured code review platform. Call findingbridge_sync_sources before reporting current platform findings; if synchronization cannot fix the mismatch, tell them to clear or replace the stale database, then import current platform results before relying on the findings.',
    },
  ];
}

function staleDatabaseRemediationSteps(): string[] {
  return [
    'Call `findingbridge_sync_sources` before reading summary or list data when the user asks for current or latest scanner platform results.',
    'Do not treat the current findings as results from the configured code review platform until the database has been rebuilt from that platform.',
    'Find the configured database path with `findingbridge config show`, then back up and delete that stale SQLite database file, or start the MCP server with a fresh database path using `findingbridge server --db path/to/findingbridge.db`.',
    'If the platform can export SARIF, export the latest results and import them with `findingbridge ingest --sarif path/to/results.sarif --db path/to/findingbridge.db` before restarting the MCP server.',
    'If the platform cannot export SARIF and FindingBridge has no adapter for it, add a scanner adapter before claiming platform-backed findings.',
  ];
}

function demoDataRemediationSteps(): string[] {
  return [
    'Restart FindingBridge without `--demo` before using real scanner results.',
    'Call `findingbridge_sync_sources` after restarting without demo mode and before reading summary or list data.',
    'Use a real configured database, or pass one explicitly with `findingbridge server --db path/to/findingbridge.db`.',
    'Import current scanner results first, for example `findingbridge ingest --sarif path/to/results.sarif --db path/to/findingbridge.db` when the platform can export SARIF.',
  ];
}

function expectedToolsForSource(sourceType: string): string[] {
  if (isSourceType(sourceType)) {
    return SOURCE_TOOL_ALIASES[sourceType] ?? [getSourceDisplayName(sourceType), sourceType];
  }

  return [sourceType];
}

function isSourceType(sourceType: string): sourceType is SourceType {
  return sourceType in SOURCE_TOOL_ALIASES;
}

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Convert a finding to a redacted response summary.
 *
 * Scanner titles and paths may contain user-controlled values, so string fields
 * are redacted even when they are not expected to hold secrets.
 */
export function summarizeFinding(finding: Finding): FindingSummary {
  return {
    id: finding.id,
    title: redactSecrets(finding.title),
    severity: finding.severity,
    status: finding.status,
    tool: redactSecrets(finding.source.tool),
    rule_id: redactSecrets(finding.source.rule_id),
    file_path: redactSecrets(finding.location.file_path),
    start_line: finding.location.start_line,
    cwe_id: finding.cwe_id,
    priority_score: finding.priority_score,
    is_duplicate: finding.is_duplicate,
    is_stale: finding.is_stale ?? false,
    duplicate_group_id: finding.duplicate_group_id,
    last_seen_at: finding.last_seen_at,
  };
}

/**
 * Return a finding or undefined without throwing.
 *
 * Tool handlers use this to keep not-found responses structured and actionable
 * instead of surfacing repository implementation details.
 */
export function getFinding(
  context: FindingBridgeMcpContext,
  findingId: string,
  options: { includeStale?: boolean } = {}
): Finding | undefined {
  const finding = context.findings.getById(findingId);
  if (!finding || options.includeStale) {
    return finding;
  }
  return finding.is_stale || finding.is_current_scope === false ? undefined : finding;
}

/**
 * Redact and cap a finding code snippet.
 *
 * The max line count is constrained before calling the shared redaction helper
 * to enforce the MCP privacy rule that responses include only minimal context.
 */
export function safeCodeSnippet(finding: Finding, contextLines: number): string | undefined {
  if (!finding.location.code_snippet) {
    return undefined;
  }

  return redactCodeSnippet(finding.location.code_snippet, Math.min(contextLines, 20));
}

/**
 * List findings for a report or deduplication scope.
 *
 * When explicit finding IDs are provided they take precedence over broader
 * filters because callers are asking for an exact working set.
 */
export function listFindingsForScope(
  context: FindingBridgeMcpContext,
  scope: {
    finding_ids?: string[];
    severity?: Finding['severity'][];
    tool?: string[];
    status?: Finding['status'][];
    file_path?: string;
    include_stale?: boolean;
  }
): Finding[] {
  if (scope.finding_ids?.length) {
    return scope.finding_ids
      .map((findingId) => getFinding(context, findingId, { includeStale: scope.include_stale }))
      .filter((finding): finding is Finding => finding !== undefined);
  }

  return context.findings.list({
    severity: scope.severity,
    tool: scope.tool,
    status: scope.status,
    file_path: scope.file_path,
    limit: MAX_SCOPE_LIMIT,
    offset: 0,
    sort_by: 'priority_score',
    includeStale: scope.include_stale,
  }).findings;
}

/**
 * Build a redacted location string for human-readable explanation text.
 *
 * Keeping this formatting centralized prevents subtle differences between MCP
 * tools that could confuse clients comparing outputs.
 */
export function formatFindingLocation(finding: Finding): string {
  return `${redactSecrets(finding.location.file_path)}:${finding.location.start_line}`;
}
