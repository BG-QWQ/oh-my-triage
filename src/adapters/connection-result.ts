import type { ConnectionTestResult } from './base-adapter.js';
import { OMTError } from '../core/errors.js';

/** Run a scanner connection test by listing organizations.
 *
 * Several scanner adapters (Snyk, Socket.dev, etc.) validate a token by
 * counting the organizations visible to that token. This shared helper
 * removes the duplicated try/catch and success-result boilerplate while
 * preserving scanner-specific success/failure wording.
 */
export async function testConnectionByListingOrganizations(
  source: string,
  listOrganizations: () => Promise<{ organizations: readonly unknown[] }>,
  failureNextSteps: readonly string[]
): Promise<ConnectionTestResult> {
  try {
    const result = await listOrganizations();
    return {
      valid: true,
      reason: `${source} token validated and ${result.organizations.length} organization(s) are visible.`,
      orgs_found: result.organizations.length,
    };
  } catch (error: unknown) {
    return connectionFailure(error, `${source} connection test failed.`, failureNextSteps);
  }
}

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
