import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '@/adapters/base-adapter.js';
import type { Config, SourceConfig } from '@/config/validation.js';
import type { Finding } from '@/core/models/finding.js';
import { closeConnection, createConnection } from '@/database/connection.js';
import { FindingRepository } from '@/database/repositories/finding-repo.js';
import { SourceSyncService } from '@/sync/source-sync.js';

describe('SourceSyncService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createConnection(':memory:');
  });

  afterEach(() => {
    closeConnection(db);
  });

  it('syncs configured sources through an adapter and upserts findings', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        options: {},
      },
    ]);
    const adapter = new StaticAdapter([createFinding()]);
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => adapter,
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({
      sources_total: 1,
      sources_synced: 1,
      sources_failed: 0,
      findings_imported: 1,
    });
    expect(result.results[0]).toMatchObject({
      source_id: 'local-sarif',
      status: 'success',
      findings_found: 1,
      findings_imported: 1,
    });
    expect(new FindingRepository(db).list({}).total).toBe(1);
    expect(adapter.fetchOptions).toEqual([{ cursor: undefined }]);
  });

  it('returns an actionable failed result for unsupported configured source types', async () => {
    const config = createConfig([
      {
        id: 'socket-dev',
        type: 'socket',
        enabled: true,
        options: {},
      },
    ]);
    const service = new SourceSyncService({ db, config, databasePath: ':memory:' });

    const result = await service.syncSources();

    expect(result.sources_failed).toBe(1);
    expect(result.results[0]).toMatchObject({
      source_id: 'socket-dev',
      source_type: 'socket',
      status: 'failed',
      findings_imported: 0,
      error_message: expect.stringContaining('does not have a sync adapter yet'),
      next_steps: [expect.stringContaining('Export the platform results as SARIF')],
    });
  });
});

function createConfig(sources: SourceConfig[]): Config {
  return {
    version: '1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    token_storage: 'keychain',
    sources,
    database_path: ':memory:',
  };
}

class StaticAdapter implements BaseAdapter {
  readonly sourceType = 'test';
  readonly displayName = 'Test Adapter';
  readonly fetchOptions: Array<{ cursor?: string; limit?: number }> = [];

  constructor(private readonly findings: Finding[]) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { valid: true };
  }

  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    this.fetchOptions.push(options);
    return {
      findings: this.findings,
      total: this.findings.length,
      has_more: false,
    };
  }
}

function createFinding(): Finding {
  return {
    id: 'fb-sync-test-001',
    source: {
      tool: 'TestScanner',
      rule_id: 'test/rule',
      original_id: 'test-001',
    },
    title: 'Test finding',
    message: 'Synthetic finding used to verify sync persistence.',
    severity: 'medium',
    raw_severity: 'warning',
    location: {
      file_path: 'src/example.ts',
      start_line: 1,
    },
    status: 'open',
    fingerprint: 'sync-test-fingerprint',
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: '2024-01-01T00:00:00.000Z',
    last_seen_at: '2024-01-01T00:00:00.000Z',
    raw_data: { source: 'test' },
  };
}
