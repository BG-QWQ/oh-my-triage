import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '@/adapters/base-adapter.js';
import type { CredentialStore } from '@/config/credential-store.js';
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
      stale_isolation_applied: true,
      findings_stale_marked: 0,
    });
    expect(new FindingRepository(db).list({}).total).toBe(1);
    expect(adapter.fetchOptions).toEqual([{ cursor: undefined }]);
  });

  it('marks missing same-scope findings stale after a complete successful sync', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'scanner.sarif',
        options: {},
      },
    ]);
    const firstFinding = createFinding({ id: 'fb-sync-test-001', fingerprint: 'sync-test-fingerprint-1' });
    const secondFinding = createFinding({ id: 'fb-sync-test-002', fingerprint: 'sync-test-fingerprint-2' });
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([firstFinding, secondFinding]),
    });

    await service.syncSources();
    const secondService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([firstFinding]),
    });
    const result = await secondService.syncSources();

    const repo = new FindingRepository(db);
    expect(result.results[0]).toMatchObject({
      status: 'success',
      stale_isolation_applied: true,
      findings_stale_marked: 1,
    });
    expect(repo.list({}).findings.map((finding) => finding.id)).toEqual(['fb-sync-test-001']);
    expect(repo.list({ includeStale: true }).total).toBe(2);
    expect(repo.getById('fb-sync-test-002')?.is_stale).toBe(true);
  });

  it('moves legacy unscoped findings out of the default context after successful sync', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'scanner.sarif',
        options: {},
      },
    ]);
    const repo = new FindingRepository(db);
    repo.upsert(createFinding({ id: 'fb-legacy-001', fingerprint: 'legacy-fingerprint' }));
    const syncedFinding = createFinding({ id: 'fb-sync-test-001', fingerprint: 'sync-test-fingerprint-1' });
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([syncedFinding]),
    });

    const result = await service.syncSources();

    expect(result.results[0]).toMatchObject({ stale_isolation_applied: true });
    expect(repo.list({}).findings.map((finding) => finding.id)).toEqual(['fb-sync-test-001']);
    expect(repo.list({ includeStale: true }).total).toBe(2);
  });

  it('keeps successfully synced findings from other source scopes current', async () => {
    const config = createConfig([
      {
        id: 'first-sarif',
        type: 'sarif',
        enabled: true,
        path: 'first.sarif',
        options: {},
      },
      {
        id: 'second-sarif',
        type: 'sarif',
        enabled: true,
        path: 'second.sarif',
        options: {},
      },
    ]);
    const firstFinding = createFinding({ id: 'fb-first-001', fingerprint: 'first-fingerprint' });
    const secondFinding = createFinding({ id: 'fb-second-001', fingerprint: 'second-fingerprint' });
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async (source) => new StaticAdapter(source.id === 'first-sarif' ? [firstFinding] : [secondFinding]),
    });

    await service.syncSources();

    expect(new FindingRepository(db).list({}).findings.map((finding) => finding.id).sort((a, b) => a.localeCompare(b))).toEqual([
      'fb-first-001',
      'fb-second-001',
    ]);
  });

  it('does not mark existing findings stale when sync fails', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'scanner.sarif',
        options: {},
      },
    ]);
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([createFinding()]),
    });
    await service.syncSources();

    const failingService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new FailingAdapter(),
    });

    const result = await failingService.syncSources();

    expect(result.results[0]).toMatchObject({
      status: 'failed',
      findings_stale_marked: 0,
      stale_isolation_applied: false,
    });
    expect(new FindingRepository(db).list({}).total).toBe(1);
  });

  it('skips stale marking when pagination is truncated by max_pages', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'scanner.sarif',
        options: {},
      },
    ]);
    const firstFinding = createFinding({ id: 'fb-sync-test-001', fingerprint: 'sync-test-fingerprint-1' });
    const secondFinding = createFinding({ id: 'fb-sync-test-002', fingerprint: 'sync-test-fingerprint-2' });
    const firstService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([firstFinding, secondFinding]),
    });
    await firstService.syncSources();

    const truncatedService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new PaginatedAdapter([
        {
          findings: [firstFinding],
          total: 2,
          has_more: true,
          next_cursor: 'page-2',
        },
      ]),
    });

    const result = await truncatedService.syncSources({ maxPages: 1 });

    expect(result.results[0]).toMatchObject({
      status: 'success',
      stale_isolation_applied: false,
      findings_stale_marked: 0,
    });
    expect(new FindingRepository(db).list({}).total).toBe(2);
  });

  it('does not reactivate a stale finding during truncated sync', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'scanner.sarif',
        options: {},
      },
    ]);
    const staleFinding = createFinding({ id: 'fb-sync-test-001', fingerprint: 'sync-test-fingerprint-1' });
    const secondFinding = createFinding({ id: 'fb-sync-test-002', fingerprint: 'sync-test-fingerprint-2' });
    await new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([staleFinding, secondFinding]),
    }).syncSources();
    await new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([secondFinding]),
    }).syncSources();
    expect(new FindingRepository(db).getById('fb-sync-test-001')?.is_stale).toBe(true);

    const truncatedService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new PaginatedAdapter([
        {
          findings: [staleFinding],
          total: 2,
          has_more: true,
          next_cursor: 'page-2',
        },
      ]),
    });

    const result = await truncatedService.syncSources({ maxPages: 1 });

    expect(result.results[0]).toMatchObject({ stale_isolation_applied: false });
    expect(new FindingRepository(db).getById('fb-sync-test-001')?.is_stale).toBe(true);
    expect(new FindingRepository(db).list({}).findings.map((finding) => finding.id)).toEqual(['fb-sync-test-002']);
  });

  it('does not expose new-scope partial sync findings by default', async () => {
    const config = createConfig([
      {
        id: 'sonarcloud',
        type: 'sonarcloud',
        enabled: true,
        options: {},
        token_ref: 'sonarcloud',
      },
    ]);
    const firstProjectFinding = createFinding({ id: 'fb-project-a-001', fingerprint: 'project-a-fingerprint' });
    const secondProjectFinding = createFinding({ id: 'fb-project-b-001', fingerprint: 'project-b-fingerprint' });
    await new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      credentialStore: new StaticCredentialStore('token-123') as unknown as CredentialStore,
      createAdapter: async () => new StaticAdapter([firstProjectFinding]),
    }).syncSources({ projectKeys: { sonarcloud: 'project-a' } });

    const truncatedService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      credentialStore: new StaticCredentialStore('token-123') as unknown as CredentialStore,
      createAdapter: async () => new PaginatedAdapter([
        {
          findings: [secondProjectFinding],
          total: 2,
          has_more: true,
          next_cursor: 'page-2',
        },
      ]),
    });

    const result = await truncatedService.syncSources({ projectKeys: { sonarcloud: 'project-b' }, maxPages: 1 });

    expect(result.results[0]).toMatchObject({ stale_isolation_applied: false });
    expect(new FindingRepository(db).list({}).findings.map((finding) => finding.id)).toEqual(['fb-project-a-001']);
    expect(
      new FindingRepository(db).list({ includeStale: true }).findings.map((finding) => finding.id).sort((a, b) => a.localeCompare(b))
    ).toEqual([
      'fb-project-a-001',
      'fb-project-b-001',
    ]);
  });

  it('skips stale marking when an adapter reports more results without a cursor', async () => {
    const config = createConfig([
      {
        id: 'local-sarif',
        type: 'sarif',
        enabled: true,
        path: 'scanner.sarif',
        options: {},
      },
    ]);
    const firstFinding = createFinding({ id: 'fb-sync-test-001', fingerprint: 'sync-test-fingerprint-1' });
    const secondFinding = createFinding({ id: 'fb-sync-test-002', fingerprint: 'sync-test-fingerprint-2' });
    await new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new StaticAdapter([firstFinding, secondFinding]),
    }).syncSources();

    const malformedService = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      createAdapter: async () => new PaginatedAdapter([
        {
          findings: [firstFinding],
          total: 2,
          has_more: true,
        },
      ]),
    });

    const result = await malformedService.syncSources();

    expect(result.results[0]).toMatchObject({
      status: 'success',
      stale_isolation_applied: false,
      findings_stale_marked: 0,
    });
    expect(new FindingRepository(db).list({}).total).toBe(2);
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

  it('uses per-call SonarCloud project key overrides without persisting config changes', async () => {
    const config = createConfig([
      {
        id: 'sonarcloud',
        type: 'sonarcloud',
        enabled: true,
        options: {},
        token_ref: 'sonarcloud',
      },
    ]);
    let observedProjectKey: string | undefined;
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      credentialStore: new StaticCredentialStore('token-123') as unknown as CredentialStore,
      createAdapter: async (source) => {
        observedProjectKey = source.project_key;
        return new StaticAdapter([createFinding()]);
      },
    });

    const result = await service.syncSources({ projectKeys: { sonarcloud: 'acme_project' } });

    expect(result.sources_synced).toBe(1);
    expect(observedProjectKey).toBe('acme_project');
    expect(config.sources[0]?.project_key).toBeUndefined();
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

