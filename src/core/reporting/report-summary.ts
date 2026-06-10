import type { Finding } from '../models/finding.js';
import type { ReportSummary } from '../models/report.js';

/** Generate summary statistics from findings */
export function generateReportSummary(findings: Finding[]): ReportSummary {
  const summary: ReportSummary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    summary[finding.severity]++;
  }

  return summary;
}

/** Get top priority finding IDs */
export function getTopPriorities(findings: Finding[], limit = 5): string[] {
  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  const sorted = [...findings].sort((a, b) => {
    const sevDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return b.priority_score - a.priority_score;
  });

  return sorted
    .filter((f) => !f.is_duplicate)
    .slice(0, limit)
    .map((f) => f.id);
}
