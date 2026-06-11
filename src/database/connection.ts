import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Initialize SQLite connection with schema migration */
export function createConnection(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable foreign keys and WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply schema from database directory (handles both src/ and dist/ layouts)
  const schemaPath = join(__dirname, '..', 'database', 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);
  migrateSyncFreshness(db);

  return db;
}

function migrateSyncFreshness(db: Database.Database): void {
  const columns = new Set(
    (
      db.prepare('PRAGMA table_info(findings)').all() as Array<{
        name: string;
      }>
    ).map((column) => column.name)
  );
  const additions: Array<{ name: string; definition: string }> = [
    { name: 'sync_source_id', definition: 'sync_source_id TEXT' },
    { name: 'sync_scope_key', definition: 'sync_scope_key TEXT' },
    { name: 'sync_run_id', definition: 'sync_run_id TEXT' },
    { name: 'sync_seen_at', definition: 'sync_seen_at TEXT' },
    { name: 'is_stale', definition: 'is_stale INTEGER NOT NULL DEFAULT 0' },
    { name: 'is_current_scope', definition: 'is_current_scope INTEGER NOT NULL DEFAULT 1' },
    { name: 'stale_since_at', definition: 'stale_since_at TEXT' },
  ];

  for (const addition of additions) {
    if (!columns.has(addition.name)) {
      db.exec(`ALTER TABLE findings ADD COLUMN ${addition.definition}`);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_findings_is_stale ON findings(is_stale);
    CREATE INDEX IF NOT EXISTS idx_findings_current_scope ON findings(is_current_scope, is_stale);
    CREATE INDEX IF NOT EXISTS idx_findings_sync_scope ON findings(sync_scope_key, is_current_scope, is_stale);
    INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (2, 'finding_sync_freshness');
  `);
  migrateSyncLogFreshness(db);
}

function migrateSyncLogFreshness(db: Database.Database): void {
  const columns = new Set(
    (
      db.prepare('PRAGMA table_info(sync_logs)').all() as Array<{
        name: string;
      }>
    ).map((column) => column.name)
  );
  const additions: Array<{ name: string; definition: string }> = [
    { name: 'findings_stale_marked', definition: 'findings_stale_marked INTEGER NOT NULL DEFAULT 0' },
    { name: 'stale_isolation_applied', definition: 'stale_isolation_applied INTEGER NOT NULL DEFAULT 0' },
  ];

  for (const addition of additions) {
    if (!columns.has(addition.name)) {
      db.exec(`ALTER TABLE sync_logs ADD COLUMN ${addition.definition}`);
    }
  }
}

/** Get current schema version from the database */
export function getSchemaVersion(db: Database.Database): number {
  try {
    const result = db
      .prepare('SELECT MAX(version) as version FROM schema_migrations')
      .get() as { version: number | null };
    return result?.version ?? 0;
  } catch {
    return 0;
  }
}

/** Close database connection gracefully */
export function closeConnection(db: Database.Database): void {
  db.close();
}
