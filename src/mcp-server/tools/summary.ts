import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FindingBridgeMcpContext } from '../context.js';
import { toolException, toolSuccess } from '../tool-result.js';
import { findingDataAvailability, globalFindingScope } from './shared.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

/**
 * Summarize findings without implying current-project coverage.
 *
 * FindingBridge currently stores a local normalized database rather than a
 * per-repository tenant model, so the response includes explicit scope metadata
 * telling agents not to infer findings for the repository they are reviewing.
 */
export function summaryTool(context: FindingBridgeMcpContext): CallToolResult {
  try {
    const severityCounts = context.findings.countBySeverity();
    const total = SEVERITIES.reduce((sum, severity) => sum + (severityCounts[severity] ?? 0), 0);

    return toolSuccess({
      severity_counts: severityCounts,
      total,
      has_findings: total > 0,
      data_availability: findingDataAvailability(total),
      scope: globalFindingScope(),
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Verify the FindingBridge database path is correct.',
      'Run an ingest command before summarizing findings if the database is empty.',
    ]);
  }
}
