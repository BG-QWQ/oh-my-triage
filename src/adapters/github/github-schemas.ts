import { z } from 'zod';

const nullableString = z.string().nullable().optional();

/** Validate GitHub Code Scanning alert locations returned by the REST API. */
export const GitHubCodeScanningLocationSchema = z
  .object({
    path: z.string(),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1).nullable().optional(),
    start_column: z.number().int().min(1).nullable().optional(),
    end_column: z.number().int().min(1).nullable().optional(),
  })
  .passthrough();

/** Validate GitHub Code Scanning rule metadata returned by the REST API. */
export const GitHubCodeScanningRuleSchema = z
  .object({
    id: z.string(),
    severity: z.string().nullable().optional(),
    security_severity_level: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    full_description: z.string().nullable().optional(),
    help: z.string().nullable().optional(),
  })
  .passthrough();

/** Validate GitHub Code Scanning tool metadata returned by the REST API. */
export const GitHubCodeScanningToolSchema = z
  .object({
    name: z.string(),
    version: nullableString,
    guid: nullableString,
  })
  .passthrough();

/** Validate a GitHub Code Scanning alert response object. */
export const GitHubCodeScanningAlertSchema = z
  .object({
    number: z.number().int(),
    created_at: z.string(),
    updated_at: z.string().nullable().optional(),
    url: z.string().url().optional(),
    html_url: z.string().url().nullable().optional(),
    state: z.string(),
    fixed_at: z.string().nullable().optional(),
    dismissed_at: z.string().nullable().optional(),
    dismissed_reason: nullableString,
    rule: GitHubCodeScanningRuleSchema,
    tool: GitHubCodeScanningToolSchema,
    most_recent_instance: z
      .object({
        ref: nullableString,
        analysis_key: nullableString,
        category: nullableString,
        state: z.string().optional(),
        message: z
          .object({
            text: z.string().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        location: GitHubCodeScanningLocationSchema,
      })
      .passthrough(),
  })
  .passthrough();

/** Validate a page of GitHub Code Scanning alerts. */
export const GitHubCodeScanningAlertPageSchema = z.array(GitHubCodeScanningAlertSchema);

/** GitHub Code Scanning alert accepted by the GitHub adapter. */
export type GitHubCodeScanningAlert = z.infer<typeof GitHubCodeScanningAlertSchema>;

/** Page of GitHub Code Scanning alerts accepted by the GitHub adapter. */
export type GitHubCodeScanningAlertPage = z.infer<typeof GitHubCodeScanningAlertPageSchema>;
