import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '@/web-ui/api-handlers.js';

type HeaderValue = string | number | string[];

describe('handleApiRequest', () => {
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
});

function createRequest(url: string, method: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    method,
    headers: {},
  }) as unknown as IncomingMessage;
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
