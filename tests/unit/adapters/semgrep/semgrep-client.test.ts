import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes, OMTError } from '@/core/errors.js';
import { SemgrepClient } from '@/adapters/semgrep/semgrep-client.js';

describe('SemgrepClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the deployments endpoint with bearer auth and the project user agent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ deployments: [] }));
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listDeployments()).resolves.toEqual({ deployments: [], hasMore: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://semgrep.dev/api/v1/deployments',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-123',
          'User-Agent': 'oh-my-triage/0.1',
        }),
      })
    );
  });

  it('calls the findings endpoint with page zero and the default page size', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ findings: [] }));
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listFindings('acme', {})).resolves.toEqual({ findings: [], hasMore: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://semgrep.dev/api/v1/deployments/acme/findings?page=0&page_size=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-123',
          'User-Agent': 'oh-my-triage/0.1',
        }),
      })
    );
  });

  it('filters findings by repository names when scoped to the current project', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ findings: [] }));
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listFindings('acme', { repos: ['acme/web'] })).resolves.toEqual({
      findings: [],
      hasMore: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://semgrep.dev/api/v1/deployments/acme/findings?page=0&page_size=100&repos=acme%2Fweb',
      expect.any(Object)
    );
  });

  it('increments the page cursor when the caller advances the page', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ findings: [] }))
      .mockResolvedValueOnce(jsonResponse({ findings: [] }));
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await client.listFindings('acme', { page: 0 });
    await client.listFindings('acme', { page: 1, pageSize: 50 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://semgrep.dev/api/v1/deployments/acme/findings?page=0&page_size=100',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://semgrep.dev/api/v1/deployments/acme/findings?page=1&page_size=50',
      expect.any(Object)
    );
  });

  it('parses nested sastFindings findings responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        sastFindings: {
          findings: [
            {
              id: 'finding-1',
              title: 'SQL injection',
              severity: 'HIGH',
              path: 'src/app.ts',
            },
          ],
        },
      })
    );
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listFindings('acme')).resolves.toEqual({
      findings: [
        expect.objectContaining({
          id: 'finding-1',
          title: 'SQL injection',
          severity: 'HIGH',
          path: 'src/app.ts',
        }),
      ],
      hasMore: false,
    });
  });

  it('falls back to a flat findings array when the nested shape is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        findings: [
          {
            id: 'finding-2',
            title: 'Command injection',
            severity: 'CRITICAL',
            path: 'src/cli.ts',
          },
        ],
      })
    );
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listFindings('acme')).resolves.toEqual({
      findings: [
        expect.objectContaining({
          id: 'finding-2',
          title: 'Command injection',
          severity: 'CRITICAL',
          path: 'src/cli.ts',
        }),
      ],
      hasMore: false,
    });
  });

  it('parses live Semgrep findings with numeric IDs and nested file locations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        findings: [
          {
            id: 12345,
            ref: '12345',
            severity: 'medium',
            status: 'open',
            rule_name: 'typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml',
            rule_message: 'Avoid dangerouslySetInnerHTML',
            location: {
              file_path: 'src/web-ui/app.ts',
              line: 42,
              column: 7,
            },
            rule: {
              name: 'React dangerouslySetInnerHTML',
              message: 'Avoid dangerouslySetInnerHTML',
              cwe_names: ['CWE-79'],
            },
          },
        ],
      })
    );
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listFindings('acme')).resolves.toEqual({
      findings: [
        expect.objectContaining({
          id: '12345',
          severity: 'medium',
          status: 'open',
          rule_name: 'typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml',
          rule_message: 'Avoid dangerouslySetInnerHTML',
          location: expect.objectContaining({
            file_path: 'src/web-ui/app.ts',
            line: 42,
          }),
          rule: expect.objectContaining({
            name: 'React dangerouslySetInnerHTML',
            cwe_names: ['CWE-79'],
          }),
        }),
      ],
      hasMore: false,
    });
  });

  it('rejects live Semgrep findings when the finding ID is not a string or number', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        findings: [
          {
            id: null,
            severity: 'medium',
            location: {
              file_path: 'src/web-ui/app.ts',
              line: 42,
            },
          },
        ],
      })
    );
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    await expect(client.listFindings('acme')).rejects.toMatchObject({
      message: expect.stringContaining('Semgrep findings fetch failed.'),
    });
  });

  it('maps a 401 response to a redacted invalid token error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'token secret-123 was rejected' }, { status: 401, statusText: 'Unauthorized' })
    );
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    let error: OMTError;
    try {
      await client.listDeployments();
      throw new Error('Expected SemgrepClient.listDeployments() to reject');
    } catch (caught: unknown) {
      error = assertOMTError(caught);
    }

    expect(error).toBeInstanceOf(OMTError);
    expect(error.code).toBe(ErrorCodes.TOKEN_INVALID);
    expect(error.message).not.toContain('secret-123');
  });

  it('explains that 404 usually means the token lacks Web API scope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
    );
    const client = new SemgrepClient({ token: 'token-123', apiBaseUrl: 'https://semgrep.dev' });

    let error: OMTError;
    try {
      await client.listFindings('acme');
      throw new Error('Expected SemgrepClient.listFindings() to reject');
    } catch (caught: unknown) {
      error = assertOMTError(caught);
    }

    expect(error).toBeInstanceOf(OMTError);
    expect(error.code).toBe(ErrorCodes.ADAPTER_FETCH_FAILED);
    expect(error.nextSteps.join(' ')).toContain('Web API scope');
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function assertOMTError(caught: unknown): OMTError {
  if (caught instanceof OMTError) {
    return caught;
  }

  throw caught;
}
