import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdapterResponse,
  readResponseTextSafely,
  redactToken,
} from '@/adapters/adapter-http.js';
import { ErrorCodes, OMTError } from '@/core/errors.js';

describe('adapter-http', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchAdapterResponse', () => {
    it('normalizes URLs when baseUrl has a trailing slash and path has a leading slash', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

      await fetchAdapterResponse({
        source: 'test',
        baseUrl: 'https://scanner.test/',
        path: '/api/v1/projects',
        token: 'token-123',
        accept: 'application/json',
        authorizationScheme: 'Bearer',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://scanner.test/api/v1/projects',
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it('normalizes URLs when baseUrl has no trailing slash and path has no leading slash', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

      await fetchAdapterResponse({
        source: 'test',
        baseUrl: 'https://scanner.test',
        path: 'api/v1/projects',
        token: 'token-123',
        accept: 'application/json',
        authorizationScheme: 'Bearer',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://scanner.test/api/v1/projects',
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it('sends default adapter headers', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

      await fetchAdapterResponse({
        source: 'test',
        baseUrl: 'https://scanner.test',
        path: '/api/v1/projects',
        token: 'token-123',
        accept: 'application/json',
        authorizationScheme: 'Bearer',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
            Authorization: 'Bearer token-123',
            'User-Agent': 'oh-my-triage/0.1',
          }),
        })
      );
    });

    it('merges init.headers before explicit headers', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

      await fetchAdapterResponse({
        source: 'test',
        baseUrl: 'https://scanner.test',
        path: '/api/v1/projects',
        token: 'token-123',
        accept: 'application/json',
        authorizationScheme: 'Bearer',
        init: {
          headers: {
            Accept: 'text/plain',
            'X-Init-Header': 'init-value',
          },
        },
        headers: {
          Authorization: 'token overridden',
          'X-Explicit-Header': 'explicit-value',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/plain',
            Authorization: 'token overridden',
            'User-Agent': 'oh-my-triage/0.1',
            'X-Init-Header': 'init-value',
            'X-Explicit-Header': 'explicit-value',
          }),
        })
      );
    });

    it('merges Headers instances with explicit headers winning', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

      await fetchAdapterResponse({
        source: 'test',
        baseUrl: 'https://scanner.test',
        path: '/api/v1/projects',
        token: 'token-123',
        accept: 'application/json',
        authorizationScheme: 'Bearer',
        init: {
          headers: new Headers({ Accept: 'text/plain' }),
        },
        headers: new Headers({ Authorization: 'token overridden' }),
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/plain',
            Authorization: 'token overridden',
            'User-Agent': 'oh-my-triage/0.1',
          }),
        })
      );
    });

    it('returns the response on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

      const response = await fetchAdapterResponse({
        source: 'test',
        baseUrl: 'https://scanner.test',
        path: '/api/v1/projects',
        token: 'token-123',
        accept: 'application/json',
        authorizationScheme: 'Bearer',
      });

      expect(response.status).toBe(200);
    });

    it('throws an OMTError for non-2xx responses without leaking the token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('invalid token-123', { status: 401, statusText: 'Unauthorized' })
      );

      await expect(
        fetchAdapterResponse({
          source: 'test',
          baseUrl: 'https://scanner.test',
          path: '/api/v1/projects',
          token: 'token-123',
          accept: 'application/json',
          authorizationScheme: 'Bearer',
        })
      ).rejects.toBeInstanceOf(OMTError);

      try {
        await fetchAdapterResponse({
          source: 'test',
          baseUrl: 'https://scanner.test',
          path: '/api/v1/projects',
          token: 'token-123',
          accept: 'application/json',
          authorizationScheme: 'Bearer',
        });
        throw new Error('Expected fetchAdapterResponse to reject');
      } catch (caught: unknown) {
        if (!(caught instanceof OMTError)) {
          throw caught;
        }
        expect(caught.code).toBe(ErrorCodes.TOKEN_INVALID);
        expect(caught.message).not.toContain('token-123');
      }
    });
  });

  describe('readResponseTextSafely', () => {
    it('returns the response text on success', async () => {
      const response = new Response('hello world');
      await expect(readResponseTextSafely(response)).resolves.toBe('hello world');
    });

    it('returns undefined when reading the body fails', async () => {
      const response = new Response('hello');
      vi.spyOn(response, 'text').mockRejectedValue(new Error('stream broken'));
      await expect(readResponseTextSafely(response)).resolves.toBeUndefined();
    });
  });

  describe('redactToken', () => {
    it('replaces the token with a redaction marker', () => {
      expect(redactToken('error for token-123', 'token-123')).toBe('error for ***REDACTED***');
    });

    it('returns undefined for an empty body', () => {
      expect(redactToken(undefined, 'token-123')).toBeUndefined();
      expect(redactToken('', 'token-123')).toBeUndefined();
    });

    it('falls back to generic secret redaction when the token is empty', () => {
      const body = 'error for token: secret123';
      expect(redactToken(body, '')).toBe('error for token: ***REDACTED***');
      expect(redactToken(body, '   ')).toBe('error for token: ***REDACTED***');
    });

    it('does not insert redaction markers between every character for whitespace tokens', () => {
      const body = 'abc';
      expect(redactToken(body, '   ')).toBe('abc');
    });
  });
});

function okResponse(): Response {
  return new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
