import type { Finding } from '../models/finding.js';
import { generateReportSummary, getTopPriorities } from './report-summary.js';

export interface MarkdownReport {
  title: string;
  content: string;
  summary: ReturnType<typeof generateReportSummary>;
  topPriorities: string[];
}

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

  // Summary section
  content += `## Summary\n\n`;
  content += `- **Total findings**: ${summary.total}\n`;
  content += `- **Critical**: ${summary.critical}\n`;
  content += `- **High**: ${summary.high}\n`;
  content += `- **Medium**: ${summary.medium}\n`;
  content += `- **Low**: ${summary.low}\n`;
  content += `- **Info**: ${summary.info}\n\n`;

  // Top priorities
  if (topPriorities.length > 0) {
    content += `## Top Priorities\n\n`;
    for (const id of topPriorities) {
      const finding = findings.find((f) => f.id === id);
      if (finding) {
        content += `- **${finding.id}** (${finding.severity}): ${finding.title}\n`;
        content += `  - Location: ${finding.location.file_path}:${finding.location.start_line}\n`;
        content += `  - Rule: ${finding.source.rule_id}\n`;
        if (finding.cwe_id) {
          content += `  - CWE: ${finding.cwe_id}\n`;
        }
        content += `\n`;
      }
    }
  }

  // Detailed findings
  if (options.includeRecommendations !== false) {
    content += `## All Findings\n\n`;
    const sorted = [...findings].sort((a, b) => {
      const order = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    });

    for (const finding of sorted) {
      content += `### ${finding.id} — ${finding.title}\n\n`;
      content += `- **Severity**: ${finding.severity}\n`;
      content += `- **Status**: ${finding.status}\n`;
      content += `- **Location**: ${finding.location.file_path}:${finding.location.start_line}\n`;
      content += `- **Tool**: ${finding.source.tool}\n`;
      content += `- **Rule**: ${finding.source.rule_id}\n`;
      if (finding.cwe_id) {
        content += `- **CWE**: ${finding.cwe_id}\n`;
      }
      if (finding.is_duplicate) {
        content += `- **Duplicate**: Yes (group ${finding.duplicate_group_id})\n`;
      }
      content += `\n${finding.message}\n\n`;

      if (finding.fix_suggestion) {
        content += `**Fix Suggestion**: ${finding.fix_suggestion.description}\n`;
        if (finding.fix_suggestion.code_example) {
          content += `\n\`\`\`${finding.location.file_path.split('.').pop() ?? 'code'}\n${finding.fix_suggestion.code_example}\n\`\`\`\n`;
        }
        content += `\n`;
      }
    }
  }

  return {
    title,
    content,
    summary,
    topPriorities,
  };
}
