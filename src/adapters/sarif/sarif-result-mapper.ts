import type { Finding } from '../../core/models/finding.js';
import { FindingStatus } from '../../core/models/common.js';
import { mapFields } from '../../core/normalization/field-mapper.js';
import { normalizeSeverity } from '../../core/normalization/severity-mapper.js';
import { generateFingerprint } from '../../utils/hash.js';
import { redactCodeSnippet } from '../../utils/redaction.js';
import type { SarifResult, SarifRule, SarifRun } from './sarif-schema.js';

/** Options that control how SARIF locations are normalized. */
export type SarifMappingOptions = {
  projectRoot?: string;
  now?: string;
};

/** Map every result from a SARIF run into oh-my-triage findings. */
export function mapSarifRunToFindings(run: SarifRun, options: SarifMappingOptions = {}): Finding[] {
  const rules = buildRuleIndex(run);
  return (run.results ?? []).map((result, index) => mapSarifResultToFinding(run, result, index, rules, options));
}

/** Map a single SARIF result into the canonical Finding model. */
export function mapSarifResultToFinding(
  run: SarifRun,
  result: SarifResult,
  index: number,
  rules: Map<string, SarifRule> = buildRuleIndex(run),
  options: SarifMappingOptions = {}
): Finding {
  const toolName = run.tool.driver.name;
  const ruleId = result.ruleId ?? ruleIdFromIndex(run, result.ruleIndex) ?? 'unknown-rule';
  const rule = rules.get(ruleId);
  const message = messageText(result.message) || 'SARIF result did not include a message.';
  const location = firstPhysicalLocation(result);
  const filePath = location?.physicalLocation?.artifactLocation?.uri ?? 'unknown';
  const region = location?.physicalLocation?.region;
  const startLine = region?.startLine ?? 1;
  const rawSeverity = result.level ?? rule?.defaultConfiguration?.level ?? severityFromProperties(result.properties) ?? 'warning';
  const mapped = mapFields({
    tool: toolName,
    ruleId,
    ruleName: rule?.name ?? messageText(rule?.shortDescription),
    ruleDescription: messageText(rule?.fullDescription) ?? messageText(rule?.help),
    ruleHelpUrl: rule?.helpUri,
    originalId: originalResultId(result, run, index),
    message,
    filePath,
    startLine,
    startColumn: region?.startColumn,
    endLine: region?.endLine,
    endColumn: region?.endColumn,
    cweId: cweFromRule(rule) ?? cweFromProperties(result.properties),
    projectRoot: options.projectRoot,
  });
  const now = options.now ?? new Date().toISOString();
  const fingerprint = generateFingerprint({
    tool: mapped.source.tool,
    ruleId: mapped.source.rule_id,
    filePath: mapped.location.file_path,
    startLine: mapped.location.start_line,
    message,
  });
  const codeSnippet = region?.snippet?.text ? redactCodeSnippet(region.snippet.text) : undefined;

  return {
    id: `fb-${fingerprint.slice(0, 24)}`,
    source: {
      ...mapped.source,
      tool_version: run.tool.driver.semanticVersion ?? run.tool.driver.version,
    },
    title: mapped.title,
    message,
    severity: normalizeSeverity(rawSeverity, sourceTypeForTool(toolName)),
    raw_severity: rawSeverity,
    cwe_id: mapped.source.rule_description ? mapped.source.rule_description.match(/CWE-\d+/)?.[0] : cweFromRule(rule),
    owasp_category: owaspFromProperties(result.properties) ?? owaspFromRule(rule),
    location: {
      ...mapped.location,
      code_snippet: codeSnippet,
    },
    status: FindingStatus.enum.open,
    fingerprint,
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: now,
    last_seen_at: now,
    raw_data: result,
  };
}

/** Build a lookup of SARIF rules from driver and extension tool components. */
export function buildRuleIndex(run: SarifRun): Map<string, SarifRule> {
  const rules = new Map<string, SarifRule>();
  for (const rule of run.tool.driver.rules ?? []) {
    rules.set(rule.id, rule);
  }
  for (const extension of run.tool.extensions ?? []) {
    for (const rule of extension.rules ?? []) {
      rules.set(rule.id, rule);
    }
  }
  return rules;
}

function firstPhysicalLocation(result: SarifResult) {
  return result.locations?.find((location) => location.physicalLocation) ?? result.locations?.[0];
}

function messageText(message?: { text?: string; markdown?: string }): string | undefined {
  return message?.text ?? message?.markdown;
}

function ruleIdFromIndex(run: SarifRun, ruleIndex?: number): string | undefined {
  if (ruleIndex === undefined) {
    return undefined;
  }
  return run.tool.driver.rules?.[ruleIndex]?.id;
}

function originalResultId(result: SarifResult, run: SarifRun, index: number): string {
  const fingerprint = result.fingerprints?.['primaryLocationLineHash'] ?? result.partialFingerprints?.['primaryLocationLineHash'];
  return fingerprint ?? `${run.tool.driver.name}:${result.ruleId ?? result.ruleIndex ?? 'unknown'}:${index}`;
}

function sourceTypeForTool(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized.includes('semgrep')) {
    return 'semgrep';
  }
  if (normalized.includes('trivy')) {
    return 'trivy';
  }
  return 'sarif';
}

function severityFromProperties(properties?: Record<string, unknown>): string | undefined {
  const severity = properties?.['severity'] ?? properties?.['problem.severity'] ?? properties?.['security-severity'];
  return typeof severity === 'string' ? severity : undefined;
}

function cweFromRule(rule?: SarifRule): string | undefined {
  const tags = rule?.properties?.['tags'];
  if (!Array.isArray(tags)) {
    return undefined;
  }
  return tags.find((tag): tag is string => typeof tag === 'string' && /^CWE-\d+$/i.test(tag))?.toUpperCase();
}

function cweFromProperties(properties?: Record<string, unknown>): string | undefined {
  const tags = properties?.['tags'];
  if (!Array.isArray(tags)) {
    return undefined;
  }
  return tags.find((tag): tag is string => typeof tag === 'string' && /^CWE-\d+$/i.test(tag))?.toUpperCase();
}

function owaspFromProperties(properties?: Record<string, unknown>): string | undefined {
  const tags = properties?.['tags'];
  if (!Array.isArray(tags)) {
    return undefined;
  }
  return tags.find((tag): tag is string => typeof tag === 'string' && /^OWASP/i.test(tag));
}

function owaspFromRule(rule?: SarifRule): string | undefined {
  const tags = rule?.properties?.['tags'];
  if (!Array.isArray(tags)) {
    return undefined;
  }
  return tags.find((tag): tag is string => typeof tag === 'string' && /^OWASP/i.test(tag));
}
