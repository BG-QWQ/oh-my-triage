import Database from 'better-sqlite3';
import type { Finding, FixSuggestion } from '../../core/models/finding.js';

/** Repository for findings CRUD and query operations */
export class FindingRepository {
  constructor(private readonly db: Database.Database) {}

  /** Insert or update a finding (upsert by fingerprint) */
  upsert(finding: Finding): void {
    const stmt = this.db.prepare(`
      INSERT INTO findings (
        id, tool, tool_version, rule_id, rule_name, rule_description, rule_help_url,
        original_id, original_url, title, message, severity, raw_severity,
        cwe_id, cwe_name, owasp_category, file_path, start_line, start_column,
        end_line, end_column, code_snippet, status, fingerprint, duplicate_group_id,
        is_duplicate, priority_score, priority_reason, fix_description, fix_code_example,
        fix_effort_estimate, fix_breaking_risk, first_seen_at, last_seen_at,
        dismissed_at, dismissed_reason, raw_data
      ) VALUES (
        @id, @tool, @tool_version, @rule_id, @rule_name, @rule_description, @rule_help_url,
        @original_id, @original_url, @title, @message, @severity, @raw_severity,
        @cwe_id, @cwe_name, @owasp_category, @file_path, @start_line, @start_column,
        @end_line, @end_column, @code_snippet, @status, @fingerprint, @duplicate_group_id,
        @is_duplicate, @priority_score, @priority_reason, @fix_description, @fix_code_example,
        @fix_effort_estimate, @fix_breaking_risk, @first_seen_at, @last_seen_at,
        @dismissed_at, @dismissed_reason, @raw_data
      )
      ON CONFLICT(fingerprint) DO UPDATE SET
        title = excluded.title,
        message = excluded.message,
        severity = excluded.severity,
        raw_severity = excluded.raw_severity,
        status = excluded.status,
        code_snippet = excluded.code_snippet,
        priority_score = excluded.priority_score,
        priority_reason = excluded.priority_reason,
        fix_description = excluded.fix_description,
        fix_code_example = excluded.fix_code_example,
        fix_effort_estimate = excluded.fix_effort_estimate,
        fix_breaking_risk = excluded.fix_breaking_risk,
        last_seen_at = excluded.last_seen_at,
        dismissed_at = excluded.dismissed_at,
        dismissed_reason = excluded.dismissed_reason,
        raw_data = excluded.raw_data,
        updated_at = datetime('now')
    `);

    stmt.run({
      id: finding.id,
      tool: finding.source.tool,
      tool_version: finding.source.tool_version ?? null,
      rule_id: finding.source.rule_id,
      rule_name: finding.source.rule_name ?? null,
      rule_description: finding.source.rule_description ?? null,
      rule_help_url: finding.source.rule_help_url ?? null,
      original_id: finding.source.original_id,
      original_url: finding.source.original_url ?? null,
      title: finding.title,
      message: finding.message,
      severity: finding.severity,
      raw_severity: finding.raw_severity,
      cwe_id: finding.cwe_id ?? null,
      cwe_name: finding.cwe_name ?? null,
      owasp_category: finding.owasp_category ?? null,
      file_path: finding.location.file_path,
      start_line: finding.location.start_line,
      start_column: finding.location.start_column ?? null,
      end_line: finding.location.end_line ?? null,
      end_column: finding.location.end_column ?? null,
      code_snippet: finding.location.code_snippet ?? null,
      status: finding.status,
      fingerprint: finding.fingerprint,
      duplicate_group_id: finding.duplicate_group_id ?? null,
      is_duplicate: finding.is_duplicate ? 1 : 0,
      priority_score: finding.priority_score,
      priority_reason: finding.priority_reason ?? null,
      fix_description: finding.fix_suggestion?.description ?? null,
      fix_code_example: finding.fix_suggestion?.code_example ?? null,
      fix_effort_estimate: finding.fix_suggestion?.effort_estimate ?? null,
      fix_breaking_risk: finding.fix_suggestion?.breaking_risk ?? null,
      first_seen_at: finding.first_seen_at,
      last_seen_at: finding.last_seen_at,
      dismissed_at: finding.dismissed_at ?? null,
      dismissed_reason: finding.dismissed_reason ?? null,
      raw_data: JSON.stringify(finding.raw_data),
    });
  }

