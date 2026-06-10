import Database from 'better-sqlite3';
import type { Rule } from '../../core/models/rule.js';

/** Repository for scanner rule operations */
export class RuleRepository {
  constructor(private readonly db: Database.Database) {}

  /** Insert or update a rule */
  upsert(rule: Rule): void {
    const stmt = this.db.prepare(`
      INSERT INTO rules (id, tool, rule_id, name, description, severity, cwe_id, owasp_category, fix_patterns, rule_references)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        severity = excluded.severity,
        cwe_id = excluded.cwe_id,
        owasp_category = excluded.owasp_category,
        fix_patterns = excluded.fix_patterns,
        rule_references = excluded.rule_references,
        updated_at = datetime('now')
    `);
    stmt.run(
      rule.id,
      rule.tool,
      rule.rule_id,
      rule.name,
      rule.description,
      rule.severity ?? null,
      rule.cwe_id ?? null,
      rule.owasp_category ?? null,
      rule.fix_patterns ? JSON.stringify(rule.fix_patterns) : null,
      rule.references ? JSON.stringify(rule.references) : null
    );
  }

  /** Get a rule by composite ID */
  getById(id: string): Rule | undefined {
    const stmt = this.db.prepare('SELECT * FROM rules WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRule(row) : undefined;
  }

  /** Get a rule by tool and rule_id */
  getByToolRule(tool: string, ruleId: string): Rule | undefined {
    const stmt = this.db.prepare('SELECT * FROM rules WHERE tool = ? AND rule_id = ?');
    const row = stmt.get(tool, ruleId) as Record<string, unknown> | undefined;
    return row ? this.rowToRule(row) : undefined;
  }

  /** List all rules for a tool */
  listByTool(tool: string): Rule[] {
    const stmt = this.db.prepare('SELECT * FROM rules WHERE tool = ? ORDER BY name');
    const rows = stmt.all(tool) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRule(r));
  }

  private rowToRule(row: Record<string, unknown>): Rule {
    return {
      id: row.id as string,
      tool: row.tool as string,
      rule_id: row.rule_id as string,
      name: row.name as string,
      description: row.description as string,
      severity: row.severity as string | undefined,
      cwe_id: row.cwe_id as string | undefined,
      owasp_category: row.owasp_category as string | undefined,
      fix_patterns: row.fix_patterns ? (JSON.parse(row.fix_patterns as string) as Rule['fix_patterns']) : undefined,
      references: row.rule_references ? (JSON.parse(row.rule_references as string) as Rule['references']) : undefined,
    };
  }
}
