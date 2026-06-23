import { z } from 'zod';

/** Unified severity levels across all scanner sources */
export const UnifiedSeverity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export type UnifiedSeverity = z.infer<typeof UnifiedSeverity>;

/** Finding lifecycle status */
export const FindingStatus = z.enum(['open', 'dismissed', 'fixed', 'false_positive']);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Supported scanner source types */
export const SourceType = z.enum([
  'sarif',
  'github',
  'sonarcloud',
  'socket',
  'snyk',
  'semgrep',
  'trivy',
  'sbom',
]);
export type SourceType = z.infer<typeof SourceType>;

/** Breaking risk levels for fix suggestions */
export const BreakingRisk = z.enum(['none', 'low', 'medium', 'high']);
export type BreakingRisk = z.infer<typeof BreakingRisk>;

/** Base severity score mapping for calibration */
export const BASE_SEVERITY_SCORE: Record<UnifiedSeverity, number> = {
  critical: 90,
  high: 70,
  medium: 50,
  low: 30,
  info: 10,
};

/** Scanner-native severity to unified severity mapping tables */
export const SEVERITY_MAP: Record<string, Record<string, UnifiedSeverity>> = {
  sarif: {
    error: 'high',
    warning: 'medium',
    note: 'low',
    none: 'info',
  },
  github: {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    warning: 'info',
  },
  sonarcloud: {
    blocker: 'critical',
    critical: 'high',
    major: 'medium',
    minor: 'low',
    info: 'info',
  },
  socket: {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    middle: 'medium',
    low: 'low',
  },
  snyk: {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
  },
  semgrep: {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    error: 'high',
    warning: 'medium',
    info: 'low',
  },
  trivy: {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    unknown: 'info',
  },
};