  /** Get a finding by internal ID */
  getById(id: string): Finding | undefined {
    const stmt = this.db.prepare('SELECT * FROM findings WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToFinding(row) : undefined;
  }

  /** List findings with optional filters and pagination */
  list(params: {
    severity?: string[];
    tool?: string[];
    status?: string[];
    rule_id?: string;
    file_path?: string;
    limit?: number;
    offset?: number;
    sort_by?: 'severity' | 'date' | 'priority_score';
  }): { findings: Finding[]; total: number } {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (params.severity?.length) {
      conditions.push(`severity IN (${params.severity.map(() => '?').join(',')})`);
      args.push(...params.severity);
    }
    if (params.tool?.length) {
      conditions.push(`tool IN (${params.tool.map(() => '?').join(',')})`);
      args.push(...params.tool);
    }
    if (params.status?.length) {
      conditions.push(`status IN (${params.status.map(() => '?').join(',')})`);
      args.push(...params.status);
    }
    if (params.rule_id) {
      conditions.push('rule_id = ?');
      args.push(params.rule_id);
    }
    if (params.file_path) {
      conditions.push('file_path LIKE ?');
      args.push(`%${params.file_path}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortMap: Record<string, string> = {
      severity: `CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`,
      date: 'last_seen_at DESC',
      priority_score: 'priority_score DESC',
    };
    const orderBy = sortMap[params.sort_by ?? 'priority_score'];

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM findings ${whereClause}`);
    const countResult = countStmt.get(...args) as { total: number };

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const query = `SELECT * FROM findings ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...args, limit, offset) as Record<string, unknown>[];

    return {
      findings: rows.map((r) => this.rowToFinding(r)),
      total: countResult.total,
    };
  }

  /** Count findings by severity */
  countBySeverity(): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT severity, COUNT(*) as count FROM findings GROUP BY severity
    `);
    const rows = stmt.all() as Array<{ severity: string; count: number }>;
    const result: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const row of rows) {
      result[row.severity] = row.count;
    }
    return result;
  }

  /** List scanner tool names currently present in stored findings. */
  listTools(): string[] {
    const stmt = this.db.prepare('SELECT DISTINCT tool FROM findings ORDER BY tool ASC');
    const rows = stmt.all() as Array<{ tool: string }>;
    return rows.map((row) => row.tool);
  }

  /** Update duplicate status for findings */
  markDuplicates(groupId: string, findingIds: string[]): void {
    const stmt = this.db.prepare(`
      UPDATE findings SET duplicate_group_id = ?, is_duplicate = 1, updated_at = datetime('now')
      WHERE id = ? AND id NOT IN (
        SELECT id FROM findings WHERE duplicate_group_id = ? ORDER BY priority_score DESC LIMIT 1
      )
    `);
    for (const id of findingIds) {
      stmt.run(groupId, id, groupId);
    }
  }

  /** Convert a database row to a Finding object */
  private rowToFinding(row: Record<string, unknown>): Finding {
    return {
      id: row.id as string,
      source: {
        tool: row.tool as string,
        tool_version: row.tool_version as string | undefined,
        rule_id: row.rule_id as string,
        rule_name: row.rule_name as string | undefined,
        rule_description: row.rule_description as string | undefined,
        rule_help_url: row.rule_help_url as string | undefined,
        original_id: row.original_id as string,
        original_url: row.original_url as string | undefined,
      },
      title: row.title as string,
      message: row.message as string,
      severity: row.severity as Finding['severity'],
      raw_severity: row.raw_severity as string,
      cwe_id: row.cwe_id as string | undefined,
      cwe_name: row.cwe_name as string | undefined,
      owasp_category: row.owasp_category as string | undefined,
      location: {
        file_path: row.file_path as string,
        start_line: row.start_line as number,
        start_column: row.start_column as number | undefined,
        end_line: row.end_line as number | undefined,
        end_column: row.end_column as number | undefined,
        code_snippet: row.code_snippet as string | undefined,
      },
      status: row.status as Finding['status'],
      fingerprint: row.fingerprint as string,
      duplicate_group_id: row.duplicate_group_id as string | undefined,
      is_duplicate: Boolean(row.is_duplicate),
      priority_score: row.priority_score as number,
      priority_reason: row.priority_reason as string | undefined,
      fix_suggestion: row.fix_description
        ? {
            description: row.fix_description as string,
            code_example: row.fix_code_example as string | undefined,
            effort_estimate: row.fix_effort_estimate as string | undefined,
            breaking_risk: (row.fix_breaking_risk as string | undefined) as FixSuggestion['breaking_risk'],
          }
        : undefined,
      first_seen_at: row.first_seen_at as string,
      last_seen_at: row.last_seen_at as string,
      dismissed_at: row.dismissed_at as string | undefined,
      dismissed_reason: row.dismissed_reason as string | undefined,
      raw_data: JSON.parse(row.raw_data as string) as Record<string, unknown>,
    };
  }
}
