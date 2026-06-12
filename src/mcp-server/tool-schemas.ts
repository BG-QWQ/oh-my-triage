import { z } from 'zod';
import { FindingStatus, UnifiedSeverity } from '../core/models/common.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Validate finding list filters and pagination controls.
 *
 * The schema mirrors the public MCP tool contract so clients can rely on a
 * stable, scanner-neutral filter surface instead of repository-specific query
 * details.
 */
export const ListFindingsInputSchema = z.object({
  severity: z.array(UnifiedSeverity).optional(),
  tool: z.array(z.string().min(1)).optional(),
  status: z.array(FindingStatus).optional(),
  rule_id: z
    .string()
    .min(1)
    .describe('Exact scanner rule ID to match, such as js/sql-injection or python:S3776. This is not a prefix search or project key.')
    .optional(),
  file_path: z
    .string()
    .min(1)
    .describe('Normalized finding location path to match against stored findings, such as src/db.ts or ensemble.py. This is not a scanner project or repository selector.')
    .optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  sort_by: z.enum(['severity', 'date', 'priority_score']).default('priority_score'),
  include_stale: z.boolean().default(false),
});

/**
 * Validate detail lookup controls for a single finding.
 *
 * Code context is capped by the tool implementation to preserve the project
 * privacy guarantee that MCP responses never expose full source files.
 */
export const GetFindingDetailInputSchema = z.object({
  finding_id: z.string().min(1),
  include_code_context: z.boolean().default(true),
  context_lines: z.number().int().min(0).max(20).default(20),
  include_stale: z.boolean().default(false),
});

/**
 * Validate explanation options for a single finding.
 *
 * Explanations are generated deterministically from normalized metadata and do
 * not call external LLM providers.
 */
export const ExplainFindingInputSchema = z.object({
  finding_id: z.string().min(1),
  audience: z.enum(['developer', 'security', 'manager']).default('developer'),
  language: z.string().min(2).default('en'),
  include_stale: z.boolean().default(false),
});

/**
 * Validate fix-suggestion options for a single finding.
 *
 * The approach steers guidance style only; tools remain read-only and never
 * create patches or modify user repositories.
 */
export const SuggestFixInputSchema = z.object({
  finding_id: z.string().min(1),
  approach: z.enum(['minimal', 'robust', 'educational']).default('minimal'),
  include_stale: z.boolean().default(false),
});

/**
 * Validate priority scoring input.
 *
 * Criteria provide caller intent while context captures environmental risk
 * signals used by the existing prioritization utilities.
 */
export const PrioritizeFindingsInputSchema = z.object({
  finding_ids: z.array(z.string().min(1)).min(1).max(200),
  criteria: z.array(z.enum(['severity', 'exploitability', 'asset_criticality', 'duplicate_status'])).default([
    'severity',
    'exploitability',
    'asset_criticality',
    'duplicate_status',
  ]),
  context: z
    .object({
      is_public_facing: z.boolean().optional(),
      handles_sensitive_data: z.boolean().optional(),
      recent_breaches_in_cwe: z.boolean().optional(),
      business_critical_paths: z.array(z.string().min(1)).optional(),
    })
    .default({}),
  include_stale: z.boolean().default(false),
});

/**
 * Validate deduplication preview scope.
 *
 * Dry-run defaults to true and is enforced by the read-only MCP tool contract;
 * callers receive duplicate groups without database mutation.
 */
export const DeduplicateFindingsInputSchema = z.object({
  scope: z
    .object({
      finding_ids: z.array(z.string().min(1)).min(1).max(500).optional(),
      tool: z.array(z.string().min(1)).optional(),
      status: z.array(FindingStatus).optional(),
      file_path: z.string().min(1).optional(),
      include_stale: z.boolean().default(false),
    })
    .default({}),
  dry_run: z.boolean().default(true),
});

/**
 * Validate report generation options.
 *
 * Report content is returned inline to keep the MCP server side-effect free and
 * avoid writing files into a user's repository.
 */
export const GenerateReportInputSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
  scope: z
    .object({
      finding_ids: z.array(z.string().min(1)).min(1).max(500).optional(),
      severity: z.array(UnifiedSeverity).optional(),
      status: z.array(FindingStatus).optional(),
      tool: z.array(z.string().min(1)).optional(),
      file_path: z.string().min(1).optional(),
      include_stale: z.boolean().default(false),
    })
    .default({}),
  include_recommendations: z.boolean().default(true),
  language: z.string().min(2).default('en'),
});

/**
 * Validate source synchronization controls.
 *
 * The tool writes scanner results into the local FindingBridge database only;
 * it never modifies user repositories or external scanner state.
 */
export const SyncSourcesInputSchema = z.object({
  source_ids: z.array(z.string().min(1)).max(20).optional(),
  project_keys: z.record(z.string().min(1), z.string().min(1)).optional(),
  all_sources: z.boolean().default(false),
  max_pages: z.number().int().min(1).max(100).default(20),
});

/**
 * Validate scanner project discovery controls.
 *
 * Project discovery calls scanner APIs with configured credentials and returns
 * project identifiers without modifying local FindingBridge state.
 */
export const ListSourceProjectsInputSchema = z.object({
  source_ids: z.array(z.string().min(1)).max(20).optional(),
  organizations: z.record(z.string().min(1), z.string().min(1)).optional(),
  max_pages: z.number().int().min(1).max(50).default(10),
});

export type ListFindingsInput = Omit<z.infer<typeof ListFindingsInputSchema>, 'include_stale'> & {
  include_stale?: boolean;
};
export type GetFindingDetailInput = Omit<z.infer<typeof GetFindingDetailInputSchema>, 'include_stale'> & {
  include_stale?: boolean;
};
export type ExplainFindingInput = Omit<z.infer<typeof ExplainFindingInputSchema>, 'include_stale'> & {
  include_stale?: boolean;
};
export type SuggestFixInput = Omit<z.infer<typeof SuggestFixInputSchema>, 'include_stale'> & {
  include_stale?: boolean;
};
export type PrioritizeFindingsInput = Omit<z.infer<typeof PrioritizeFindingsInputSchema>, 'include_stale'> & {
  include_stale?: boolean;
};
export type DeduplicateFindingsInput = Omit<z.infer<typeof DeduplicateFindingsInputSchema>, 'scope'> & {
  scope: Omit<z.infer<typeof DeduplicateFindingsInputSchema>['scope'], 'include_stale'> & { include_stale?: boolean };
};
export type GenerateReportInput = Omit<z.infer<typeof GenerateReportInputSchema>, 'scope'> & {
  scope: Omit<z.infer<typeof GenerateReportInputSchema>['scope'], 'include_stale'> & { include_stale?: boolean };
};
export type SyncSourcesInput = Omit<z.infer<typeof SyncSourcesInputSchema>, 'all_sources'> & {
  all_sources?: boolean;
};
export type ListSourceProjectsInput = z.infer<typeof ListSourceProjectsInputSchema>;
