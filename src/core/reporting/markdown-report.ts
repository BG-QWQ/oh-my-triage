import type { Finding } from '../models/finding.js';
import { generateReportSummary, getTopPriorities } from './report-summary.js';

export interface MarkdownReport {
  title: string;
  content: string;
  summary: ReturnType<typeof generateReportSummary>;
  topPriorities: string[];
}

const SEVERITY_ORDER: Finding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];

/** Generate a Markdown report from findings */
export function generateMarkdownReport(
  findings: Finding[],
  options: {
    title?: string;
    includeRecommendations?: boolean;
    language?: string;
  } = {}
): MarkdownReport {
  const title = options.title ?? 'Security Findings Report';
  const summary = generateReportSummary(findings);
  const topPriorities = getTopPriorities(findings);

  let content = `# ${title}\n\n`;
  content += `Generated: ${new Date().toISOString()}\n\n`;
  content += renderSummarySection(summary);
  content += renderTopPrioritiesSection(findings, topPriorities);

  if (options.includeRecommendations !== false) {
    content += renderAllFindingsSection(findings);
  }

  return {
    title,
    content,
    summary,
    topPriorities,
  };
}

/** Render aggregate severity counts for a report. */
function renderSummarySection(summary: MarkdownReport['summary']): string {
  return [
    '## Summary',
    '',
    `- **Total findings**: ${summary.total}`,
    `- **Critical**: ${summary.critical}`,
    `- **High**: ${summary.high}`,
    `- **Medium**: ${summary.medium}`,
    `- **Low**: ${summary.low}`,
    `- **Info**: ${summary.info}`,
    '',
    '',
  ].join('\n');
}

/** Render the prioritized finding summary section. */
function renderTopPrioritiesSection(findings: Finding[], topPriorities: string[]): string {
  if (topPriorities.length === 0) {
    return '';
  }

  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const lines = ['## Top Priorities', ''];
  for (const id of topPriorities) {
    const finding = findingsById.get(id);
    if (finding) {
      lines.push(...renderTopPriorityLines(finding));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Render one top-priority finding entry. */
function renderTopPriorityLines(finding: Finding): string[] {
  const lines = [
    `- **${finding.id}** (${finding.severity}): ${finding.title}`,
    `  - Location: ${finding.location.file_path}:${finding.location.start_line}`,
    `  - Rule: ${finding.source.rule_id}`,
  ];
  if (finding.cwe_id) {
    lines.push(`  - CWE: ${finding.cwe_id}`);
  }
  lines.push('');
  return lines;
}

/** Render all findings in severity order. */
function renderAllFindingsSection(findings: Finding[]): string {
  const sorted = [...findings].sort(compareFindingSeverity);
  return `## All Findings\n\n${sorted.map(renderFindingSection).join('')}`;
}

/** Compare findings by unified severity order. */
function compareFindingSeverity(a: Finding, b: Finding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

/** Render one detailed finding section. */
function renderFindingSection(finding: Finding): string {
  let section = `### ${finding.id} — ${finding.title}\n\n`;
  section += `- **Severity**: ${finding.severity}\n`;
  section += `- **Status**: ${finding.status}\n`;
  section += `- **Location**: ${finding.location.file_path}:${finding.location.start_line}\n`;
  section += `- **Tool**: ${finding.source.tool}\n`;
  section += `- **Rule**: ${finding.source.rule_id}\n`;
  section += renderOptionalFindingMetadata(finding);
  section += `\n${finding.message}\n\n`;
  section += renderFixSuggestion(finding);
  return section;
}

/** Render optional finding metadata lines. */
function renderOptionalFindingMetadata(finding: Finding): string {
  let metadata = '';
  if (finding.cwe_id) {
    metadata += `- **CWE**: ${finding.cwe_id}\n`;
  }
  if (finding.is_duplicate) {
    metadata += `- **Duplicate**: Yes (group ${finding.duplicate_group_id})\n`;
  }
  return metadata;
}

/** Render a finding fix suggestion when present. */
function renderFixSuggestion(finding: Finding): string {
  if (!finding.fix_suggestion) {
    return '';
  }

  let suggestion = `**Fix Suggestion**: ${finding.fix_suggestion.description}\n`;
  if (finding.fix_suggestion.code_example) {
    suggestion += `\n\`\`\`${codeFenceLanguage(finding)}\n${finding.fix_suggestion.code_example}\n\`\`\`\n`;
  }
  return `${suggestion}\n`;
}

/** Infer the Markdown code fence language from the finding path. */
function codeFenceLanguage(finding: Finding): string {
  return finding.location.file_path.split('.').pop() ?? 'code';
}
