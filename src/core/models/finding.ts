import { z } from 'zod';
import { UnifiedSeverity, FindingStatus } from './common.js';

/** Location of a finding within source code */
export const FindingLocation = z.object({
  file_path: z.string().describe('Normalized relative path to the file'),
  start_line: z.number().int().min(1),
  start_column: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  end_column: z.number().int().min(1).optional(),
  code_snippet: z.string().max(2000).optional().describe('Redacted code snippet, max 20 lines'),
});

export type FindingLocation = z.infer<typeof FindingLocation>;

/** Source provenance for a finding */
export const FindingSource = z.object({
  tool: z.string().describe('Scanner tool name'),
  tool_version: z.string().optional(),
  rule_id: z.string().describe('Scanner original rule ID'),
  rule_name: z.string().optional(),
  rule_description: z.string().optional(),
  rule_help_url: z.string().url().optional(),
  original_id: z.string().describe('Scanner original finding ID'),
  original_url: z.string().url().optional(),
});

export type FindingSource = z.infer<typeof FindingSource>;

/** Fix suggestion for a finding */
export const FixSuggestion = z.object({
  description: z.string(),
  code_example: z.string().optional(),
  effort_estimate: z.string().optional(),
  breaking_risk: z.enum(['none', 'low', 'medium', 'high']).optional(),
});

export type FixSuggestion = z.infer<typeof FixSuggestion>;

/** Canonical normalized finding model */
export const Finding = z.object({
  // Internal ID
  id: z.string().regex(/^fb-[a-zA-Z0-9_-]+$/).describe('oh-my-triage internal ID; fb- prefix is retained for database compatibility'),

  // Source
  source: FindingSource,

  // Content
  title: z.string().max(500),
  message: z.string().max(10000),
  severity: UnifiedSeverity,
  raw_severity: z.string().describe('Original scanner severity string'),
  cwe_id: z.string().regex(/^CWE-\d+$/).optional(),
  cwe_name: z.string().optional(),
  owasp_category: z.string().optional(),

  // Location
  location: FindingLocation,

  // Status
  status: FindingStatus,

  // Deduplication
  fingerprint: z.string().describe('SHA256 fingerprint for deduplication'),
  duplicate_group_id: z.string().optional(),
  is_duplicate: z.boolean().default(false),

  // Priority
  priority_score: z.number().int().min(0).max(100).default(50),
  priority_reason: z.string().optional(),

  // Fix
  fix_suggestion: FixSuggestion.optional(),

  // Metadata
  first_seen_at: z.string().datetime().describe('ISO 8601 timestamp'),
  last_seen_at: z.string().datetime().describe('ISO 8601 timestamp'),
  dismissed_at: z.string().datetime().optional(),
  dismissed_reason: z.string().optional(),

  // Sync freshness
  sync_source_id: z.string().optional(),
  sync_scope_key: z.string().optional(),
  sync_run_id: z.string().optional(),
  sync_seen_at: z.string().datetime().optional(),
  is_stale: z.boolean().optional(),
  is_current_scope: z.boolean().optional(),
  stale_since_at: z.string().datetime().optional(),

  // Raw scanner data
  raw_data: z.record(z.string(), z.unknown()).describe('Original scanner metadata preserved verbatim'),
});

export type Finding = z.infer<typeof Finding>;

/** Input for creating a new Finding (omits generated fields) */
export const FindingInput = Finding.omit({
  id: true,
  fingerprint: true,
  duplicate_group_id: true,
  is_duplicate: true,
  priority_score: true,
  priority_reason: true,
  first_seen_at: true,
  last_seen_at: true,
  dismissed_at: true,
  dismissed_reason: true,
});

export type FindingInput = z.infer<typeof FindingInput>;
