import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '@/adapters/github/github-client.js';

describe('GitHubClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates a token without requiring repository coordinates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(user('octocat'), 'security_events'));
    const client = new GitHubClient({ token: 'token-123', apiBaseUrl: 'https://api.github.test' });

    await expect(client.validateConnection()).resolves.toEqual({
      valid: true,
      observedScopes: ['security_events'],
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.test/user', expect.any(Object));
  });

  it('validates repository access when owner and repository are configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(repo('BG-QWQ', 'FindingBridge'), 'repo'));
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

  it('rejects malformed authenticated user responses during token validation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 1 }, 'security_events'));
    const client = new GitHubClient({ token: 'token-123', apiBaseUrl: 'https://api.github.test' });

    await expect(client.validateConnection()).rejects.toThrow();
  });

  it('lists repositories visible to the token across pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => repo('acme', `api-${index}`));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([repo('octo', 'tooling')]));
    const client = new GitHubClient({ token: 'token-123', apiBaseUrl: 'https://api.github.test' });

    const repositories = await client.listAccessibleRepositories({ maxPages: 2 });

    expect(repositories).toHaveLength(101);
    expect(repositories.at(-1)).toEqual(expect.objectContaining({ full_name: 'octo/tooling' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.test/user/repos?per_page=100&page=1&visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.test/user/repos?per_page=100&page=2&visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc',
      expect.any(Object)
    );
  });

  it('rejects malformed repository discovery responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([{ id: 1, name: 'missing-owner' }]));
    const client = new GitHubClient({ token: 'token-123', apiBaseUrl: 'https://api.github.test' });

    await expect(client.listAccessibleRepositories()).rejects.toThrow();
  });
});

function jsonResponse(body: unknown, scopes?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: scopes ? { 'x-oauth-scopes': scopes } : undefined,
  });
}

function user(login: string): Record<string, unknown> {
  return { login, id: 1 };
}

function repo(owner: string, name: string): Record<string, unknown> {
  return {
    id: 1,
    name,
    full_name: `${owner}/${name}`,
    private: false,
    owner: {
      login: owner,
      id: 2,
    },
  };
}