class PaginatedAdapter implements BaseAdapter {
  readonly sourceType = 'test';
  readonly displayName = 'Test Adapter';
  private pageIndex = 0;

  constructor(private readonly pages: AdapterFetchResult[]) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { valid: true };
  }

  async fetchFindings(): Promise<AdapterFetchResult> {
    const page = this.pages[this.pageIndex];
    this.pageIndex += 1;
    if (!page) {
      return { findings: [], total: 0, has_more: false };
    }
    return page;
  }
}

class FailingAdapter implements BaseAdapter {
  readonly sourceType = 'test';
  readonly displayName = 'Test Adapter';

  async testConnection(): Promise<ConnectionTestResult> {
    return { valid: true };
  }

  async fetchFindings(): Promise<AdapterFetchResult> {
    throw new Error('scanner unavailable');
  }
}

class StaticCredentialStore {
  constructor(private readonly token: string | undefined) {}

  async getToken(): Promise<string | undefined> {
    return this.token;
  }
}

function createFinding(overrides: Partial<Pick<Finding, 'id' | 'fingerprint'>> = {}): Finding {
  return {
    id: overrides.id ?? 'fb-sync-test-001',
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
    fingerprint: overrides.fingerprint ?? 'sync-test-fingerprint',
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: '2024-01-01T00:00:00.000Z',
    last_seen_at: '2024-01-01T00:00:00.000Z',
    raw_data: { source: 'test' },
  };
}
