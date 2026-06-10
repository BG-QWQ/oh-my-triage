import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { prioritizeFindings } from '../../core/prioritization/prioritizer.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { PrioritizeFindingsInput } from '../tool-schemas.js';
import { toolException, toolSuccess } from '../tool-result.js';
import { getFinding, summarizeFinding } from './shared.js';

/**
 * Rank selected findings by severity, context, and duplicate status.
 *
 * Missing IDs are reported separately so callers can correct stale selections
 * without treating the entire prioritization request as a protocol error.
 */
export function prioritizeFindingsTool(
  context: FindingBridgeMcpContext,
  input: PrioritizeFindingsInput
): CallToolResult {
  try {
    const findings = input.finding_ids
      .map((findingId) => getFinding(context, findingId))
      .filter((finding) => finding !== undefined);
    const foundIds = new Set(findings.map((finding) => finding.id));
    const missing_ids = input.finding_ids.filter((findingId) => !foundIds.has(findingId));
    const ranked = prioritizeFindings(findings, input.context);

    return toolSuccess({
      prioritized_findings: ranked.map((result) => {
        const finding = findings.find((candidate) => candidate.id === result.finding_id);
        return {
          ...result,
          criteria: input.criteria,
          finding: finding ? summarizeFinding(finding) : null,
        };
      }),
      missing_ids,
      context: input.context,
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Call findingbridge_list_findings to refresh the finding IDs before prioritizing.',
    ]);
  }
}
