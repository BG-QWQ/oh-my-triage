-- oh-my-triage SQLite Schema (v2)

-- Normalized findings table
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  tool_version TEXT,
  rule_id TEXT NOT NULL,
  rule_name TEXT,
  rule_description TEXT,
  rule_help_url TEXT,
  original_id TEXT NOT NULL,
  original_url TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  raw_severity TEXT NOT NULL,
  cwe_id TEXT,
  cwe_name TEXT,
  owasp_category TEXT,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  start_column INTEGER,
  end_line INTEGER,
  end_column INTEGER,
  code_snippet TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'fixed', 'false_positive')),
  fingerprint TEXT NOT NULL UNIQUE,
  duplicate_group_id TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  priority_score INTEGER NOT NULL DEFAULT 50,
  priority_reason TEXT,
  fix_description TEXT,
  fix_code_example TEXT,
  fix_effort_estimate TEXT,
  fix_breaking_risk TEXT CHECK (fix_breaking_risk IN ('none', 'low', 'medium', 'high')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  dismissed_at TEXT,
  dismissed_reason TEXT,
  raw_data TEXT NOT NULL,
  sync_source_id TEXT,
  sync_scope_key TEXT,
  sync_run_id TEXT,
  sync_seen_at TEXT,
  is_stale INTEGER NOT NULL DEFAULT 0,
  is_current_scope INTEGER NOT NULL DEFAULT 1,
  stale_since_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_tool ON findings(tool);
CREATE INDEX IF NOT EXISTS idx_findings_rule_id ON findings(rule_id);
CREATE INDEX IF NOT EXISTS idx_findings_file_path ON findings(file_path);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_findings_duplicate_group ON findings(duplicate_group_id);
CREATE INDEX IF NOT EXISTS idx_findings_priority ON findings(priority_score DESC);

-- Scanner rules table
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT,
  cwe_id TEXT,
  owasp_category TEXT,
  fix_patterns TEXT,
  rule_references TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_tool_rule_id ON rules(tool, rule_id);

-- Sync logs table
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  findings_found INTEGER NOT NULL DEFAULT 0,
  findings_new INTEGER NOT NULL DEFAULT 0,
  findings_updated INTEGER NOT NULL DEFAULT 0,
  findings_stale_marked INTEGER NOT NULL DEFAULT 0,
  stale_isolation_applied INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK (format IN ('markdown', 'html', 'json', 'sarif')),
  scope TEXT NOT NULL CHECK (scope IN ('all', 'filtered', 'by_severity')),
  language TEXT NOT NULL DEFAULT 'en',
  total INTEGER NOT NULL DEFAULT 0,
  critical INTEGER NOT NULL DEFAULT 0,
  high INTEGER NOT NULL DEFAULT 0,
  medium INTEGER NOT NULL DEFAULT 0,
  low INTEGER NOT NULL DEFAULT 0,
  info INTEGER NOT NULL DEFAULT 0,
  top_priorities TEXT NOT NULL DEFAULT '[]',
  content TEXT,
  generated_at TEXT NOT NULL,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (1, 'initial_schema');
