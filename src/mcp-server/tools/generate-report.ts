import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { generateMarkdownReport } from '../../core/reporting/markdown-report.js';
import { generateReportSummary, getTopPriorities } from '../../core/reporting/report-summary.js';
import { redactSecrets } from '../../utils/redaction.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { GenerateReportInput } from '../tool-schemas.js';
import { toolException, toolSuccess } from '../tool-result.js';
import { listFindingsForScope, summarizeFinding } from './shared.js';

/**
 * Generate an inline findings report.
 *
 * Reports return content directly rather than writing files so MCP clients can
 * decide where to display or persist results without server-side side effects.
 */
export function generateReportTool(
  context: FindingBridgeMcpContext,
  input: GenerateReportInput
): CallToolResult {
  try {
    const findings = listFindingsForScope(context, input.scope);
    const summary = generateReportSummary(findings);
    const topPriorities = getTopPriorities(findings);

    if (input.format === 'markdown') {
      const report = generateMarkdownReport(findings, {
        includeRecommendations: input.include_recommendations,
        language: input.language,
      });

      return toolSuccess({
        format: 'markdown',
        content: redactSecrets(report.content),
        summary: report.summary,
        top_priorities: report.topPriorities,
        generated_at: new Date().toISOString(),
        file_path: null,
      });
    }

    return toolSuccess({
      format: 'json',
      content: {
        generated_at: new Date().toISOString(),
        language: input.language,
        summary,
        top_priorities: topPriorities,
        recommendations_included: input.include_recommendations,
        findings: findings.map((finding) => ({
          ...summarizeFinding(finding),
          recommendation: input.include_recommendations
            ? redactSecrets(
                finding.fix_suggestion?.description ??
                  'Review the finding detail and apply the smallest safe remediation.'
              )
            : null,
        })),
      },
      file_path: null,
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Narrow the report scope if the database has a very large number of findings.',
      'Call findingbridge_list_findings to verify the requested report scope.',
    ]);
  }
}
