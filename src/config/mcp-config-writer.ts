import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { z } from 'zod';
import { FindingBridgeError, ErrorCodes } from '../core/errors.js';
import { redactSecrets } from '../utils/redaction.js';
import { DEFAULT_MCP_SERVER_NAME } from './defaults.js';
import type { DetectedMcpClient } from './mcp-client-detector.js';

const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type McpConfigWriteResult = {
  client: DetectedMcpClient;
  configPath: string;
  backupPath?: string;
  serverName: string;
};

/** Merge FindingBridge into an MCP client config while preserving unrelated servers and settings. */
export async function writeMcpClientConfig(params: {
  client: DetectedMcpClient;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  serverName?: string;
}): Promise<McpConfigWriteResult> {
  const configPath = resolve(params.client.configPath);
  const serverName = params.serverName ?? DEFAULT_MCP_SERVER_NAME;
  const existing = await readExistingConfig(configPath);
  const backupPath = params.client.exists ? `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;

  const merged = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      [serverName]: {
        command: params.command,
        args: params.args ?? ['server'],
        env: params.env ?? {},
      },
    },
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

async function readExistingConfig(configPath: string): Promise<z.infer<typeof McpConfigSchema>> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    return McpConfigSchema.parse(JSON.parse(raw));
  } catch {
    return { mcpServers: {} };
  }
}
