import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { redactSecrets } from '../../utils/redaction.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { GetFindingDetailInput } from '../tool-schemas.js';
import { toolError, toolException, toolSuccess } from '../tool-result.js';
import { formatFindingLocation, getFinding, safeCodeSnippet, summarizeFinding } from './shared.js';

/**
 * Return redacted detail for one finding.
 *
 * Code context is capped at 20 lines and passed through secret redaction to keep
 * MCP responses aligned with FindingBridge privacy rules.
 */
export function getFindingDetailTool(
  context: FindingBridgeMcpContext,
  input: GetFindingDetailInput
): CallToolResult {
  try {
    const finding = getFinding(context, input.finding_id);
    if (!finding) {
      return toolError('finding_not_found', `Finding '${input.finding_id}' was not found.`, [
        'Call findingbridge_list_findings to discover valid finding IDs.',
        'Re-run ingestion if the finding should exist but is missing.',
      ]);
    }

    const rule = context.rules.getByToolRule(finding.source.tool, finding.source.rule_id);
    const codeContext = input.include_code_context ? safeCodeSnippet(finding, input.context_lines) : undefined;

    return toolSuccess({
      finding: {
        ...summarizeFinding(finding),
        message: redactSecrets(finding.message),
        raw_severity: redactSecrets(finding.raw_severity),
        location: {
          file_path: redactSecrets(finding.location.file_path),
          start_line: finding.location.start_line,
          start_column: finding.location.start_column ?? null,
          end_line: finding.location.end_line ?? null,
          end_column: finding.location.end_column ?? null,
          display: formatFindingLocation(finding),
          code_context: codeContext ?? null,
          code_context_lines: codeContext ? codeContext.split('\n').length : 0,
        },
        source: {
          tool: redactSecrets(finding.source.tool),
          tool_version: finding.source.tool_version ? redactSecrets(finding.source.tool_version) : null,
          rule_id: redactSecrets(finding.source.rule_id),
          rule_name: finding.source.rule_name ? redactSecrets(finding.source.rule_name) : null,
          rule_description: finding.source.rule_description
            ? redactSecrets(finding.source.rule_description)
            : null,
          rule_help_url: finding.source.rule_help_url ? redactSecrets(finding.source.rule_help_url) : null,
          original_id: redactSecrets(finding.source.original_id),
          original_url: finding.source.original_url ? redactSecrets(finding.source.original_url) : null,
        },
        taxonomy: {
          cwe_id: finding.cwe_id ?? null,
          cwe_name: finding.cwe_name ? redactSecrets(finding.cwe_name) : null,
          owasp_category: finding.owasp_category ? redactSecrets(finding.owasp_category) : null,
        },
        fix_suggestion: finding.fix_suggestion
          ? {
              description: redactSecrets(finding.fix_suggestion.description),
              code_example: finding.fix_suggestion.code_example
                ? redactSecrets(finding.fix_suggestion.code_example)
                : null,
              effort_estimate: finding.fix_suggestion.effort_estimate
                ? redactSecrets(finding.fix_suggestion.effort_estimate)
                : null,
              breaking_risk: finding.fix_suggestion.breaking_risk ?? null,
            }
          : null,
        rule: rule
          ? {
              id: redactSecrets(rule.id),
              name: redactSecrets(rule.name),
              description: redactSecrets(rule.description),
              severity: rule.severity ? redactSecrets(rule.severity) : null,
              cwe_id: rule.cwe_id ?? null,
              owasp_category: rule.owasp_category ? redactSecrets(rule.owasp_category) : null,
              references: rule.references?.map((reference) => redactSecrets(reference)) ?? [],
            }
          : null,
      },
      privacy: {
        code_context_max_lines: 20,
        secrets_redacted: true,
        raw_scanner_data_returned: false,
      },
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Call findingbridge_list_findings to confirm the finding ID.',
      'Verify the FindingBridge database is readable.',
    ]);
  }
}
