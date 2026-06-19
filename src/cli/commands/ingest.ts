import { Command } from 'commander';
import { SarifAdapter } from '../../adapters/sarif/sarif-adapter.js';
import { OMTError, ErrorCodes } from '../../core/errors.js';
import type { Finding } from '../../core/models/finding.js';
import { createConnection, closeConnection } from '../../database/connection.js';
import { FindingRepository } from '../../database/repositories/finding-repo.js';
import { loadOrCreateConfig, resolveDatabasePath } from '../../config/config.js';

type IngestOptions = {
  sarif?: string;
  sourceId?: string;
  db?: string;
  config?: string;
};

/** Create the `ingest` command for importing SARIF findings into SQLite. */
export function createIngestCommand(): Command {
  return new Command('ingest')
    .description('Ingest scanner findings from SARIF files')
    .option('--sarif <path>', 'Path to SARIF file')
    .option('--source-id <id>', 'Source identifier')
    .option('--db <path>', 'Path to SQLite database')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: IngestOptions) => {
      if (!options.sarif) {
        throw new OMTError({
          code: ErrorCodes.SARIF_FILE_NOT_FOUND,
          message: 'A SARIF file path is required.',
          nextSteps: ['Run `oh-my-triage ingest --sarif path/to/results.sarif`.'],
        });
      }

      const loadedConfig = await loadOrCreateConfig(options.config);
      const dbPath = resolveDatabasePath(options.db, loadedConfig.config.database_path);
      if (!dbPath) {
        throw new OMTError({
          code: ErrorCodes.DB_CONNECTION_FAILED,
          message: 'Database path is not configured.',
          nextSteps: ['Run `oh-my-triage init` or pass `--db path/to/oh-my-triage.db`.'],
        });
      }

      const findings = await parseSarifFile(options.sarif);
      const db = createConnection(dbPath);
      try {
        const repo = new FindingRepository(db);
        for (const finding of findings) {
          repo.upsert(finding);
        }
      } finally {
        closeConnection(db);
      }

      console.log(JSON.stringify({ imported: findings.length, db_path: dbPath, sarif_path: options.sarif }, null, 2));
    });
}

/** Parse a SARIF 2.1.0 file into normalized oh-my-triage findings. */
export async function parseSarifFile(filePath: string): Promise<Finding[]> {
  const adapter = new SarifAdapter({ filePath });
  const result = await adapter.fetchFindings();
  return result.findings as Finding[];
}
