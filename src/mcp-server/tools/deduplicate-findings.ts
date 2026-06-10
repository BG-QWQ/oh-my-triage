import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { previewDuplicates } from '../../core/deduplication/matcher.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { DeduplicateFindingsInput } from '../tool-schemas.js';
import { toolError, toolException, toolSuccess } from '../tool-result.js';
import { listFindingsForScope, summarizeFinding } from './shared.js';

/**
 * Preview duplicate groups without mutating the database.
 *
 * The dry_run flag remains visible in the output, but this tool never calls the
 * repository mutation API because MCP tools in the MVP are read-only.
 */
export function deduplicateFindingsTool(
  context: FindingBridgeMcpContext,
  input: DeduplicateFindingsInput
): CallToolResult {
  try {
    if (!input.dry_run) {
      return toolError('read_only_tool', 'findingbridge_deduplicate_findings is preview-only.', [
        'Re-run with dry_run set to true or omit dry_run to use the default preview mode.',
        'Use a future non-MCP administrative command if persistent duplicate marking is required.',
      ]);
    }

    const findings = listFindingsForScope(context, input.scope);
    const duplicateGroups = previewDuplicates(findings);

    return toolSuccess({
      dry_run: true,
      scanned_count: findings.length,
      duplicate_group_count: duplicateGroups.length,
      duplicate_groups: duplicateGroups.map((group) => ({
        group_id: group.group_id,
        match_level: group.match_level,
        confidence: group.confidence,
        representative: summarizeFinding(group.representative),
        duplicates: group.duplicates.map(summarizeFinding),
      })),
      database_modified: false,
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Narrow the scope if the database has a very large number of findings.',
      'Call findingbridge_list_findings to inspect candidate findings before deduplication.',
    ]);
  }
}
