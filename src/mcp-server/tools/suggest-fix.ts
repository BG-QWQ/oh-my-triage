import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { redactSecrets } from '../../utils/redaction.js';
import type { FixPattern } from '../../core/models/rule.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { SuggestFixInput } from '../tool-schemas.js';
import { toolError, toolException, toolSuccess } from '../tool-result.js';
import { getFinding, summarizeFinding } from './shared.js';

/**
 * Suggest remediation guidance without generating a patch.
 *
 * Suggestions combine stored finding guidance and rule fix patterns so agents
 * can plan remediation while FindingBridge remains a read-only triage layer.
 */
export function suggestFixTool(
  context: FindingBridgeMcpContext,
  input: SuggestFixInput
): CallToolResult {
  try {
    const finding = getFinding(context, input.finding_id);
    if (!finding) {
      return toolError('finding_not_found', `Finding '${input.finding_id}' was not found.`, [
        'Call findingbridge_list_findings to discover valid finding IDs.',
      ]);
    }

    const rule = context.rules.getByToolRule(finding.source.tool, finding.source.rule_id);
    const patterns = rule?.fix_patterns ?? [];
    const storedSuggestion = finding.fix_suggestion;

    return toolSuccess({
      finding: summarizeFinding(finding),
      approach: input.approach,
      suggestions: {
        primary: redactSecrets(storedSuggestion?.description ?? buildDefaultSuggestion(input.approach)),
        steps: buildSteps(input.approach, Boolean(storedSuggestion), patterns).map((step) => redactSecrets(step)),
        code_example: storedSuggestion?.code_example ? redactSecrets(storedSuggestion.code_example) : null,
        effort_estimate: storedSuggestion?.effort_estimate ? redactSecrets(storedSuggestion.effort_estimate) : null,
        breaking_risk: storedSuggestion?.breaking_risk ?? estimateBreakingRisk(patterns),
        rule_fix_patterns: patterns.map((pattern) => formatFixPattern(pattern)),
      },
      constraints: {
        patch_generated: false,
        repository_modified: false,
        external_llm_called: false,
      },
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Call findingbridge_get_finding_detail to inspect available fix metadata.',
    ]);
  }
}

function buildDefaultSuggestion(approach: SuggestFixInput['approach']): string {
  if (approach === 'robust') {
    return 'Address the root cause, add a regression test for the scanner scenario, and verify related call paths.';
  }

  if (approach === 'educational') {
    return 'Understand why the rule matched, fix the unsafe pattern, and document the safer idiom for future changes.';
  }

  return 'Apply the smallest source change that removes the scanner finding while preserving current behavior.';
}

function buildSteps(
  approach: SuggestFixInput['approach'],
  hasStoredSuggestion: boolean,
  patterns: FixPattern[]
): string[] {
  const steps = [
    'Confirm the finding is reachable and not already fixed.',
    hasStoredSuggestion
      ? 'Use the stored scanner remediation guidance as the starting point.'
      : 'Identify the unsafe pattern reported by the rule metadata and message.',
  ];

  if (patterns.length > 0) {
    steps.push('Compare the code against the available rule fix patterns before editing.');
  }

  if (approach === 'robust') {
    steps.push('Search for sibling occurrences of the same rule and fix the shared root cause.');
  }

  if (approach === 'educational') {
    steps.push('Record why the safer pattern prevents recurrence so reviewers can validate intent.');
  }

  steps.push('Run the scanner or related tests after applying any separate code change.');
  return steps;
}

function estimateBreakingRisk(patterns: FixPattern[]): 'none' | 'low' | 'medium' | 'high' | null {
  if (patterns.length === 0) {
    return null;
  }

  const riskOrder: Array<'none' | 'low' | 'medium' | 'high'> = ['none', 'low', 'medium', 'high'];
  let highestRisk: 'none' | 'low' | 'medium' | 'high' = 'none';

  for (const pattern of patterns) {
    if (riskOrder.indexOf(pattern.breaking_risk) > riskOrder.indexOf(highestRisk)) {
      highestRisk = pattern.breaking_risk;
    }
  }

  return highestRisk;
}

function formatFixPattern(pattern: FixPattern): Record<string, unknown> {
  return {
    id: redactSecrets(pattern.id),
    name: redactSecrets(pattern.name),
    description: redactSecrets(pattern.description),
    applicable_languages: pattern.applicable_languages.map((language) => redactSecrets(language)),
    prerequisites: pattern.prerequisites.map((prerequisite) => redactSecrets(prerequisite)),
    breaking_risk: pattern.breaking_risk,
  };
}
