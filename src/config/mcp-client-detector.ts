import { access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export type McpClientId = 'claude_desktop' | 'cursor' | 'vscode';

export type DetectedMcpClient = {
  id: McpClientId;
  name: string;
  configPath: string;
  exists: boolean;
};

/** Return common MCP client configuration paths for the current platform. */
export function getCandidateMcpClients(): DetectedMcpClient[] {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');

  if (process.platform === 'win32') {
    return [
      { id: 'claude_desktop', name: 'Claude Desktop', configPath: join(appData, 'Claude', 'claude_desktop_config.json'), exists: false },
      { id: 'cursor', name: 'Cursor', configPath: join(appData, 'Cursor', 'User', 'mcp.json'), exists: false },
      { id: 'vscode', name: 'VS Code', configPath: join(appData, 'Code', 'User', 'mcp.json'), exists: false },
    ];
  }

  if (process.platform === 'darwin') {
    return [
      { id: 'claude_desktop', name: 'Claude Desktop', configPath: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), exists: false },
      { id: 'cursor', name: 'Cursor', configPath: join(home, 'Library', 'Application Support', 'Cursor', 'User', 'mcp.json'), exists: false },
      { id: 'vscode', name: 'VS Code', configPath: join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'), exists: false },
    ];
  }

  return [
    { id: 'claude_desktop', name: 'Claude Desktop', configPath: join(home, '.config', 'Claude', 'claude_desktop_config.json'), exists: false },
    { id: 'cursor', name: 'Cursor', configPath: join(home, '.config', 'Cursor', 'User', 'mcp.json'), exists: false },
    { id: 'vscode', name: 'VS Code', configPath: join(home, '.config', 'Code', 'User', 'mcp.json'), exists: false },
  ];
}

/** Detect installed MCP client config files without creating or modifying them. */
export async function detectMcpClients(overrides?: Partial<Record<McpClientId, string>>): Promise<DetectedMcpClient[]> {
  const candidates = getCandidateMcpClients().map((client) => ({
    ...client,
    configPath: overrides?.[client.id] ?? client.configPath,
  }));

  return Promise.all(
    candidates.map(async (client) => ({
      ...client,
      exists: await pathExists(client.configPath),
    }))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
