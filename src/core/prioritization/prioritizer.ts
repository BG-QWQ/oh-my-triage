import { BASE_SEVERITY_SCORE } from '../models/common.js';
import type { Finding } from '../models/finding.js';

export interface PrioritizeResult {
  finding_id: string;
  rank: number;
  score: number;
  reasoning: string;
}

export interface PrioritizeContext {
  is_public_facing?: boolean;
  handles_sensitive_data?: boolean;
  recent_breaches_in_cwe?: boolean;
}

/** Calculate priority score for a finding */
export function calculatePriorityScore(
  finding: Finding,
  context?: PrioritizeContext
): number {
  let score = BASE_SEVERITY_SCORE[finding.severity];

  // Context adjustments
  if (context?.is_public_facing) score += 10;
  if (context?.handles_sensitive_data) score += 10;
  if (context?.recent_breaches_in_cwe && finding.cwe_id) score += 5;

  // Deduplication penalty
  if (finding.is_duplicate) score -= 10;

  // Cap to 0-100
  return Math.max(0, Math.min(100, score));
}

/** Prioritize findings and return ranked results */
export function prioritizeFindings(
  findings: Finding[],
  context?: PrioritizeContext
): PrioritizeResult[] {
  const scored = findings.map((finding) => {
    const score = calculatePriorityScore(finding, context);
    let reasoning = `${finding.severity} severity`;
    if (finding.cwe_id) reasoning += `, ${finding.cwe_id}`;
    if (finding.is_duplicate) reasoning += ', marked as duplicate';
    if (context?.is_public_facing && finding.severity !== 'info') reasoning += ', public-facing code';

    return {
      finding_id: finding.id,
      score,
      reasoning,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}
