import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Rule } from '../../core/models/rule.js';
import type { Finding } from '../../core/models/finding.js';
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
    const finding = getFinding(context, input.finding_id, { includeStale: input.include_stale });
    if (!finding) {
      return toolError('finding_not_found', `Finding '${input.finding_id}' was not found.`, [
        'Call findingbridge_list_findings to discover valid finding IDs.',
        'If you intentionally need historical findings, retry with include_stale set to true.',
        'Re-run ingestion if the finding should exist but is missing.',
      ]);
    }

    const rule = context.rules.getByToolRule(finding.source.tool, finding.source.rule_id);
    const codeContext = input.include_code_context ? safeCodeSnippet(finding, input.context_lines) : undefined;

    return toolSuccess({
      finding: buildFindingDetail(finding, rule, codeContext),
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

/** Build a redacted finding detail payload. */
function buildFindingDetail(finding: Finding, rule: Rule | undefined, codeContext: string | undefined): Record<string, unknown> {
  return {
    ...summarizeFinding(finding),
    message: redactSecrets(finding.message),
    raw_severity: redactSecrets(finding.raw_severity),
    location: buildLocationDetail(finding, codeContext),
    source: buildSourceDetail(finding),
    taxonomy: buildTaxonomyDetail(finding),
    fix_suggestion: buildFixSuggestionDetail(finding),
    rule: buildRuleDetail(rule),
  };
}

/** Build a redacted location payload with optional code context. */
function buildLocationDetail(finding: Finding, codeContext: string | undefined): Record<string, unknown> {
  return {
    file_path: redactSecrets(finding.location.file_path),
    start_line: finding.location.start_line,
    start_column: finding.location.start_column ?? null,
    end_line: finding.location.end_line ?? null,
    end_column: finding.location.end_column ?? null,
    display: formatFindingLocation(finding),
    code_context: codeContext ?? null,
    code_context_lines: codeContext ? codeContext.split('\n').length : 0,
  };
}

/** Build a redacted scanner source payload. */
function buildSourceDetail(finding: Finding): Record<string, unknown> {
  return {
    tool: redactSecrets(finding.source.tool),
    tool_version: redactOptional(finding.source.tool_version),
    rule_id: redactSecrets(finding.source.rule_id),
    rule_name: redactOptional(finding.source.rule_name),
    rule_description: redactOptional(finding.source.rule_description),
    rule_help_url: redactOptional(finding.source.rule_help_url),
    original_id: redactSecrets(finding.source.original_id),
    original_url: redactOptional(finding.source.original_url),
  };
}

/** Build redacted taxonomy metadata. */
function buildTaxonomyDetail(finding: Finding): Record<string, unknown> {
  return {
    cwe_id: finding.cwe_id ?? null,
    cwe_name: redactOptional(finding.cwe_name),
    owasp_category: redactOptional(finding.owasp_category),
  };
}

/** Build a redacted fix-suggestion payload when present. */
function buildFixSuggestionDetail(finding: Finding): Record<string, unknown> | null {
  if (!finding.fix_suggestion) {
    return null;
  }

  return {
    description: redactSecrets(finding.fix_suggestion.description),
    code_example: redactOptional(finding.fix_suggestion.code_example),
    effort_estimate: redactOptional(finding.fix_suggestion.effort_estimate),
    breaking_risk: finding.fix_suggestion.breaking_risk ?? null,
  };
}

/** Build a redacted rule payload when rule metadata exists. */
function buildRuleDetail(rule: Rule | undefined): Record<string, unknown> | null {
  if (!rule) {
    return null;
  }

  return {
    id: redactSecrets(rule.id),
    name: redactSecrets(rule.name),
    description: redactSecrets(rule.description),
    severity: redactOptional(rule.severity),
    cwe_id: rule.cwe_id ?? null,
    owasp_category: redactOptional(rule.owasp_category),
    references: rule.references?.map((reference) => redactSecrets(reference)) ?? [],
  };
}

/** Redact an optional string and normalize absence to null. */
function redactOptional(value: string | undefined): string | null {
  return value ? redactSecrets(value) : null;
}
