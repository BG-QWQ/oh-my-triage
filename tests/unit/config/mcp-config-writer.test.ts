import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MCP_SERVER_NAME, LEGACY_MCP_SERVER_NAME } from '@/config/defaults.js';
import { writeMcpClientConfig } from '@/config/mcp-config-writer.js';
import type { DetectedMcpClient } from '@/config/mcp-client-detector.js';

const tempDirs: string[] = [];

describe('writeMcpClientConfig', () => {
  afterEach(async () => {
    const dirs = tempDirs.splice(0);
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes new MCP configs with the canonical server key and OMT_DB_PATH env', async () => {
    const configPath = await tempConfigPath('new-client.json');
    const dbPath = await tempDbPath('oh-my-triage.db');
    const client = mcpClient(configPath, false);

    const result = await writeMcpClientConfig({
      client,
      command: 'oh-my-triage',
      args: ['server'],
      env: { OMT_DB_PATH: dbPath },
    });

    const config = await readJson(configPath);
    expect(result.serverName).toBe(DEFAULT_MCP_SERVER_NAME);
    expect(result.backupPath).toBeUndefined();
    expect(config).toEqual({
      mcpServers: {
        [DEFAULT_MCP_SERVER_NAME]: {
          command: 'oh-my-triage',
          args: ['server'],
          env: { OMT_DB_PATH: dbPath },
        },
      },
    });
  });

  it('renames a legacy-only server key to the canonical key and creates a backup', async () => {
    const dbPath = await tempDbPath('oh-my-triage.db');
    const legacyDbPath = await tempDbPath('findingbridge.db');
    const configPath = await writeInitialConfig('legacy-only.json', {
      theme: 'dark',
      mcpServers: {
        unrelated: { command: 'other-tool' },
        [LEGACY_MCP_SERVER_NAME]: {
          command: 'findingbridge',
          args: ['server'],
          env: { FINDINGBRIDGE_DB_PATH: legacyDbPath },
        },
      },
    });

    const result = await writeMcpClientConfig({
      client: mcpClient(configPath, true),
      command: 'oh-my-triage',
      args: ['server'],
      env: { OMT_DB_PATH: dbPath },
    });

    const config = await readJson(configPath);
    expect(result.warning).toBeUndefined();
    expect(result.backupPath).toEqual(expect.stringContaining(`${configPath}.bak-`));
    expect(config.theme).toBe('dark');
    expect(config.mcpServers).toEqual({
      unrelated: { command: 'other-tool' },
      [DEFAULT_MCP_SERVER_NAME]: {
        command: 'oh-my-triage',
        args: ['server'],
        env: { OMT_DB_PATH: dbPath },
      },
    });

    const backup = await readJson(result.backupPath ?? '');
    expect(backup.mcpServers).toHaveProperty(LEGACY_MCP_SERVER_NAME);
  });

  it('updates the canonical key and leaves the legacy key in place with a warning when both exist', async () => {
    const dbPath = await tempDbPath('oh-my-triage.db');
    const externalConfigPath = await tempConfigPath('external-config.json');
    const legacyConfig = { command: 'findingbridge', args: ['server'] };
    const configPath = await writeInitialConfig('conflict.json', {
      mcpServers: {
        [LEGACY_MCP_SERVER_NAME]: legacyConfig,
        [DEFAULT_MCP_SERVER_NAME]: { command: 'old-oh-my-triage', args: ['server'] },
      },
    });

    const result = await writeMcpClientConfig({
      client: mcpClient(configPath, true),
      command: 'oh-my-triage',
      args: ['server', '--config', externalConfigPath],
      env: { OMT_DB_PATH: dbPath },
    });

    const config = await readJson(configPath);
    expect(result.warning).toContain(DEFAULT_MCP_SERVER_NAME);
    expect(result.warning).toContain(LEGACY_MCP_SERVER_NAME);
    expect(config.mcpServers).toEqual({
      [LEGACY_MCP_SERVER_NAME]: legacyConfig,
      [DEFAULT_MCP_SERVER_NAME]: {
        command: 'oh-my-triage',
        args: ['server', '--config', externalConfigPath],
        env: { OMT_DB_PATH: dbPath },
      },
    });
  });

  it('preserves unrelated MCP client config keys while updating the canonical server entry', async () => {
    const dbPath = await tempDbPath('oh-my-triage.db');
    const configPath = await writeInitialConfig('preserve.json', {
      globalShortcut: 'Ctrl+Shift+M',
      mcpServers: {
        [DEFAULT_MCP_SERVER_NAME]: { command: 'old-command', args: ['server'] },
        anotherServer: { command: 'another-tool', env: { TOKEN: 'keep-me' } },
      },
      nested: { keep: true },
    });

    await writeMcpClientConfig({
      client: mcpClient(configPath, true),
      command: 'oh-my-triage',
      args: ['server'],
      env: { OMT_DB_PATH: dbPath },
    });

    const config = await readJson(configPath);
    expect(config.globalShortcut).toBe('Ctrl+Shift+M');
    expect(config.nested).toEqual({ keep: true });
    expect(config.mcpServers).toEqual({
      [DEFAULT_MCP_SERVER_NAME]: {
        command: 'oh-my-triage',
        args: ['server'],
        env: { OMT_DB_PATH: dbPath },
      },
      anotherServer: { command: 'another-tool', env: { TOKEN: 'keep-me' } },
    });
  });
});

async function tempConfigPath(fileName: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omt-mcp-config-'));
  tempDirs.push(dir);
  return join(dir, fileName);
}

async function tempDbPath(fileName: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omt-mcp-db-'));
  tempDirs.push(dir);
  return join(dir, fileName);
}

async function writeInitialConfig(fileName: string, config: Record<string, unknown>): Promise<string> {
  const configPath = await tempConfigPath(fileName);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return configPath;
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
}

function mcpClient(configPath: string, exists: boolean): DetectedMcpClient {
  return {
    id: 'claude_desktop',
    name: 'Claude Desktop',
    configPath,
    exists,
    format: 'mcpServers',
  };
}
