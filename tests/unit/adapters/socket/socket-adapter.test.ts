import { describe, expect, it, vi } from 'vitest';
import { Finding } from '@/core/models/finding.js';
import { SocketAdapter, mapSocketAlertToFinding } from '@/adapters/socket/socket-adapter.js';
import type { SocketAlert } from '@/adapters/socket/socket-schemas.js';

describe('SocketAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tests connection by listing organizations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ organizations: { '123456': { id: '123456', name: 'Acme', slug: 'acme' } } })
    );

    const adapter = new SocketAdapter({ token: 'token-123' });
    const result = await adapter.testConnection();

    expect(result.valid).toBe(true);
    expect(result.orgs_found).toBe(1);
  });

  it('reports invalid connection when token is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const adapter = new SocketAdapter({ token: 'bad-token' });
    const result = await adapter.testConnection();

    expect(result.valid).toBe(false);
    expect(result.suggestion).toContain('token');
  });

  it('fetches findings with cursor pagination', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ items: [alert('alert-1')], endCursor: 'cursor-2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [alert('alert-2')], endCursor: null }));

    const adapter = new SocketAdapter({ token: 'token-123', orgSlug: 'acme' });
    const firstPage = await adapter.fetchFindings({});
    expect(firstPage.findings).toHaveLength(1);
    expect(firstPage.has_more).toBe(true);

    const secondPage = await adapter.fetchFindings({ cursor: firstPage.next_cursor });
    expect(secondPage.findings).toHaveLength(1);
    expect(secondPage.has_more).toBe(false);
  });

  it('normalizes live camelCase alert fields before mapping findings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ items: [liveAlert('alert-live-1')], endCursor: null })
    );

    const adapter = new SocketAdapter({ token: 'token-123', orgSlug: 'acme' });
    const result = await adapter.fetchFindings({});

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      source: { original_id: 'alert-live-1' },
      raw_severity: 'high',
      location: { file_path: 'acme/web:main' },
      first_seen_at: '2024-01-01T00:00:00Z',
      last_seen_at: '2024-01-02T00:00:00Z',
    });
  });

  it('requires org slug to fetch findings', async () => {
    const adapter = new SocketAdapter({ token: 'token-123' });
    await expect(adapter.fetchFindings({})).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('passes repository scope through to the client', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ items: [alert('alert-1')], endCursor: null }));

    const adapter = new SocketAdapter({
      token: 'token-123',
      orgSlug: 'acme',
      repositoryFullName: 'acme/web',
    });
    const result = await adapter.fetchFindings({});

    expect(result.findings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('filters.repoFullName=acme/web'),
      expect.any(Object)
    );
  });
});

describe('mapSocketAlertToFinding', () => {
  it('maps a Socket alert to a valid Finding', () => {
    const finding = mapSocketAlertToFinding(alert('alert-1'));
    expect(finding.source.tool).toBe('Socket.dev');
    expect(finding.source.original_id).toBe('alert-1');
    expect(finding.severity).toBe('high');
    expect(finding.raw_severity).toBe('high');
    expect(() => Finding.parse(finding)).not.toThrow();
  });

  it('maps medium severity to unified medium', () => {
    const socketAlert = alert('alert-2');
    socketAlert.severity = 'medium';
    const finding = mapSocketAlertToFinding(socketAlert);
    expect(finding.severity).toBe('medium');
  });
});

function alert(id: string): SocketAlert {
  return {
    id,
    severity: 'high',
    type: 'supply_chain_risk',
    artifact_name: 'lodash',
    repo_full_name: 'acme/app',
    branch: 'main',
    organization: undefined,
    state: undefined,
    cve_id: undefined,
    cwe_id: undefined,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  };
}

function liveAlert(id: string): unknown {
  return {
    id,
    key: `npm:lodash:${id}`,
    severity: 'high',
    type: 'vulnerability',
    title: 'Prototype pollution in lodash',
    description: 'A vulnerable package is reachable from the project.',
    status: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    vulnerability: {
      cveId: 'CVE-2024-0001',
      cweIds: ['CWE-1321'],
    },
    locations: [
      {
        repository: { fullName: 'acme/web', slug: 'web' },
        branch: { name: 'main' },
        artifact: { name: 'lodash' },
      },
    ],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), { status });
}
