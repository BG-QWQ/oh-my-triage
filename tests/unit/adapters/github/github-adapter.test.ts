import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAdapter } from '@/adapters/github/github-adapter.js';

describe('GitHubAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns visible repository options from setup connection tests', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ login: 'octocat', id: 1 }, 'security_events'))
      .mockResolvedValueOnce(jsonResponse([repo('acme', 'api')], 'security_events'));
    const adapter = new GitHubAdapter({ token: 'token-123', apiBaseUrl: 'https://api.github.test' });

    await expect(adapter.testConnection()).resolves.toMatchObject({
      valid: true,
      projects_found: 1,
      orgs_found: 1,
      repositories: [
        {
          owner: 'acme',
          name: 'api',
          full_name: 'acme/api',
          private: false,
        },
      ],
    });
  });
});

function jsonResponse(body: unknown, scopes: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'x-oauth-scopes': scopes },
  });
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
