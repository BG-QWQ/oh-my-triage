import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { redactSecrets } from '../../utils/redaction.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { ExplainFindingInput } from '../tool-schemas.js';
import { toolError, toolException, toolSuccess } from '../tool-result.js';
import { formatFindingLocation, getFinding, summarizeFinding } from './shared.js';

/**
 * Explain a finding using local normalized metadata only.
 *
 * This tool deliberately avoids external LLM calls so FindingBridge remains
 * self-hosted and does not upload scanner findings to third-party services.
 */
export function explainFindingTool(
  context: FindingBridgeMcpContext,
  input: ExplainFindingInput
): CallToolResult {
  try {
    const finding = getFinding(context, input.finding_id, { includeStale: input.include_stale });
    if (!finding) {
      return toolError('finding_not_found', `Finding '${input.finding_id}' was not found.`, [
        'Call findingbridge_list_findings to discover valid finding IDs.',
        'If you intentionally need historical findings, retry with include_stale set to true.',
      ]);
    }

    const rule = context.rules.getByToolRule(finding.source.tool, finding.source.rule_id);
    const taxonomy = [finding.cwe_id, finding.cwe_name, finding.owasp_category].filter(Boolean).join(', ');
    const taxonomyNote = taxonomy ? ` associated with ${taxonomy}` : '';
    const audienceNote = buildAudienceNote(input.audience, finding.severity);

    return toolSuccess({
      finding: summarizeFinding(finding),
      explanation: {
        summary: redactSecrets(`${finding.title} was reported at ${formatFindingLocation(finding)}.`),
        what_it_means: redactSecrets(
          rule?.description ?? finding.source.rule_description ?? finding.message
        ),
        why_it_matters: redactSecrets(
          `${finding.severity.toUpperCase()} severity finding${taxonomyNote}. ${audienceNote}`
        ),
        likely_cause: redactSecrets(
          finding.message ?? rule?.name ?? 'The scanner matched this location to a known rule pattern.'
        ),
        affected_area: {
          file_path: redactSecrets(finding.location.file_path),
          start_line: finding.location.start_line,
          rule_id: redactSecrets(finding.source.rule_id),
          tool: redactSecrets(finding.source.tool),
        },
        confidence: rule ? 'rule_metadata_available' : 'scanner_finding_only',
        audience: input.audience,
        language: input.language,
      },
      constraints: {
        external_llm_called: false,
        raw_scanner_data_returned: false,
      },
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Call findingbridge_get_finding_detail for the same ID to inspect available metadata.',
    ]);
  }
}

function buildAudienceNote(audience: ExplainFindingInput['audience'], severity: string): string {
  if (audience === 'manager') {
    return severity === 'critical' || severity === 'high'
      ? 'Prioritize owner assignment because the business risk may be material.'
      : 'Track with normal remediation planning unless local context increases impact.';
  }

  if (audience === 'security') {
    return 'Validate exploitability, asset exposure, and whether related findings share the same root cause.';
  }

  return 'Inspect the referenced code path and apply the smallest safe remediation that addresses the root cause.';
}
