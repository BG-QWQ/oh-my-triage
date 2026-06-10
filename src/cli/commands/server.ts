import { Command } from 'commander';
import { loadOrCreateConfig } from '../../config/config.js';
import { logger } from '../../utils/logger.js';
import { runDemoMode } from '../demo-mode.js';
import { startFindingBridgeStdioServer } from '../../mcp-server/stdio.js';

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
  logger.info('Starting FindingBridge MCP server over stdio.', { db_path: dbPath });
  await startFindingBridgeStdioServer(dbPath);
}
