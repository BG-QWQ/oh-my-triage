import Database from 'better-sqlite3';
import type { SyncLog } from '../../core/models/sync-log.js';

/** Repository for sync log operations */
export class SyncRepository {
  constructor(private readonly db: Database.Database) {}

  /** Create a new sync log entry */
  create(log: SyncLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_logs (id, source, started_at, completed_at, status, findings_found, findings_new, findings_updated, findings_stale_marked, stale_isolation_applied, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.id,
      log.source,
      log.started_at,
      log.completed_at ?? null,
      log.status,
      log.findings_found,
      log.findings_new,
      log.findings_updated,
      log.findings_stale_marked ?? 0,
      log.stale_isolation_applied ? 1 : 0,
      log.error_message ?? null
    );
  }

  /** Update sync log status and completion */
  update(id: string, updates: Partial<SyncLog>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.completed_at !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completed_at);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.findings_found !== undefined) {
      fields.push('findings_found = ?');
      values.push(updates.findings_found);
    }
    if (updates.findings_new !== undefined) {
      fields.push('findings_new = ?');
      values.push(updates.findings_new);
    }
    if (updates.findings_updated !== undefined) {
      fields.push('findings_updated = ?');
      values.push(updates.findings_updated);
    }
    if (updates.findings_stale_marked !== undefined) {
      fields.push('findings_stale_marked = ?');
      values.push(updates.findings_stale_marked);
    }
    if (updates.stale_isolation_applied !== undefined) {
      fields.push('stale_isolation_applied = ?');
      values.push(updates.stale_isolation_applied ? 1 : 0);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = this.db.prepare(`UPDATE sync_logs SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /** Get latest sync log for a source */
  getLatest(source: string): SyncLog | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM sync_logs WHERE source = ? ORDER BY started_at DESC LIMIT 1'
    );
    const row = stmt.get(source) as Record<string, unknown> | undefined;
    return row ? this.rowToSyncLog(row) : undefined;
  }

  /** List all sync logs */
  list(): SyncLog[] {
    const stmt = this.db.prepare('SELECT * FROM sync_logs ORDER BY started_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToSyncLog(r));
  }

  private rowToSyncLog(row: Record<string, unknown>): SyncLog {
    return {
      id: row.id as string,
      source: row.source as string,
      started_at: row.started_at as string,
      completed_at: row.completed_at as string | undefined,
      status: row.status as SyncLog['status'],
      findings_found: row.findings_found as number,
      findings_new: row.findings_new as number,
      findings_updated: row.findings_updated as number,
      findings_stale_marked: row.findings_stale_marked as number,
      stale_isolation_applied: Boolean(row.stale_isolation_applied),
      error_message: row.error_message as string | undefined,
    };
  }
}
