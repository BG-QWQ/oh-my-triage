import { z } from 'zod';
import { OMTError, ErrorCodes } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';

/** Adapter-specific error context with redacted diagnostics. */
export type AdapterErrorContext = {
  code: string;
  message: string;
  nextSteps: string[];
  retryable?: boolean;
  details?: Record<string, unknown>;
};

/** Convert unknown adapter failures into actionable oh-my-triage errors. */
export function toAdapterError(error: unknown, fallback: AdapterErrorContext): OMTError {
  if (error instanceof OMTError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new OMTError({
      code: fallback.code,
      message: `${fallback.message} Response validation failed: ${error.issues
        .map((issue) => issue.path.join('.') || issue.message)
        .slice(0, 3)
        .join('; ')}`,
      nextSteps: fallback.nextSteps,
      retryable: fallback.retryable ?? false,
      details: redactDetails({ issues: error.issues }),
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new OMTError({
    code: fallback.code,
    message: `${fallback.message} ${redactSecrets(message)}`.trim(),
    nextSteps: fallback.nextSteps,
    retryable: fallback.retryable ?? false,
    details: fallback.details ? redactDetails(fallback.details) : undefined,
  });
}

/** Create an actionable HTTP error for adapter API responses. */
export function createHttpAdapterError(params: {
  source: string;
  status: number;
  statusText: string;
  body?: string;
  requiredScopes?: string[];
  observedScopes?: string[];
}): OMTError {
  const body = params.body ? ` Body: ${redactSecrets(params.body).slice(0, 500)}` : '';
  const scopeMessage = params.requiredScopes?.length
    ? ` Required scopes: ${params.requiredScopes.join(', ')}. Observed scopes: ${(params.observedScopes ?? []).join(', ') || 'unavailable'}.`
    : '';

  if (params.status === 401) {
    return new OMTError({
      code: ErrorCodes.TOKEN_INVALID,
      message: `${params.source} token was rejected.${scopeMessage}${body}`,
      nextSteps: [
        `Create a new ${params.source} token with the documented scanner permissions.`,
        'Update the oh-my-triage credential store with the new token.',
        'Retry the connection test before fetching findings.',
      ],
      retryable: false,
    });
  }

  if (params.status === 403) {
    return new OMTError({
      code: ErrorCodes.PERMISSION_DENIED,
      message: `${params.source} denied access.${scopeMessage}${body}`,
      nextSteps: [
        'Verify the token has access to the requested organization, repository, or project.',
        'Grant the scanner/code scanning read scopes required by this adapter.',
        'Retry after permissions propagate.',
      ],
      retryable: false,
    });
  }

  if (params.status === 404) {
    return new OMTError({
      code: ErrorCodes.ADAPTER_FETCH_FAILED,
      message: `${params.source} resource was not found.${body}`,
      nextSteps: [
        'Check that the organization, repository, or project key is spelled correctly.',
        'Confirm the token can see the requested resource.',
      ],
      retryable: false,
    });
  }

  if (params.status === 429) {
    return new OMTError({
      code: ErrorCodes.ADAPTER_RATE_LIMITED,
      message: `${params.source} rate limit was exceeded.${body}`,
      nextSteps: [
        'Wait for the API rate limit window to reset.',
        'Reduce concurrent oh-my-triage syncs or fetch a smaller page range.',
      ],
      retryable: true,
    });
  }

  return new OMTError({
    code: ErrorCodes.ADAPTER_FETCH_FAILED,
    message: `${params.source} request failed with HTTP ${params.status} ${params.statusText}.${body}`,
    nextSteps: [
      'Verify service status and network connectivity.',
      'Retry the operation; if it persists, capture the redacted error details for support.',
    ],
    retryable: params.status >= 500,
  });
}

/** Redact secret-like string values in diagnostic details. */
export function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, redactSecrets(value)];
      }
      if (Array.isArray(value)) {
        return [key, value.map((item) => (typeof item === 'string' ? redactSecrets(item) : item))];
      }
      if (value && typeof value === 'object') {
        return [key, redactDetails(value as Record<string, unknown>)];
      }
      return [key, value];
    })
  );
}
