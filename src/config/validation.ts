import { z } from 'zod';

/** Validate supported credential storage strategies for persisted configuration. */
export const TokenStorageSchema = z.enum(['keychain', 'env', 'encrypted-file']);

/** Validate a scanner source entry from oh-my-triage configuration. */
export const SourceConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['sarif', 'github', 'sonarcloud', 'socket', 'snyk', 'semgrep', 'trivy', 'sbom']),
  name: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  path: z.string().optional(),
  api_url: z.string().url().optional(),
  project_key: z.string().optional(),
  token_ref: z.string().optional(),
  options: z.record(z.string(), z.unknown()).default({}),
});

/** Validate optional MCP client config paths. */
export const McpClientPathsSchema = z
  .object({
    claude_desktop: z.string().optional(),
    cursor: z.string().optional(),
    vscode: z.string().optional(),
  })
  .partial();

/** Validate the complete oh-my-triage configuration document. */
export const ConfigSchema = z.object({
  version: z.literal('1'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  token_storage: TokenStorageSchema.default('keychain'),
  sources: z.array(SourceConfigSchema).default([]),
  database_path: z.string().optional(),
  mcp_client_paths: McpClientPathsSchema.optional(),
});

export type TokenStorage = z.infer<typeof TokenStorageSchema>;
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
