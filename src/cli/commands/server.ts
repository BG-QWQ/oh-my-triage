import { Command } from 'commander';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConnection, closeConnection } from '../../database/connection.js';
import { FindingRepository } from '../../database/repositories/finding-repo.js';
import { loadOrCreateConfig } from '../../config/config.js';
import { logger } from '../../utils/logger.js';
import { runDemoMode } from '../demo-mode.js';

type ServerOptions = {
  demo?: boolean;
  db?: string;
  config?: string;
};

/** Create the `server` command for starting FindingBridge MCP over stdio. */
export function createServerCommand(): Command {
  return new Command('server')
    .description('Start the FindingBridge MCP server')
    .option('--demo', 'Run in demo mode with sample data')
    .option('--db <path>', 'Path to SQLite database')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: ServerOptions) => {
      if (options.demo) {
        await runDemoMode();
        return;
      }

      const loadedConfig = await loadOrCreateConfig(options.config);
      const dbPath = options.db ?? loadedConfig.config.database_path;
      if (!dbPath) {
        throw new Error('Database path is not configured. Run findingbridge init or pass --db.');
      }
      await startMcpServer(dbPath);
    });
}

/** Start a stdio MCP server backed by the configured SQLite database. */
export async function startMcpServer(dbPath: string): Promise<void> {
  const db = createConnection(dbPath);
  const repo = new FindingRepository(db);
  const server = new McpServer({ name: 'findingbridge', version: '0.1.0' });

  server.registerTool(
    'findingbridge_list_findings',
    {
      title: 'List findings',
      description: 'List normalized scanner findings with filtering and pagination.',
      inputSchema: {
        severity: z.array(z.enum(['critical', 'high', 'medium', 'low', 'info'])).optional(),
        status: z.array(z.enum(['open', 'dismissed', 'fixed', 'false_positive'])).optional(),
        tool: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ severity, status, tool, limit, offset }) => {
      const result = repo.list({ severity, status, tool, limit, offset });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'findingbridge_get_finding',
    {
      title: 'Get finding',
      description: 'Get one normalized scanner finding by FindingBridge ID.',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const finding = repo.getById(id);
      const payload = finding ?? { error: 'Finding not found', id };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    'findingbridge_summary',
    {
      title: 'Summarize findings',
      description: 'Return finding counts by severity.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const payload = { severity_counts: repo.countBySeverity() };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  process.once('SIGINT', () => {
    closeConnection(db);
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    closeConnection(db);
    process.exit(0);
  });

  logger.info('Starting FindingBridge MCP server over stdio.', { db_path: dbPath });
  await server.connect(new StdioServerTransport());
}
