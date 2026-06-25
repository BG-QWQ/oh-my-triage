import { describe, expect, it, vi } from 'vitest';
import { SnykClient } from '@/adapters/snyk/snyk-client.js';
import { ErrorCodes } from '@/core/errors.js';

describe('SnykClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists organizations with token auth and JSON:API headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'org-1', attributes: { name: 'Acme', slug: 'acme' } },
        ],
        links: {},
      })
    );

    const client = new SnykClient({ token: 'token-123' });
    const result = await client.listOrganizations();

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]).toMatchObject({ id: 'org-1', name: 'Acme', slug: 'acme' });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://api.snyk.io/rest/orgs?version=2024-10-15');
    expect(call[1]?.headers).toMatchObject({
      Accept: 'application/vnd.api+json',
      Authorization: 'token token-123',
      'User-Agent': 'oh-my-triage/0.1',
    });
  });

  it('lists issues with version, limit, and cursor pagination', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: [issue('issue-1', 'high')],
          links: { next: '/rest/orgs/org-123/issues?version=2024-10-15&limit=100&starting_after=cursor-2' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [issue('issue-2', 'medium')],
          links: {},
        })
      );

    const client = new SnykClient({ token: 'token-123' });
    const firstPage = await client.listIssues('org-123', {});
    expect(firstPage.issues).toHaveLength(1);
    expect(firstPage.issues[0].id).toBe('issue-1');
    expect(firstPage.nextCursor).toBe('cursor-2');

    const secondPage = await client.listIssues('org-123', { cursor: firstPage.nextCursor });
    expect(secondPage.issues[0].id).toBe('issue-2');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe('https://api.snyk.io/rest/orgs/org-123/issues?version=2024-10-15&limit=100');
    expect(calls[1][0]).toBe(
      'https://api.snyk.io/rest/orgs/org-123/issues?version=2024-10-15&limit=100&starting_after=cursor-2'
    );
  });

  it('maps 401 to TOKEN_INVALID without leaking the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const client = new SnykClient({ token: 'secret-token' });
    await expect(client.listOrganizations()).rejects.toMatchObject({
      code: ErrorCodes.TOKEN_INVALID,
    });

    try {
      await client.listOrganizations();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain('secret-token');
    }
  });

  it('maps 429 to retryable ADAPTER_RATE_LIMITED', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(429, 'Rate limit exceeded'));

    const client = new SnykClient({ token: 'token-123' });
    await expect(client.listIssues('org-123', {})).rejects.toMatchObject({
      code: ErrorCodes.ADAPTER_RATE_LIMITED,
      retryable: true,
    });
  });

  it('explains Snyk REST API entitlement failures when project listing is forbidden', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        {
          jsonapi: { version: '1.0' },
          errors: [
            {
              status: '403',
              title: 'Forbidden',
              detail: 'Forbidden',
              meta: {
                missing_details: [
                  {
                    entitlement: 'api',
                    reason: 'NOT_ENTITLED_BY_CONTRACT',
                    message: 'Not entitled to api due to the entitlement being disabled in the billing contract',
                  },
                ],
              },
            },
          ],
        },
        403
      )
    );

    const client = new SnykClient({ token: 'secret-token' });
    await expect(client.listProjects('org-123')).rejects.toMatchObject({
      code: ErrorCodes.PERMISSION_DENIED,
      message: expect.stringContaining('Snyk REST API access is forbidden'),
      nextSteps: expect.arrayContaining([expect.stringContaining('API access')]),
    });
  });

  it('lists projects with target expansion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'project-1',
            attributes: { name: 'web' },
            relationships: {
              target: {
                data: {
                  id: 'target-1',
                  attributes: { url: 'https://github.com/acme/web' },
                },
              },
            },
          },
        ],
        links: {},
      })
    );

    const client = new SnykClient({ token: 'token-123' });
    const result = await client.listProjects('org-123');

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.id).toBe('project-1');

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://api.snyk.io/rest/orgs/org-123/projects?version=2024-10-15&limit=100&expand=target');
  });

  it('filters issues by project ID when scoped to the current project', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        data: [issue('issue-1', 'high')],
        links: {},
      })
    );

    const client = new SnykClient({ token: 'token-123' });
    const result = await client.listIssues('org-123', { projectId: 'project-1' });

    expect(result.issues).toHaveLength(1);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe(
      'https://api.snyk.io/rest/orgs/org-123/issues?version=2024-10-15&limit=100&scan_item.id=project-1'
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), { status });
}

function issue(id: string, level: string) {
  return {
    id,
    type: 'issue',
    attributes: {
      key: `SNYK-JS-${id}`,
      title: `Issue ${id}`,
      type: 'vulnerability',
      status: 'open',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      severities: [{ level, score: 7.5 }],
    },
    relationships: {
      package: { data: { id: 'pkg:npm/package@1.0.0' } },
    },
  };
}
