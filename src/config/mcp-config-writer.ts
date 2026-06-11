import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { FindingBridgeError, ErrorCodes } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';
import { DEFAULT_MCP_SERVER_NAME } from './defaults.js';
import type { DetectedMcpClient } from './mcp-client-detector.js';

export type McpConfigWriteResult = {
  client: DetectedMcpClient;
  configPath: string;
  backupPath?: string;
  serverName: string;
};

/** Mapping of format to the MCP key name used in each client's config file. */
const MCP_KEY_MAP: Record<string, string> = {
  mcpServers: 'mcpServers',
  servers: 'servers',
  mcp: 'mcp',
  context_servers: 'context_servers',
};

/** Generate the correct MCP server configuration for the target client format. */
function generateServerConfig(params: {
  client: DetectedMcpClient;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  serverName?: string;
}): Record<string, unknown> {
  const { command, args = ['server'], env = {} } = params;

  switch (params.client.format) {
    case 'mcpServers': {
      // Claude Desktop, Cursor, Claude Code, Windsurf, Cline
      return {
        command,
        args,
        env,
      };
    }
    case 'servers': {
      // VS Code
      return {
        type: 'stdio',
        command,
        args,
        env,
      };
    }
    case 'mcp': {
      // OpenCode
      return {
        type: 'local',
        command: [command, ...args],
        enabled: true,
        environment: env,
      };
    }
    case 'context_servers': {
      // Zed
      return {
        command,
        args,
      };
    }
  }
}

/** Merge FindingBridge into an MCP client config while preserving ALL unrelated keys and settings. */
export async function writeMcpClientConfig(params: {
  client: DetectedMcpClient;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  serverName?: string;
}): Promise<McpConfigWriteResult> {
  const configPath = resolve(params.client.configPath);
  const serverName = params.serverName ?? DEFAULT_MCP_SERVER_NAME;
  const serverConfig = generateServerConfig(params);
  const mcpKey = MCP_KEY_MAP[params.client.format] ?? 'mcpServers';

  // Read the FULL existing config file to preserve all non-MCP keys
  const { existingConfig, existingMcpServers } = await readExistingConfig(configPath, mcpKey);
  const backupPath = params.client.exists ? `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;

  // Merge: preserve all existing MCP servers, only add/update our server
  const mergedMcpServers = {
    ...existingMcpServers,
    [serverName]: serverConfig,
  };

  // Build the final config: preserve ALL original keys, only update the MCP key
  const merged = {
    ...existingConfig,
    [mcpKey]: mergedMcpServers,
  };

  try {
    await mkdir(dirname(configPath), { recursive: true });
    if (backupPath) {
      await copyFile(configPath, backupPath);
    }
    await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  } catch (error: unknown) {
    throw new FindingBridgeError({
      code: ErrorCodes.MCP_CONFIG_WRITE_FAILED,
      message: `Unable to update ${params.client.name} MCP configuration.`,
      nextSteps: ['Close the MCP client if it is locking the file, check permissions, then retry setup.'],
      details: { config_path: configPath, error: redactSecrets(String(error)) },
    });
  }

  return { client: params.client, configPath, backupPath, serverName };
}

/**
 * Read the full existing config file and extract only the MCP server section.
 * Returns both the full config object (to preserve non-MCP keys) and the MCP section.
 */
async function readExistingConfig(configPath: string, mcpKey: string): Promise<{
  existingConfig: Record<string, unknown>;
  existingMcpServers: Record<string, unknown>;
}> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      existingConfig: parsed,
      existingMcpServers: (parsed[mcpKey] as Record<string, unknown>) ?? {},
    };
  } catch {
    return {
      existingConfig: {},
      existingMcpServers: {},
    };
  }
}
