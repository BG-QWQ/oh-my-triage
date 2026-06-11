import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection, closeConnection } from '../database/connection.js';
import { FindingRepository } from '../database/repositories/finding-repo.js';
import { getDemoDatabasePath } from '../config/defaults.js';
import { parseSarifFile } from './commands/ingest.js';
import { startMcpServer } from './commands/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load bundled demo SARIF data into a temporary database and start the MCP server. */
export async function runDemoMode(): Promise<void> {
  const sarifPath = join(__dirname, '../../demo-data/sample-findings.sarif');
  const dbPath = getDemoDatabasePath();
  const findings = await parseSarifFile(sarifPath);
  const db = createConnection(dbPath);
  try {
    const repo = new FindingRepository(db);
    for (const finding of findings) {
      repo.upsert(finding);
    }
  } finally {
    closeConnection(db);
  }
  await startMcpServer(dbPath, [], 'keychain', true);
}
