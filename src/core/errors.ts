import { z } from 'zod';

/** Actionable error response for CLI, MCP tools, and adapters */
export const ActionableError = z.object({
  code: z.string().describe('Machine-readable error code'),
  message: z.string().describe('Human-readable error message'),
  next_steps: z.array(z.string()).describe('Suggested actions to resolve the error'),
  retryable: z.boolean().default(false).describe('Whether the operation can be retried'),
  details: z.record(z.string(), z.unknown()).optional().describe('Redacted diagnostic details'),
});

export type ActionableError = z.infer<typeof ActionableError>;

/** Base error class for oh-my-triage with actionable context */
export class OMTError extends Error {
  public readonly code: string;
  public readonly nextSteps: string[];
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    code: string;
    message: string;
    nextSteps?: string[];
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'OMTError';
    this.code = params.code;
    this.nextSteps = params.nextSteps ?? [];
    this.retryable = params.retryable ?? false;
    this.details = params.details;
  }

  toJSON(): ActionableError {
    return {
      code: this.code,
      message: this.message,
      next_steps: this.nextSteps,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/** Common error codes */
export const ErrorCodes = {
  // Config errors
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_WRITE_FAILED: 'CONFIG_WRITE_FAILED',

  // Auth errors
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Adapter errors
  ADAPTER_CONNECTION_FAILED: 'ADAPTER_CONNECTION_FAILED',
  ADAPTER_FETCH_FAILED: 'ADAPTER_FETCH_FAILED',
  ADAPTER_RATE_LIMITED: 'ADAPTER_RATE_LIMITED',

  // SARIF errors
  SARIF_PARSE_ERROR: 'SARIF_PARSE_ERROR',
  SARIF_INVALID_VERSION: 'SARIF_INVALID_VERSION',
  SARIF_FILE_TOO_LARGE: 'SARIF_FILE_TOO_LARGE',
  SARIF_FILE_NOT_FOUND: 'SARIF_FILE_NOT_FOUND',

  // Database errors
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  DB_MIGRATION_FAILED: 'DB_MIGRATION_FAILED',

  // MCP errors
  MCP_TOOL_NOT_FOUND: 'MCP_TOOL_NOT_FOUND',
  MCP_INVALID_INPUT: 'MCP_INVALID_INPUT',
  MCP_SERVER_ERROR: 'MCP_SERVER_ERROR',

  // Setup errors
  SETUP_BROWSER_FAILED: 'SETUP_BROWSER_FAILED',
  SETUP_PORT_CONFLICT: 'SETUP_PORT_CONFLICT',
  MCP_CONFIG_WRITE_FAILED: 'MCP_CONFIG_WRITE_FAILED',
} as const;
