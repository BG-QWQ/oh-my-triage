import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes, OMTError } from '@/core/errors.js';
import { SocketClient } from '@/adapters/socket/socket-client.js';

describe('SocketClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the organizations endpoint with bearer auth and the project user agent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ organizations: [] }));
    const client = new SocketClient({ token: 'token-123', apiBaseUrl: 'https://api.socket.dev/v0' });

    await expect(client.listOrganizations()).resolves.toEqual({ organizations: [], hasMore: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.socket.dev/v0/organizations',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'User-Agent': 'oh-my-triage/0.1',
        }),
      })
    );
  });

  it('calls the alerts endpoint with the default page size and headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ items: [], endCursor: null, totalCount: 0 })
    );
    const client = new SocketClient({ token: 'token-123', apiBaseUrl: 'https://api.socket.dev/v0' });

    await expect(client.listAlerts('acme', {})).resolves.toEqual({ alerts: [], endCursor: null, totalCount: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.socket.dev/v0/orgs/acme/alerts?per_page=1000',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'User-Agent': 'oh-my-triage/0.1',
        }),
      })
    );
  });

  it('includes startAfterCursor when paging alerts forward', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ items: [], endCursor: 'cursor-2', totalCount: 4 })
    );
    const client = new SocketClient({ token: 'token-123', apiBaseUrl: 'https://api.socket.dev/v0' });

    await expect(
      client.listAlerts('acme', { startAfterCursor: 'cursor-1', perPage: 100 })
    ).resolves.toEqual({ alerts: [], endCursor: 'cursor-2', totalCount: 4 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.socket.dev/v0/orgs/acme/alerts?per_page=100&startAfterCursor=cursor-1',
      expect.any(Object)
    );
  });

  it('treats an empty page with a cursor as having more results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ organizations: [], endCursor: 'cursor-2' })
    );
    const client = new SocketClient({ token: 'token-123', apiBaseUrl: 'https://api.socket.dev/v0' });

    await expect(client.listOrganizations()).resolves.toEqual({ organizations: [], hasMore: true, endCursor: 'cursor-2' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 401 responses to TOKEN_INVALID without leaking the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unauthorized for token-123', {
        status: 401,
        statusText: 'Unauthorized',
      })
    );
    const client = new SocketClient({ token: 'token-123', apiBaseUrl: 'https://api.socket.dev/v0' });

    await expect(client.listOrganizations()).rejects.toMatchObject({ code: ErrorCodes.TOKEN_INVALID });
    await expect(client.listOrganizations()).rejects.toSatisfy((error: unknown) => {
      return error instanceof OMTError && !error.message.includes('token-123');
    });
  });

  it('maps 429 responses to a retryable adapter rate limit error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        statusText: 'Too Many Requests',
      })
    );
    const client = new SocketClient({ token: 'token-123', apiBaseUrl: 'https://api.socket.dev/v0' });

    await expect(client.listAlerts('acme')).rejects.toMatchObject({
      code: ErrorCodes.ADAPTER_RATE_LIMITED,
      retryable: true,
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
