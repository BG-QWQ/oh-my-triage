import { Command } from 'commander';
import { loadOrCreateConfig, resolveDatabasePath } from '../../config/config.js';
import type { SourceConfig, TokenStorage } from '../../config/validation.js';
import { logger } from '../../utils/logger.js';
import { runDemoMode } from '../demo-mode.js';
import { startOMTStdioServer } from '../../mcp-server/stdio.js';

type ServerOptions = {
  demo?: boolean;
  db?: string;
  config?: string;
};

/** Create the `server` command for starting oh-my-triage MCP over stdio. */
export function createServerCommand(): Command {
  return new Command('server')
    .description('Start the oh-my-triage MCP server')
    .option('--demo', 'Run in demo mode with sample data')
    .option('--db <path>', 'Path to SQLite database')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: ServerOptions) => {
      if (options.demo) {
        await runDemoMode();
        return;
      }

      const loadedConfig = await loadOrCreateConfig(options.config);
      const dbPath = resolveDatabasePath(options.db, loadedConfig.config.database_path);
      if (!dbPath) {
        throw new Error('Database path is not configured. Run oh-my-triage init or pass --db.');
      }
      await startMcpServer(dbPath, loadedConfig.config.sources, loadedConfig.config.token_storage);
    });
}

/** Start a stdio MCP server backed by the configured SQLite database. */
export async function startMcpServer(
  dbPath: string,
  configuredSources: SourceConfig[] = [],
  tokenStorage: TokenStorage = 'keychain',
  demoMode = false
): Promise<void> {
  logger.info('Starting oh-my-triage MCP server over stdio.', { db_path: dbPath });
  await startOMTStdioServer({ dbPath, configuredSources, tokenStorage, demoMode });
}
