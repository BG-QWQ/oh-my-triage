import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/config/validation.js';
import { handleApiRequest } from '@/web-ui/api-handlers.js';

type HeaderValue = string | number | string[];

const configState = vi.hoisted(() => ({
  savedConfig: undefined as Config | undefined,
  loadedConfig: undefined as Config | undefined,
}));

const credentialState = vi.hoisted(() => ({
  setTokenCalls: [] as Array<{ sourceId: string; token: string; storage: string }>,
}));

vi.mock('@/config/config.js', () => ({
  loadOrCreateConfig: vi.fn(async () => ({
    config: configState.loadedConfig ?? baseConfig(),
    filepath: 'oh-my-triage.config.json',
  })),
  saveConfig: vi.fn(async (config: Config) => {
    configState.savedConfig = config;
    return 'oh-my-triage.config.json';
  }),
}));

vi.mock('@/config/credential-store.js', () => ({
  CredentialStore: class {
    async setToken(sourceId: string, token: string, storage: string): Promise<{ tokenRef: string; storage: 'env' }> {
      credentialState.setTokenCalls.push({ sourceId, token, storage });
      return { tokenRef: 'OMT_TOKEN_GITHUB_CODE_SCANNING', storage: 'env' };
    }

    envName(sourceId: string): string {
      return `OMT_TOKEN_${sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    }
  },
}));

describe('handleApiRequest', () => {
  beforeEach(() => {
    configState.savedConfig = undefined;
    configState.loadedConfig = undefined;
    credentialState.setTokenCalls = [];
  });

  it('dispatches setup health requests through the route table', async () => {
    const response = new StubResponse();

    const handled = await handleApiRequest(createRequest('/api/setup/health', 'GET'), response as unknown as ServerResponse);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"status":"ok"');
    expect(response.body).toContain('"version":"0.1.0"');
  });

  it('returns false for non-API requests', async () => {
    const response = new StubResponse();

    const handled = await handleApiRequest(createRequest('/setup', 'GET'), response as unknown as ServerResponse);

    expect(handled).toBe(false);
    expect(response.body).toBe('');
  });

  it('rejects unknown setup API routes with JSON 404', async () => {
    const response = new StubResponse();

    const handled = await handleApiRequest(createRequest('/api/setup/missing', 'GET'), response as unknown as ServerResponse);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('{"error":"API endpoint not found: GET /api/setup/missing"}');
  });

  it('rejects GitHub setup saves without a selected repository', async () => {
    const response = new StubResponse();
    const request = createJsonRequest('/api/setup/save', 'POST', {
      token_storage: 'env',
      sources: [
        {
          id: 'github-code-scanning',
          type: 'github',
          name: 'GitHub Code Scanning',
          enabled: true,
          options: {},
        },
      ],
    });

    const handled = await handleApiRequest(request, response as unknown as ServerResponse);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('requires a selected repository owner and name');
  });

  it('expands GitHub setup repository selections into per-repository sources', async () => {
    const response = new StubResponse();
    const request = createJsonRequest('/api/setup/save', 'POST', {
      token_storage: 'env',
      sources: [
        {
          id: 'github-code-scanning',
          type: 'github',
          name: 'GitHub Code Scanning',
          enabled: true,
          token: 'token-123',
          options: {
            repositories: [
              { owner: 'acme', repo: 'api' },
              { owner: 'acme', repo: 'web' },
            ],
          },
        },
      ],
    });

    const handled = await handleApiRequest(request, response as unknown as ServerResponse);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(credentialState.setTokenCalls).toEqual([{ sourceId: 'github-code-scanning', token: 'token-123', storage: 'env' }]);
    expect(configState.savedConfig?.sources).toEqual([
      expect.objectContaining({
        id: 'github-code-scanning',
        token_ref: 'OMT_TOKEN_GITHUB_CODE_SCANNING',
        options: { owner: 'acme', repo: 'api' },
      }),
      expect.objectContaining({
        id: 'github-code-scanning-acme-web',
        token_ref: 'OMT_TOKEN_GITHUB_CODE_SCANNING',
        options: { owner: 'acme', repo: 'web' },
      }),
    ]);
    expect(JSON.stringify(configState.savedConfig?.sources)).not.toContain('repositories');
    expect(response.body).toContain('"configured_scanners":["github"]');
  });

  it('preserves omitted existing sources when saving a partial setup payload', async () => {
    configState.loadedConfig = baseConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'findings.sarif',
        options: {},
      },
      {
        id: 'custom-source',
        type: 'semgrep',
        enabled: true,
        options: { mode: 'external' },
      },
    ]);
    const response = new StubResponse();
    const request = createJsonRequest('/api/setup/save', 'POST', {
      token_storage: 'env',
      sources: [],
    });

    const handled = await handleApiRequest(request, response as unknown as ServerResponse);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(configState.savedConfig?.sources).toHaveLength(2);
    expect(configState.savedConfig?.sources).toEqual(expect.arrayContaining(configState.loadedConfig.sources));
  });
});

function createRequest(url: string, method: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    method,
    headers: {},
  }) as unknown as IncomingMessage;
}

function createJsonRequest(url: string, method: string, body: unknown): IncomingMessage {
  const request = createRequest(url, method);
  process.nextTick(() => {
    request.emit('data', JSON.stringify(body));
    request.emit('end');
  });
  return request;
}

class StubResponse extends EventEmitter {
  statusCode = 0;
  headers: Record<string, HeaderValue> = {};
  body = '';

  writeHead(statusCode: number, headers?: Record<string, HeaderValue>): this {
    this.statusCode = statusCode;
    this.headers = headers ?? {};
    return this;
  }

  setHeader(name: string, value: HeaderValue): this {
    this.headers[name] = value;
    return this;
  }

  end(chunk?: string | Buffer): this {
    this.body += chunk?.toString() ?? '';
    return this;
  }
}

function baseConfig(sources: Config['sources'] = []): Config {
  return {
    version: '1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    token_storage: 'keychain',
    sources,
  };
}
