import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { ListFindingsInput } from '../tool-schemas.js';
import { toolException, toolSuccess } from '../tool-result.js';
import { findingDataAvailability, findingProvenanceWarnings, globalFindingScope, summarizeFinding } from './shared.js';

/**
 * List normalized findings with scanner-neutral finding filters.
 *
 * The response intentionally contains summaries rather than raw scanner data so
 * clients can page through large result sets without leaking excessive context.
 * `rule_id` is exact, and `file_path` targets stored finding locations rather
 * than scanner project keys or repository names.
 */
export function listFindingsTool(
  context: FindingBridgeMcpContext,
  input: ListFindingsInput
): CallToolResult {
  try {
    const result = context.findings.list({
      severity: input.severity,
      tool: input.tool,
      status: input.status,
      rule_id: input.rule_id,
      file_path: input.file_path,
      limit: input.limit,
      offset: input.offset,
      sort_by: input.sort_by,
      includeStale: input.include_stale ?? false,
    });

    return toolSuccess({
      findings: result.findings.map(summarizeFinding),
      total: result.total,
      has_findings: result.total > 0,
      data_availability: findingDataAvailability(result.total),
      scope: globalFindingScope(),
      provenance_warnings: findingProvenanceWarnings(context, { includeStale: input.include_stale ?? false }),
      pagination: {
        total: result.total,
        limit: input.limit,
        offset: input.offset,
        has_more: input.offset + result.findings.length < result.total,
      },
      filters: {
        severity: input.severity ?? [],
        tool: input.tool ?? [],
        status: input.status ?? [],
        rule_id: input.rule_id ?? null,
        file_path: input.file_path ?? null,
        sort_by: input.sort_by,
        include_stale: input.include_stale ?? false,
      },
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Verify the FindingBridge database path is correct.',
      'Run an ingest command before listing findings if the database is empty.',
    ]);
  }
}
