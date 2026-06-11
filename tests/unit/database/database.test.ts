import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnection, closeConnection, getSchemaVersion } from '@/database/connection.js';
import { FindingRepository } from '@/database/repositories/finding-repo.js';
import { SyncRepository } from '@/database/repositories/sync-repo.js';
import { RuleRepository } from '@/database/repositories/rule-repo.js';
import type { Finding } from '@/core/models/finding.js';
import type { Rule } from '@/core/models/rule.js';
import type { SyncLog } from '@/core/models/sync-log.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Database Layer', () => {
  let db: Database.Database;
  let findingRepo: FindingRepository;
  let syncRepo: SyncRepository;
  let ruleRepo: RuleRepository;

  beforeEach(() => {
    db = createConnection(':memory:');
    findingRepo = new FindingRepository(db);
    syncRepo = new SyncRepository(db);
    ruleRepo = new RuleRepository(db);
  });

  afterEach(() => {
    closeConnection(db);
  });

  describe('connection', () => {
    it('initializes schema version', () => {
      expect(getSchemaVersion(db)).toBe(2);
    });

    it('migrates an existing v1 database before creating freshness indexes', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'findingbridge-v1-'));
      const dbPath = join(tempDir, 'findingbridge.db');
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        CREATE TABLE findings (
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
          severity TEXT NOT NULL,
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
          status TEXT NOT NULL DEFAULT 'open',
          fingerprint TEXT NOT NULL UNIQUE,
          duplicate_group_id TEXT,
          is_duplicate INTEGER NOT NULL DEFAULT 0,
          priority_score INTEGER NOT NULL DEFAULT 50,
          priority_reason TEXT,
          fix_description TEXT,
          fix_code_example TEXT,
          fix_effort_estimate TEXT,
          fix_breaking_risk TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          dismissed_at TEXT,
          dismissed_reason TEXT,
          raw_data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE sync_logs (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          status TEXT NOT NULL,
          findings_found INTEGER NOT NULL DEFAULT 0,
          findings_new INTEGER NOT NULL DEFAULT 0,
          findings_updated INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE rules (id TEXT PRIMARY KEY, tool TEXT NOT NULL, rule_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL);
        CREATE TABLE reports (id TEXT PRIMARY KEY, format TEXT NOT NULL, scope TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', total INTEGER NOT NULL DEFAULT 0, generated_at TEXT NOT NULL);
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), name TEXT NOT NULL);
        INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_schema');
      `);
      legacyDb.close();

      const migratedDb = createConnection(dbPath);
      const columns = migratedDb.prepare('PRAGMA table_info(findings)').all() as Array<{ name: string }>;

      expect(getSchemaVersion(migratedDb)).toBe(2);
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['is_stale', 'is_current_scope', 'sync_scope_key']));
      closeConnection(migratedDb);
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('FindingRepository', () => {
    const mockFinding: Finding = {
      id: 'fb-test-001',
      source: {
        tool: 'github',
        rule_id: 'js/sql-injection',
        rule_name: 'SQL Injection',
        original_id: '1',
      },
      title: 'SQL Injection',
      message: 'Vulnerable to SQL injection',
      severity: 'high',
      raw_severity: 'high',
      location: {
        file_path: 'src/db.ts',
        start_line: 42,
      },
      status: 'open',
      fingerprint: 'abc123',
      is_duplicate: false,
      priority_score: 70,
      first_seen_at: '2024-01-01T00:00:00Z',
      last_seen_at: '2024-01-01T00:00:00Z',
      raw_data: { source: 'test' },
    };

    it('upserts and retrieves a finding', () => {
      findingRepo.upsert(mockFinding);
      const retrieved = findingRepo.getById('fb-test-001');
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('SQL Injection');
      expect(retrieved?.severity).toBe('high');
    });

    it('lists findings with filters', () => {
      findingRepo.upsert(mockFinding);
      const result = findingRepo.list({ severity: ['high'] });
      expect(result.findings).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('counts by severity', () => {
      findingRepo.upsert(mockFinding);
      const counts = findingRepo.countBySeverity();
      expect(counts.high).toBe(1);
      expect(counts.critical).toBe(0);
    });

    it('stores sync freshness metadata and resets stale state on upsert', () => {
      findingRepo.upsert(mockFinding, {
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        syncRunId: 'sync-001',
        seenAt: '2024-01-02T00:00:00.000Z',
      });

      const retrieved = findingRepo.getById('fb-test-001');
      expect(retrieved).toMatchObject({
        sync_source_id: 'sonarcloud',
        sync_scope_key: 'sonarcloud:project:acme',
        sync_run_id: 'sync-001',
        sync_seen_at: '2024-01-02T00:00:00.000Z',
        is_stale: false,
      });

      findingRepo.markStaleForSyncScope({
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        activeFingerprints: [],
        staleSinceAt: '2024-01-03T00:00:00.000Z',
      });
      expect(findingRepo.getById('fb-test-001')?.is_stale).toBe(true);

      findingRepo.upsert(mockFinding, {
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        syncRunId: 'sync-002',
        seenAt: '2024-01-04T00:00:00.000Z',
      });
      expect(findingRepo.getById('fb-test-001')).toMatchObject({
        is_stale: false,
        stale_since_at: undefined,
        sync_run_id: 'sync-002',
      });
    });

    it('preserves stale rows while excluding them from default queries', () => {
      const secondFinding = { ...mockFinding, id: 'fb-test-002', fingerprint: 'def456', title: 'Second finding' };
      findingRepo.upsert(mockFinding, {
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        syncRunId: 'sync-001',
        seenAt: '2024-01-02T00:00:00.000Z',
      });
      findingRepo.upsert(secondFinding, {
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        syncRunId: 'sync-001',
        seenAt: '2024-01-02T00:00:00.000Z',
      });

      const staleMarked = findingRepo.markStaleForSyncScope({
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        activeFingerprints: ['abc123'],
        staleSinceAt: '2024-01-03T00:00:00.000Z',
      });

      expect(staleMarked).toBe(1);
      expect(findingRepo.list({}).findings.map((finding) => finding.id)).toEqual(['fb-test-001']);
      expect(findingRepo.list({ includeStale: true }).total).toBe(2);
      expect(findingRepo.countBySeverity().high).toBe(1);
      expect(findingRepo.countBySeverity({ includeStale: true }).high).toBe(2);
      expect(findingRepo.listTools()).toEqual(['github']);
      expect(findingRepo.listTools({ includeStale: true })).toEqual(['github']);
    });

    it('excludes legacy unscoped rows after a successful scope becomes current', () => {
      const syncedFinding = { ...mockFinding, id: 'fb-test-002', fingerprint: 'def456', title: 'Synced finding' };
      findingRepo.upsert(mockFinding);
      findingRepo.upsert(syncedFinding, {
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        syncRunId: 'sync-001',
        seenAt: '2024-01-02T00:00:00.000Z',
      });

      findingRepo.markCurrentSyncScope('sonarcloud', 'sonarcloud:project:acme');

      expect(findingRepo.list({}).findings.map((finding) => finding.id)).toEqual(['fb-test-002']);
      expect(findingRepo.list({ includeStale: true }).total).toBe(2);
      expect(findingRepo.getById('fb-test-001')?.is_current_scope).toBe(false);
    });

    it('marks stale with a temp table instead of an unbounded SQL placeholder list', () => {
      const activeFingerprints = Array.from({ length: 1500 }, (_, index) => `active-${index}`);
      findingRepo.upsert(mockFinding, {
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        syncRunId: 'sync-001',
        seenAt: '2024-01-02T00:00:00.000Z',
      });

      const staleMarked = findingRepo.markStaleForSyncScope({
        sourceId: 'sonarcloud',
        scopeKey: 'sonarcloud:project:acme',
        activeFingerprints,
        staleSinceAt: '2024-01-03T00:00:00.000Z',
      });

      expect(staleMarked).toBe(1);
      expect(findingRepo.list({}).total).toBe(0);
      expect(findingRepo.list({ includeStale: true }).total).toBe(1);
    });
  });

  describe('SyncRepository', () => {
    const mockLog: SyncLog = {
      id: 'sync-001',
      source: 'github',
      started_at: '2024-01-01T00:00:00Z',
      status: 'success',
      findings_found: 10,
      findings_new: 5,
      findings_updated: 3,
    };

    it('creates and retrieves sync log', () => {
      syncRepo.create(mockLog);
      const latest = syncRepo.getLatest('github');
      expect(latest).toBeDefined();
      expect(latest?.findings_found).toBe(10);
    });

    it('updates sync log', () => {
      syncRepo.create(mockLog);
      syncRepo.update('sync-001', { status: 'failed', error_message: 'Network error' });
      const latest = syncRepo.getLatest('github');
      expect(latest?.status).toBe('failed');
      expect(latest?.error_message).toBe('Network error');
    });

    it('persists stale isolation audit fields', () => {
      syncRepo.create(mockLog);
      syncRepo.update('sync-001', { findings_stale_marked: 2, stale_isolation_applied: true });

      const latest = syncRepo.getLatest('github');
      expect(latest).toMatchObject({
        findings_stale_marked: 2,
        stale_isolation_applied: true,
      });
    });
  });

  describe('RuleRepository', () => {
    const mockRule: Rule = {
      id: 'github:js/sql-injection',
      tool: 'github',
      rule_id: 'js/sql-injection',
      name: 'SQL Injection',
      description: 'Detects SQL injection vulnerabilities',
      severity: 'high',
    };

    it('upserts and retrieves a rule', () => {
      ruleRepo.upsert(mockRule);
      const retrieved = ruleRepo.getById('github:js/sql-injection');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('SQL Injection');
    });

    it('lists rules by tool', () => {
      ruleRepo.upsert(mockRule);
      const rules = ruleRepo.listByTool('github');
      expect(rules).toHaveLength(1);
    });
  });
});
