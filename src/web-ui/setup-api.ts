/** Base URL for the setup API (defaults to current origin) */
const API_BASE = '';

/** Generic fetch wrapper with error handling */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, response.statusText, body);
  }

  const data: unknown = await response.json();
  return data as T;
}

/** API error with status code and response body */
export class ApiError extends Error {
  /** HTTP status code */
  public readonly status: number;
  /** Response body text */
  public readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`API error ${status}: ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// ── Type definitions (no runtime validation needed in browser) ──────────────────────────────────────────────

/** Scanner source types available for setup */
export type ScannerType = 'sarif' | 'github' | 'sonarcloud';

/** Setup status response */
export interface SetupStatus {
  initialized: boolean;
  configured_scanners: ScannerType[];
  total_findings: number;
  mcp_clients_detected: string[];
}

/** Connection test request */
export interface TestConnectionRequest {
  scanner_type: ScannerType;
  config: Record<string, unknown>;
}

/** Connection test response */
export interface TestConnectionResponse {
  valid: boolean;
  reason?: string;
  suggestion?: string;
  help_url?: string;
  projects_found?: number;
  orgs_found?: number;
}

/** MCP client detection response */
export interface McpClientDetection {
  clients: Array<{
    name: string;
    config_path: string;
    exists: boolean;
  }>;
}

/** MCP config write request */
export interface WriteConfigRequest {
  client_name: string;
  config: Record<string, unknown>;
  backup: boolean;
}

/** MCP config write response */
export interface WriteConfigResponse {
  success: boolean;
  config_path: string;
  backup_path?: string;
  message: string;
}

/** Health check response */
export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
}

// ── API client functions ──────────────────────────────────────────────

/**
 * Fetch the current setup status.
 *
 * Returns which scanners are configured, total findings count,
 * and which MCP clients have been detected.
 */
export async function getSetupStatus(): Promise<SetupStatus> {
  return await apiFetch<SetupStatus>('/api/setup/status');
}

/**
 * Test a scanner connection with the provided configuration.
 *
 * Validates credentials and connectivity for the given scanner type.
 * Returns connection validity, optional error reason, and suggestions.
 *
 * @param scannerType - Which scanner to test
 * @param config - Scanner-specific configuration (tokens, paths, etc.)
 */
export async function testConnection(scannerType: ScannerType, config: Record<string, unknown>): Promise<TestConnectionResponse> {
  const body: TestConnectionRequest = { scanner_type: scannerType, config };
  return await apiFetch<TestConnectionResponse>('/api/setup/test-connection', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Detect installed MCP clients on the user's system.
 *
 * Scans common config paths for Claude Desktop, Cursor, VS Code, etc.
 * Returns each client's name, config path, and whether it exists.
 */
export async function detectMcpClients(): Promise<McpClientDetection> {
  return await apiFetch<McpClientDetection>('/api/setup/detect-mcp-clients', {
    method: 'POST',
  });
}

/**
 * Write MCP configuration for a specific client.
 *
 * Backs up existing config if `backup` is true.
 * Returns the config path and optional backup path.
 *
 * @param clientName - Name of the MCP client (e.g., 'claude-desktop', 'cursor')
 * @param config - MCP server configuration to write
 * @param backup - Whether to back up existing config (default: true)
 */
export async function writeConfig(clientName: string, config: Record<string, unknown>, backup = true): Promise<WriteConfigResponse> {
  const body: WriteConfigRequest = { client_name: clientName, config, backup };
  return await apiFetch<WriteConfigResponse>('/api/setup/write-config', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Check the health of the setup server.
 *
 * Returns server status, version, and uptime.
 */
export async function getHealth(): Promise<HealthResponse> {
  return await apiFetch<HealthResponse>('/api/setup/health');
}