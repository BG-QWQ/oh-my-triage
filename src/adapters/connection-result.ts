import type { ConnectionTestResult } from './base-adapter.js';
import { OMTError } from '../core/errors.js';

/** Build a scanner connection-test failure result with step-specific guidance.
 *
 * Connection tests intentionally return structured failure results instead of
 * throwing, because setup flows need to display the failing step and a concise
 * remediation. Existing `OMTError` messages are preserved exactly while the
 * caller-provided next steps keep the suggestion tied to the failed adapter step.
 */
export function connectionFailure(
  error: unknown,
  fallbackMessage: string,
  nextSteps: readonly string[]
): ConnectionTestResult {
  if (error instanceof OMTError) {
    return { valid: false, reason: error.message, suggestion: nextSteps.join(' ') };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { valid: false, reason: `${fallbackMessage} ${detail}`.trim(), suggestion: nextSteps.join(' ') };
}
