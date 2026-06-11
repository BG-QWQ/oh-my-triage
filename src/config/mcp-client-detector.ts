import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type McpClientId = 'claude_desktop' | 'claude_code' | 'cursor' | 'vscode' | 'opencode' | 'windsurf' | 'cline';

export type McpClientFormat = 'mcpServers' | 'servers' | 'mcp' | 'context_servers';

export type DetectedMcpClient = {
  id: McpClientId;
  name: string;
  configPath: string;
  exists: boolean;
  format: McpClientFormat;
};

/** Return common MCP client configuration paths for the current platform. */
export function getCandidateMcpClients(): DetectedMcpClient[] {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');

  if (process.platform === 'win32') {
    return [
      { id: 'claude_desktop', name: 'Claude Desktop', configPath: join(appData, 'Claude', 'claude_desktop_config.json'), exists: false, format: 'mcpServers' },
      { id: 'claude_code', name: 'Claude Code', configPath: join(home, '.claude.json'), exists: false, format: 'mcpServers' },
      { id: 'cursor', name: 'Cursor', configPath: join(home, '.cursor', 'mcp.json'), exists: false, format: 'mcpServers' },
      { id: 'vscode', name: 'VS Code', configPath: join(home, '.vscode', 'mcp.json'), exists: false, format: 'servers' },
      { id: 'opencode', name: 'OpenCode', configPath: join(home, '.config', 'opencode', 'opencode.json'), exists: false, format: 'mcp' },
      { id: 'windsurf', name: 'Windsurf', configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'), exists: false, format: 'mcpServers' },
      { id: 'cline', name: 'Cline', configPath: join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), exists: false, format: 'mcpServers' },
    ];
  }

  if (process.platform === 'darwin') {
    return [
      { id: 'claude_desktop', name: 'Claude Desktop', configPath: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), exists: false, format: 'mcpServers' },
      { id: 'claude_code', name: 'Claude Code', configPath: join(home, '.claude.json'), exists: false, format: 'mcpServers' },
      { id: 'cursor', name: 'Cursor', configPath: join(home, '.cursor', 'mcp.json'), exists: false, format: 'mcpServers' },
      { id: 'vscode', name: 'VS Code', configPath: join(home, '.vscode', 'mcp.json'), exists: false, format: 'servers' },
      { id: 'opencode', name: 'OpenCode', configPath: join(home, '.config', 'opencode', 'opencode.json'), exists: false, format: 'mcp' },
      { id: 'windsurf', name: 'Windsurf', configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'), exists: false, format: 'mcpServers' },
      { id: 'cline', name: 'Cline', configPath: join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), exists: false, format: 'mcpServers' },
    ];
  }

  return [
    { id: 'claude_desktop', name: 'Claude Desktop', configPath: join(home, '.config', 'Claude', 'claude_desktop_config.json'), exists: false, format: 'mcpServers' },
    { id: 'claude_code', name: 'Claude Code', configPath: join(home, '.claude.json'), exists: false, format: 'mcpServers' },
    { id: 'cursor', name: 'Cursor', configPath: join(home, '.cursor', 'mcp.json'), exists: false, format: 'mcpServers' },
    { id: 'vscode', name: 'VS Code', configPath: join(home, '.vscode', 'mcp.json'), exists: false, format: 'servers' },
    { id: 'opencode', name: 'OpenCode', configPath: join(home, '.config', 'opencode', 'opencode.json'), exists: false, format: 'mcp' },
    { id: 'windsurf', name: 'Windsurf', configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'), exists: false, format: 'mcpServers' },
    { id: 'cline', name: 'Cline', configPath: join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), exists: false, format: 'mcpServers' },
  ];
}

/** Detect installed MCP client config files without creating or modifying them.
 * Only returns clients that actually exist on the system. */
export async function detectMcpClients(overrides?: Partial<Record<McpClientId, string>>): Promise<DetectedMcpClient[]> {
  const candidates = getCandidateMcpClients().map((client) => ({
    ...client,
    configPath: overrides?.[client.id] ?? client.configPath,
  }));

  const detected = await Promise.all(
    candidates.map(async (client) => ({
      ...client,
      exists: await pathExists(client.configPath),
    }))
  );

  // Only return clients that actually exist
  return detected.filter((client) => client.exists);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
