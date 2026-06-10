import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { redactSecrets } from '../utils/redaction.js';

/**
 * Represent a structured FindingBridge tool response envelope.
 *
 * The envelope gives MCP clients a consistent success flag and data/error slot
 * while preserving each tool's domain-specific payload in structured JSON.
 */
export type FindingBridgeToolEnvelope<T extends Record<string, unknown>> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        next_steps: string[];
      };
    };

/**
 * Format a successful MCP tool response.
 *
 * Returning both structured content and text keeps modern MCP clients machine
 * readable while remaining compatible with clients that only display text.
 */
export function toolSuccess<T extends Record<string, unknown>>(data: T): CallToolResult {
  const envelope: FindingBridgeToolEnvelope<T> = {
    success: true,
    data,
  };

  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
  };
}

/**
 * Format an actionable MCP tool error response.
 *
 * Messages are redacted before returning to avoid leaking credentials captured
 * in scanner metadata, exception messages, or database diagnostics.
 */
export function toolError(code: string, message: string, nextSteps: string[]): CallToolResult {
  const envelope: FindingBridgeToolEnvelope<Record<string, never>> = {
    success: false,
    error: {
      code,
      message: redactSecrets(message),
      next_steps: nextSteps.map((step) => redactSecrets(step)),
    },
  };

  return {
    isError: true,
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
  };
}

/**
 * Convert unknown caught values into a redacted, actionable MCP tool error.
 *
 * Tool handlers use this as their last-resort error boundary so exceptions do
 * not escape as unstructured protocol failures.
 */
export function toolException(error: unknown, nextSteps: string[]): CallToolResult {
  const message = error instanceof Error ? error.message : 'Unexpected MCP tool failure.';
  return toolError('internal_error', message, nextSteps);
}
