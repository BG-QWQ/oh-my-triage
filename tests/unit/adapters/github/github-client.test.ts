import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '@/adapters/github/github-client.js';

describe('GitHubClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates a token without requiring repository coordinates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('security_events'));
    const client = new GitHubClient({ token: 'token-123', apiBaseUrl: 'https://api.github.test' });

    await expect(client.validateConnection()).resolves.toEqual({
      valid: true,
      observedScopes: ['security_events'],
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.test/user', expect.any(Object));
  });

  it('validates repository access when owner and repository are configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('repo'));
    const client = new GitHubClient({
      token: 'token-123',
      owner: 'BG-QWQ',
      repo: 'FindingBridge',
      apiBaseUrl: 'https://api.github.test',
    });

    await expect(client.validateConnection()).resolves.toEqual({
      valid: true,
      observedScopes: ['repo'],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.test/repos/BG-QWQ/FindingBridge',
      expect.any(Object)
    );
  });
});

function okResponse(scopes: string): Response {
  return new Response('{}', {
    status: 200,
    headers: { 'x-oauth-scopes': scopes },
  });
}
