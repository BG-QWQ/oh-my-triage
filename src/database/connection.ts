import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

  return db;
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
