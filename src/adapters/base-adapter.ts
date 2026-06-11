import { z } from 'zod';
import { FindingBridgeError } from '../core/errors.js';

/** Connection test result */
export const ConnectionTestResult = z.object({
  valid: z.boolean(),
  reason: z.string().optional(),
  help_url: z.string().url().optional(),
  suggestion: z.string().optional(),
  projects_found: z.number().optional(),
  orgs_found: z.number().optional(),
  repositories: z
    .array(
      z.object({
        owner: z.string(),
        name: z.string(),
        full_name: z.string(),
        private: z.boolean().optional(),
        archived: z.boolean().optional(),
        disabled: z.boolean().optional(),
      })
    )
    .optional(),
});

export type ConnectionTestResult = z.infer<typeof ConnectionTestResult>;

/** Adapter fetch result */
export const AdapterFetchResult = z.object({
  findings: z.array(z.record(z.string(), z.unknown())),
  total: z.number().int(),
  has_more: z.boolean().default(false),
  next_cursor: z.string().optional(),
});

export type AdapterFetchResult = z.infer<typeof AdapterFetchResult>;

/** Base adapter interface for all scanner sources */
export interface BaseAdapter {
  /** Source type identifier */
  readonly sourceType: string;
  /** Human-readable source name */
  readonly displayName: string;
  /** Test connection with current credentials */
  testConnection(): Promise<ConnectionTestResult>;
  /** Fetch findings from the scanner source */
  fetchFindings(options?: { cursor?: string; limit?: number }): Promise<AdapterFetchResult>;
}

/** Adapter error for connection failures */
export class AdapterError extends FindingBridgeError {
  constructor(params: {
    code: string;
    message: string;
    nextSteps?: string[];
    retryable?: boolean;
  }) {
    super({
      code: params.code,
      message: params.message,
      nextSteps: params.nextSteps,
      retryable: params.retryable ?? false,
    });
    this.name = 'AdapterError';
  }
}
