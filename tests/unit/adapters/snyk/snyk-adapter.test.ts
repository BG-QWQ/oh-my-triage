import { describe, expect, it, vi } from 'vitest';
import { Finding } from '@/core/models/finding.js';
import { SnykAdapter, mapSnykIssueToFinding } from '@/adapters/snyk/snyk-adapter.js';
import type { SnykIssue } from '@/adapters/snyk/snyk-schemas.js';

describe('SnykAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tests connection by listing organizations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'org-1', attributes: { name: 'Acme', slug: 'acme' } }], links: {} })
    );

    const adapter = new SnykAdapter({ token: 'token-123' });
    const result = await adapter.testConnection();

    expect(result.valid).toBe(true);
    expect(result.orgs_found).toBe(1);
  });

  it('reports invalid connection when token is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const adapter = new SnykAdapter({ token: 'bad-token' });
    const result = await adapter.testConnection();

    expect(result.valid).toBe(false);
    expect(result.suggestion).toContain('token');
  });

  it('fetches findings with cursor pagination', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: [issue('issue-1')],
          links: { next: '/rest/orgs/org-123/issues?version=2024-10-15&limit=100&starting_after=cursor-2' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [issue('issue-2')], links: {} }));

    const adapter = new SnykAdapter({ token: 'token-123', orgId: 'org-123' });
    const firstPage = await adapter.fetchFindings({});
    expect(firstPage.findings).toHaveLength(1);
    expect(firstPage.has_more).toBe(true);

    const secondPage = await adapter.fetchFindings({ cursor: firstPage.next_cursor });
    expect(secondPage.findings).toHaveLength(1);
    expect(secondPage.has_more).toBe(false);
  });

  it('requires org id to fetch findings', async () => {
    const adapter = new SnykAdapter({ token: 'token-123' });
    await expect(adapter.fetchFindings({})).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('iterates through project IDs when scoped to the current repository', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: [issue('issue-web')],
          links: {},
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [issue('issue-api')],
          links: {},
        })
      );

    const adapter = new SnykAdapter({
      token: 'token-123',
      orgId: 'org-123',
      projectIds: ['project-web', 'project-api'],
    });

    const firstPage = await adapter.fetchFindings({});
    expect(firstPage.findings).toHaveLength(1);
    expect(firstPage.findings[0]).toMatchObject({ source: { original_id: 'issue-web' } });
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_cursor).toBe('1');

    const secondPage = await adapter.fetchFindings({ cursor: firstPage.next_cursor });
    expect(secondPage.findings).toHaveLength(1);
    expect(secondPage.findings[0]).toMatchObject({ source: { original_id: 'issue-api' } });
    expect(secondPage.has_more).toBe(false);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toContain('scan_item.id=project-web');
    expect(calls[1][0]).toContain('scan_item.id=project-api');
  });
});

describe('mapSnykIssueToFinding', () => {
  it('maps a Snyk issue to a valid Finding', () => {
    const finding = mapSnykIssueToFinding(issue('issue-1'));
    expect(finding.source.tool).toBe('Snyk');
    expect(finding.source.original_id).toBe('issue-1');
    expect(finding.severity).toBe('high');
    expect(finding.raw_severity).toBe('high');
    expect(() => Finding.parse(finding)).not.toThrow();
  });

  it('uses package PURL for location when available', () => {
    const finding = mapSnykIssueToFinding(issue('issue-1'));
    expect(finding.location.file_path).toContain('pkg:npm/package@1.0.0');
  });

  it('creates a synthetic location when package PURL is missing', () => {
    const snykIssue = issue('issue-1');
    snykIssue.relationships = {};
    const finding = mapSnykIssueToFinding(snykIssue);
    expect(finding.location.file_path).toMatch(/^snyk:/);
  });
});

function issue(id: string): SnykIssue {
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
      severities: [{ level: 'high', score: 7.5 }],
    },
    relationships: {
      package: { data: { id: 'pkg:npm/package@1.0.0' } },
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), { status });
}
