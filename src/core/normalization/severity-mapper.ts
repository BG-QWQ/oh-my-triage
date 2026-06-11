import { UnifiedSeverity, SEVERITY_MAP } from '../models/common.js';

/** Map a scanner-native severity string to the unified five-level scale */
export function normalizeSeverity(rawSeverity: string, tool: string): UnifiedSeverity {
  const normalizedRaw = rawSeverity.toLowerCase().trim();
  const mapping = SEVERITY_MAP[tool.toLowerCase()];

  if (mapping?.[normalizedRaw]) {
    return mapping[normalizedRaw];
  }

  // Fallback: try direct mapping from common severity strings
  const directMap: Record<string, UnifiedSeverity> = {
    critical: 'critical',
    blocker: 'critical',
    error: 'high',
    high: 'high',
    warning: 'medium',
    major: 'medium',
    middle: 'medium',
    medium: 'medium',
    minor: 'low',
    note: 'low',
    low: 'low',
    info: 'info',
    informational: 'info',
    none: 'info',
    unknown: 'info',
  };

  if (directMap[normalizedRaw]) {
    return directMap[normalizedRaw];
  }

  // Default fallback
  return 'info';
}

/** Get all severity levels in order of severity (most severe first) */
export function severityOrder(): UnifiedSeverity[] {
  return ['critical', 'high', 'medium', 'low', 'info'];
}

/** Compare two severities: returns negative if a is more severe than b */
export function compareSeverity(a: UnifiedSeverity, b: UnifiedSeverity): number {
  const order = severityOrder();
  return order.indexOf(a) - order.indexOf(b);
}
