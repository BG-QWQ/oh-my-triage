import type { OMTError } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';
import { createHttpAdapterError } from './adapter-errors.js';

type AuthorizationScheme = 'Bearer' | 'token';

/** Configure one scanner adapter HTTP request.
 *
 * Each scanner still owns its API path, auth scheme, and exceptional error
 * cases. This shared shape centralizes the repeated fetch/header/error-body
 * plumbing without hiding scanner-specific semantics.
 */
export type AdapterRequestOptions = {
  readonly source: string;
  readonly baseUrl: string;
  readonly path: string;
  readonly token: string;
  readonly accept: string;
  readonly authorizationScheme: AuthorizationScheme;
  readonly headers?: HeadersInit;
  readonly init?: RequestInit;
  readonly bodyTransform?: (body: string | undefined) => string | undefined;
  readonly onErrorResponse?: (response: Response, body: string | undefined) => OMTError | undefined;
  readonly requiredScopes?: readonly string[];
  readonly observedScopes?: (response: Response) => readonly string[];
};

/** Fetch a scanner API response with the standard oh-my-triage adapter headers.
 *
 * Non-2xx responses are converted into actionable `OMTError` instances after
 * reading and redacting the response body. Scanner clients can provide a custom
 * error hook only for cases where the generic HTTP mapper would lose important
 * scanner-specific guidance.
 *
 * @throws OMTError when the scanner returns a non-2xx response.
 * @throws TypeError when the underlying fetch implementation fails before an HTTP response is available.
 */
export async function fetchAdapterResponse(options: AdapterRequestOptions): Promise<Response> {
  const response = await fetch(`${options.baseUrl}${options.path}`, {
    ...options.init,
    headers: {
      Accept: options.accept,
      Authorization: `${options.authorizationScheme} ${options.token}`,
      'User-Agent': 'oh-my-triage/0.1',
      ...options.init?.headers,
      ...options.headers,
    },
  });

  if (response.ok) {
    return response;
  }

  const body = await readResponseTextSafely(response);
  const redactedBody = redactToken(body, options.token);
  const transformedBody = options.bodyTransform ? options.bodyTransform(redactedBody) : redactedBody;
  const customError = options.onErrorResponse?.(response, transformedBody);
  if (customError) {
    throw customError;
  }

  throw createHttpAdapterError({
    source: options.source,
    status: response.status,
    statusText: response.statusText,
    body: transformedBody,
    requiredScopes: options.requiredScopes ? [...options.requiredScopes] : undefined,
    observedScopes: options.observedScopes ? [...options.observedScopes(response)] : undefined,
  });
}

/** Read an HTTP response body without masking the original status handling.
 *
 * Some mocked or streamed responses can fail while reading the body. Adapter
 * error mapping should still produce the status-based guidance in those cases,
 * so body read failures intentionally degrade to `undefined`.
 */
export async function readResponseTextSafely(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function redactToken(body: string | undefined, token: string): string | undefined {
  if (!body) {
    return undefined;
  }

  return redactSecrets(body.split(token).join('***REDACTED***'));
}
