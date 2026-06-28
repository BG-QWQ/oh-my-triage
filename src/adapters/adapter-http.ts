import type { OMTError } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';
import { createHttpAdapterError } from './adapter-errors.js';

type AuthorizationScheme = 'Bearer' | 'token';
type HeaderRecord = Record<string, string>;

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

/** Build a scanner API URL that tolerates inconsistent leading/trailing slashes.
 *
 * Adapter callers often assemble paths from constants and runtime values; requiring
 * every caller to manage slashes is error-prone and duplicates trivial logic.
 */
function buildAdapterUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

/** Map well-known lowercase header names back to canonical casing.
 *
 * Header names are case-insensitive per RFC 7230, but preserving the
 * conventional capitalization keeps adapter tests and debug output readable.
 */
const CANONICAL_HEADER_NAMES: Record<string, string> = {
  accept: 'Accept',
  authorization: 'Authorization',
  'content-type': 'Content-Type',
  'user-agent': 'User-Agent',
};

function normalizeHeaderName(name: string): string {
  return CANONICAL_HEADER_NAMES[name.toLowerCase()] ?? name;
}

/** Convert any `HeadersInit` into a plain header record.
 *
 * Supports plain objects, `Headers` instances, and header arrays so callers
 * can pass whichever shape is most convenient. Duplicate header names are
 * collapsed using case-insensitive comparison while preserving canonical
 * casing for well-known headers.
 */
function headersInitToRecord(headers: HeadersInit | undefined): HeaderRecord {
  if (!headers) {
    return {};
  }

  const record: HeaderRecord = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[normalizeHeaderName(key)] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      record[normalizeHeaderName(key)] = value;
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      record[normalizeHeaderName(key)] = value;
    }
  }
  return record;
}

/** Merge adapter headers while preserving the intended precedence.
 *
 * Defaults are applied first, then any headers from `init`, and finally any
 * scanner-specific overrides in `headers`.
 */
function buildAdapterHeaders(options: AdapterRequestOptions): HeaderRecord {
  return {
    Accept: options.accept,
    Authorization: `${options.authorizationScheme} ${options.token}`,
    'User-Agent': 'oh-my-triage/0.1',
    ...headersInitToRecord(options.init?.headers),
    ...headersInitToRecord(options.headers),
  };
}

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
  const response = await fetch(buildAdapterUrl(options.baseUrl, options.path), {
    ...options.init,
    headers: buildAdapterHeaders(options),
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

/** Redact a scanner token from an HTTP response body.
 *
 * Empty or whitespace-only tokens are rejected because splitting a body by an
 * empty string would insert a redaction marker between every character.
 */
export function redactToken(body: string | undefined, token: string): string | undefined {
  if (!body) {
    return undefined;
  }

  if (!token || token.trim().length === 0) {
    return redactSecrets(body);
  }

  return redactSecrets(body.split(token).join('***REDACTED***'));
}
