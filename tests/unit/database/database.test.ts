import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnection, closeConnection, getSchemaVersion } from '@/database/connection.js';
import { FindingRepository } from '@/database/repositories/finding-repo.js';
import { SyncRepository } from '@/database/repositories/sync-repo.js';
import { RuleRepository } from '@/database/repositories/rule-repo.js';
import type { Finding } from '@/core/models/finding.js';
import type { Rule } from '@/core/models/rule.js';
import type { SyncLog } from '@/core/models/sync-log.js';
import Database from 'better-sqlite3';

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
      expect(getSchemaVersion(db)).toBe(1);
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
