import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { handleApiRequest } from './api-handlers.js';

/** MIME type map for static file serving */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Resolve content type from file extension */
function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Read a static file from the dist/web-ui directory */
async function readStaticFile(rootDir: string, urlPath: string): Promise<{ data: Buffer; contentType: string } | null> {
  // Normalize: strip leading slash, default to index.html
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const absolutePath = join(rootDir, 'web-ui', relativePath);

  // Prevent path traversal
  if (!absolutePath.startsWith(join(rootDir, 'web-ui'))) {
    return null;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return null;
    }
    const data = await readFile(absolutePath);
    return { data, contentType: contentTypeFor(absolutePath) };
  } catch {
    return null;
  }
}

/** Serve a 404 response */
function serveNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}


/** Options for creating the static assets server */
export interface StaticServerOptions {
  /** Port to listen on (default: 0 = random available port) */
  port?: number;
  /** Host to bind to (default: 'localhost') */
  host?: string;
  /** Root directory containing the web-ui folder (default: dist/) */
  rootDir?: string;
}

/** Result of starting the static server */
export interface StaticServerResult {
  /** The running HTTP server */
  server: Server;
  /** The URL the wizard is accessible at */
  url: string;
  /** The port the server is listening on */
  port: number;
}

/**
 * Start an HTTP server serving the Web UI static assets.
 *
 * Serves files from `{rootDir}/web-ui/` with correct content types.
 * Falls back to `index.html` for unknown routes (SPA support).
 * Handles 404s and path traversal attempts gracefully.
 *
 * @param options - Server configuration options
 * @returns The server instance, URL, and port
 */
export async function startStaticServer(options: StaticServerOptions = {}): Promise<StaticServerResult> {
  const port = options.port ?? 0;
  const host = options.host ?? 'localhost';
  const rootDir = options.rootDir ?? join(fileURLToPath(new URL('.', import.meta.url)), '..');

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleStaticRequest(req, res, rootDir);
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Static server failed to start', { error: message });
      reject(new Error(`Failed to start static server: ${message}`));
    });

    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      const actualPort = address.port;
      const url = `http://${host}:${actualPort}`;
      logger.info(`Setup wizard available at ${url}`);
      resolve({ server, url, port: actualPort });
    });
  });
}

async function handleStaticRequest(req: IncomingMessage, res: ServerResponse, rootDir: string): Promise<void> {
  const urlPath = req.url?.split('?')[0] ?? '/';

  // Handle API requests first
  if (urlPath.startsWith('/api/')) {
    const handled = await handleApiRequest(req, res);
    if (handled) return;
  }

  const result = await readStaticFile(rootDir, urlPath);
  if (result) {
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(result.data);
    return;
  }

  // SPA fallback: try serving index.html for unknown routes
  if (urlPath !== '/' && !urlPath.startsWith('/api/')) {
    const fallback = await readStaticFile(rootDir, '/');
    if (fallback) {
      res.writeHead(200, {
        'Content-Type': fallback.contentType,
        'Cache-Control': 'no-cache',
      });
      res.end(fallback.data);
      return;
    }
  }

  serveNotFound(res);
}

/**
 * Gracefully shut down the static server.
 *
 * @param server - The server instance to close
 */
export async function stopStaticServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        logger.info('Static server stopped');
        resolve();
      }
    });
  });
}
