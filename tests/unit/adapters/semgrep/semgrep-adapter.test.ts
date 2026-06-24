import { describe, expect, it, vi } from 'vitest';
import { Finding } from '@/core/models/finding.js';
import { SemgrepAdapter, mapSemgrepFindingToFinding } from '@/adapters/semgrep/semgrep-adapter.js';
import type { SemgrepFinding } from '@/adapters/semgrep/semgrep-schemas.js';

describe('SemgrepAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tests connection by listing deployments', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ deployments: [{ slug: 'acme', name: 'Acme' }] })
    );

    const adapter = new SemgrepAdapter({ token: 'token-123' });
    const result = await adapter.testConnection();

    expect(result.valid).toBe(true);
    expect(result.projects_found).toBe(1);
  });

  it('reports invalid connection when token is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const adapter = new SemgrepAdapter({ token: 'bad-token' });
    const result = await adapter.testConnection();

    expect(result.valid).toBe(false);
    expect(result.suggestion).toContain('token');
  });

  it('fetches findings with page pagination', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ sastFindings: { findings: [finding('finding-1')] }, findings: [] })
      )
      .mockResolvedValueOnce(jsonResponse({ sastFindings: { findings: [] }, findings: [] }));

    const adapter = new SemgrepAdapter({ token: 'token-123', deploymentSlug: 'acme' });
    const firstPage = await adapter.fetchFindings({});
    expect(firstPage.findings).toHaveLength(1);
    expect(firstPage.has_more).toBe(false);
  });

  it('requires deployment slug to fetch findings', async () => {
    const adapter = new SemgrepAdapter({ token: 'token-123' });
    await expect(adapter.fetchFindings({})).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('passes repository scope through to the client', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ sastFindings: { findings: [finding('finding-1')] }, findings: [] }));

    const adapter = new SemgrepAdapter({
      token: 'token-123',
      deploymentSlug: 'acme',
      repositoryFullName: 'acme/web',
    });
    const result = await adapter.fetchFindings({});

    expect(result.findings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('repos=acme%2Fweb'),
      expect.any(Object)
    );
  });
});

describe('mapSemgrepFindingToFinding', () => {
  it('maps a Semgrep finding to a valid Finding', () => {
    const result = mapSemgrepFindingToFinding(finding('finding-1'));
    expect(result.source.tool).toBe('Semgrep');
    expect(result.source.original_id).toBe('finding-1');
    expect(result.severity).toBe('high');
    expect(result.raw_severity).toBe('high');
    expect(() => Finding.parse(result)).not.toThrow();
  });

  it('maps legacy ERROR severity to high', () => {
    const semgrepFinding = finding('finding-2');
    semgrepFinding.severity = 'ERROR';
    const result = mapSemgrepFindingToFinding(semgrepFinding);
    expect(result.severity).toBe('high');
  });
});

function finding(id: string): SemgrepFinding {
  return {
    id,
    severity: 'high',
    path: 'src/app.js',
    message: 'Unsafe deserialization',
    ruleId: 'javascript.unsafe-deserialization',
    title: 'Unsafe Deserialization',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), { status });
}
