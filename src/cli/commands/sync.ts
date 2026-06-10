import { Command } from 'commander';
import { loadOrCreateConfig } from '../../config/config.js';
import { FindingBridgeError, ErrorCodes } from '../../core/errors.js';
import { closeConnection, createConnection } from '../../database/connection.js';
import { SourceSyncService } from '../../sync/source-sync.js';

type SyncOptions = {
  source?: string[];
  db?: string;
  config?: string;
  maxPages?: string;
};

/** Create the `sync` command for pulling configured scanner findings into SQLite. */
export function createSyncCommand(): Command {
  return new Command('sync')
    .description('Synchronize findings from configured scanner sources into the local database')
    .option('--source <id>', 'Source identifier to sync; repeat for multiple sources', collectSource, [])
    .option('--db <path>', 'Path to SQLite database')
    .option('-c, --config <path>', 'Configuration file path')
    .option('--max-pages <number>', 'Maximum pages to fetch per source', String(20))
    .action(async (options: SyncOptions) => {
      const loadedConfig = await loadOrCreateConfig(options.config);
      const dbPath = options.db ?? loadedConfig.config.database_path;
      if (!dbPath) {
        throw new FindingBridgeError({
          code: ErrorCodes.DB_CONNECTION_FAILED,
          message: 'Database path is not configured.',
          nextSteps: ['Run `findingbridge init` or pass `--db path/to/findingbridge.db`.'],
        });
      }

      const db = createConnection(dbPath);
      try {
        const service = new SourceSyncService({ db, config: loadedConfig.config, databasePath: dbPath });
        const result = await service.syncSources({
          sourceIds: options.source,
          maxPages: parsePositiveInt(options.maxPages, 'max-pages'),
        });
        console.log(JSON.stringify(result, null, 2));
      } finally {
        closeConnection(db);
      }
    });
}

function collectSource(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new FindingBridgeError({
      code: ErrorCodes.CONFIG_INVALID,
      message: `${name} must be a positive integer.`,
      nextSteps: [`Pass --${name} with a value of 1 or greater.`],
      retryable: false,
    });
  }
  return parsed;
}
