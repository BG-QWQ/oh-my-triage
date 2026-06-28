import { afterEach, describe, expect, it, vi } from 'vitest';
import { SonarCloudClient } from '@/adapters/sonarcloud/sonarcloud-client.js';
import { ErrorCodes, OMTError } from '@/core/errors.js';

describe('SonarCloudClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates a token with bearer auth and JSON headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ valid: true }));
    const client = new SonarCloudClient({ token: 'token-123', apiBaseUrl: 'https://sonarcloud.test' });

    await expect(client.validateToken()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sonarcloud.test/api/authentication/validate',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-123',
          'User-Agent': 'oh-my-triage/0.1',
        }),
      })
    );
  });

  it('maps 401 responses to TOKEN_INVALID without leaking the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unauthorized for token-123', {
        status: 401,
        statusText: 'Unauthorized',
      })
    );
    const client = new SonarCloudClient({ token: 'token-123', apiBaseUrl: 'https://sonarcloud.test' });

    let error: OMTError;
    try {
      await client.validateToken();
      throw new Error('Expected SonarCloudClient.validateToken() to reject');
    } catch (caught: unknown) {
      if (caught instanceof OMTError) {
        error = caught;
      } else {
        throw caught;
      }
    }

    expect(error.code).toBe(ErrorCodes.TOKEN_INVALID);
    expect(error.message).not.toContain('token-123');
  });

  it('lists projects with organization filtering and JSON headers when configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        components: [],
        paging: { pageIndex: 1, pageSize: 100, total: 0 },
      })
    );
    const client = new SonarCloudClient({
      token: 'token-123',
      organization: 'acme',
      apiBaseUrl: 'https://sonarcloud.test',
    });

    await expect(client.listProjects()).resolves.toEqual({ projects: [], total: 0, hasMore: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sonarcloud.test/api/components/search?p=1&ps=100&qualifiers=TRK&organization=acme',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-123',
          'User-Agent': 'oh-my-triage/0.1',
        }),
      })
    );
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
