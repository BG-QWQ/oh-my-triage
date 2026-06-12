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

    const result = await service.syncSources({ allSources: true });

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

    await service.syncSources({ allSources: true });
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

    const result = await service.syncSources({ allSources: true });

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

    await service.syncSources({ allSources: true });

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

    const result = await service.syncSources({ allSources: true });

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

  it('syncs multiple GitHub repository sources independently with a shared token ref', async () => {
    const config = createConfig([
      {
        id: 'github-code-scanning',
        type: 'github',
        enabled: true,
        token_ref: 'github-code-scanning',
        options: { owner: 'acme', repo: 'api' },
      },
      {
        id: 'github-code-scanning-acme-web',
        type: 'github',
        enabled: true,
        token_ref: 'github-code-scanning',
        options: { owner: 'acme', repo: 'web' },
      },
    ]);
    const observedSources: SourceConfig[] = [];
    const service = new SourceSyncService({
      db,
      config,
      databasePath: ':memory:',
      credentialStore: new StaticCredentialStore('token-123') as unknown as CredentialStore,
      createAdapter: async (source) => {
        observedSources.push(source);
        return new StaticAdapter([createFinding({ id: `fb-${source.id}`, fingerprint: `${source.id}-fingerprint` })]);
      },
    });

    const result = await service.syncSources({ allSources: true });

    expect(result).toMatchObject({ sources_synced: 2, sources_failed: 0 });
    expect(observedSources.map((source) => source.options)).toEqual([
      { owner: 'acme', repo: 'api' },
      { owner: 'acme', repo: 'web' },
    ]);
    expect(new FindingRepository(db).list({}).total).toBe(2);
  });

  it('defaults multi-source sync to all inferable current-project sources', async () => {
    const config = createConfig(currentProjectSources());
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 3, sources_synced: 2, sources_skipped: 1 });
    expect(observedSources.map((source) => source.id)).toEqual(['github-code-scanning-acme-web', 'sonarcloud-web']);
    expect(result.results.find((entry) => entry.source_id === 'sonarcloud-unconfigured')).toMatchObject({
      status: 'skipped',
      error_message: 'SonarCloud source sonarcloud-unconfigured had no exact project match for acme/web.',
    });
  });

  it('infers a SonarCloud project key from a unique exact current repository match', async () => {
    const config = createConfig([
      ...gitHubSources(),
      sonarCloudSource(),
    ]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      projects: [
        { key: 'acme_web', name: 'web' },
        { key: 'acme_api', name: 'api' },
      ],
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 2, sources_synced: 2, sources_skipped: 0 });
    expect(observedSources.map((source) => source.id)).toEqual(['github-code-scanning-acme-web', 'sonarcloud-web']);
    expect(observedSources.find((source) => source.id === 'sonarcloud-web')?.project_key).toBe('acme_web');
    expect(config.sources.find((source) => source.id === 'sonarcloud-web')?.project_key).toBeUndefined();
  });

  it('infers a SonarCloud project key from a unique normalized owner and repository match', async () => {
    const config = createConfig([
      ...gitHubSources(),
      sonarCloudSource(),
    ]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      repository: { owner: 'ACME', repo: 'web-ui' },
      projects: [{ key: 'ACME_web-ui', name: 'Web UI' }],
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 1, sources_synced: 1, sources_skipped: 0 });
    expect(observedSources[0]?.project_key).toBe('ACME_web-ui');
    expect(config.sources.find((source) => source.id === 'sonarcloud-web')?.project_key).toBeUndefined();
  });

  it('infers a SonarCloud project key for a single enabled unconfigured source', async () => {
    const config = createConfig([sonarCloudSource()]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      projects: [{ key: 'acme_web', name: 'web' }],
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 1, sources_synced: 1, sources_skipped: 0 });
    expect(observedSources[0]?.project_key).toBe('acme_web');
    expect(config.sources[0]?.project_key).toBeUndefined();
  });

  it('skips a single enabled unconfigured SonarCloud source when no project match is found', async () => {
    const config = createConfig([sonarCloudSource()]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 1, sources_synced: 0, sources_skipped: 1 });
    expect(observedSources).toEqual([]);
    expect(result.results[0]).toMatchObject({
      status: 'skipped',
      error_message: 'SonarCloud source sonarcloud-web had no exact project match for acme/web.',
    });
  });

  it('skips ambiguous SonarCloud current repository matches instead of fuzzy auto-syncing', async () => {
    const config = createConfig([
      ...gitHubSources(),
      sonarCloudSource(),
    ]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      projects: [
        { key: 'acme_web', name: 'web' },
        { key: 'acme-web', name: 'Web' },
      ],
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 2, sources_synced: 1, sources_skipped: 1 });
    expect(observedSources.map((source) => source.id)).toEqual(['github-code-scanning-acme-web']);
    expect(result.results.find((entry) => entry.source_id === 'sonarcloud-web')).toMatchObject({
      status: 'skipped',
      error_message: 'SonarCloud source sonarcloud-web matched multiple projects for acme/web.',
    });
  });

  it('skips SonarCloud inference when project discovery is truncated', async () => {
    const config = createConfig([
      ...gitHubSources(),
      sonarCloudSource(),
    ]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      projects: [[{ key: 'acme_web', name: 'web' }], []],
    });

    const result = await service.syncSources({ maxPages: 1 });

    expect(result).toMatchObject({ sources_total: 2, sources_synced: 1, sources_skipped: 1 });
    expect(observedSources.map((source) => source.id)).toEqual(['github-code-scanning-acme-web']);
    expect(result.results.find((entry) => entry.source_id === 'sonarcloud-web')).toMatchObject({
      status: 'skipped',
      error_message:
        'SonarCloud source sonarcloud-web project discovery reached max_pages before FindingBridge could prove a unique project match.',
    });
  });

  it('skips SonarCloud inference when matching projects appear across multiple pages', async () => {
    const config = createConfig([
      ...gitHubSources(),
      sonarCloudSource(),
    ]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      projects: [
        [{ key: 'acme_web', name: 'web' }],
        [{ key: 'acme-web', name: 'Web' }],
      ],
    });

    const result = await service.syncSources({ maxPages: 2 });

    expect(result).toMatchObject({ sources_total: 2, sources_synced: 1, sources_skipped: 1 });
    expect(observedSources.map((source) => source.id)).toEqual(['github-code-scanning-acme-web']);
    expect(result.results.find((entry) => entry.source_id === 'sonarcloud-web')).toMatchObject({
      status: 'skipped',
      error_message: 'SonarCloud source sonarcloud-web matched multiple projects for acme/web.',
    });
  });

  it('uses per-call SonarCloud project keys as inferable current-project sources', async () => {
    const config = createConfig([
      ...gitHubSources(),
      {
        ...sonarCloudSource(),
        project_key: ' ',
      },
    ]);
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
    });

    const result = await service.syncSources({ projectKeys: { 'sonarcloud-web': 'acme_web' } });

    expect(result).toMatchObject({ sources_total: 2, sources_synced: 2 });
    expect(observedSources.map((source) => source.id)).toEqual(['github-code-scanning-acme-web', 'sonarcloud-web']);
    expect(observedSources.find((source) => source.id === 'sonarcloud-web')?.project_key).toBe('acme_web');
    expect(config.sources.find((source) => source.id === 'sonarcloud-web')?.project_key).toBe(' ');
  });

  it('keeps explicit source IDs as an exact allowlist over inferred current-project sources', async () => {
    const config = createConfig(currentProjectSources());
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      discoveryFailureMessage: 'Source ID allowlist should not infer SonarCloud projects.',
    });

    const result = await service.syncSources({ sourceIds: ['sonarcloud-web'] });

    expect(result).toMatchObject({ sources_total: 1, sources_synced: 1 });
    expect(observedSources.map((source) => source.id)).toEqual(['sonarcloud-web']);
  });

  it('syncs all configured sources only when allSources is explicit', async () => {
    const config = createConfig(currentProjectSources());
    const { observedSources, service } = createObservedSyncService({
      db,
      config,
      discoveryFailureMessage: 'allSources should not infer SonarCloud projects.',
    });

    const result = await service.syncSources({ allSources: true });

    expect(result).toMatchObject({ sources_total: 5, sources_synced: 5, sources_failed: 0 });
    expect(observedSources.map((source) => source.id)).toEqual([
      'github-code-scanning',
      'github-code-scanning-acme-web',
      'sonarcloud-web',
      'sonarcloud-unconfigured',
      'sarif-web',
    ]);
  });

  it('refuses broad multi-source sync when no current-project source is inferable', async () => {
    const config = createConfig([
      ...gitHubSources(),
      {
        ...sonarCloudSource({ id: 'sonarcloud-unconfigured' }),
        project_key: ' ',
      },
      {
        id: 'sarif-web',
        type: 'sarif',
        enabled: true,
        path: 'web.sarif',
        options: {},
      },
    ]);
    const { service } = createObservedSyncService({
      db,
      config,
      repository: { owner: 'acme', repo: 'mobile' },
    });

    const result = await service.syncSources();

    expect(result).toMatchObject({ sources_total: 1, sources_synced: 0, sources_skipped: 1 });
    expect(result.results[0]).toMatchObject({
      source_id: 'sonarcloud-unconfigured',
      status: 'skipped',
      error_message: 'SonarCloud source sonarcloud-unconfigured had no exact project match for acme/mobile.',
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

function gitHubSources(): SourceConfig[] {
  return [
    {
      id: 'github-code-scanning',
      type: 'github',
      enabled: true,
      token_ref: 'github-code-scanning',
      options: { owner: 'acme', repo: 'api' },
    },
    {
      id: 'github-code-scanning-acme-web',
      type: 'github',
      enabled: true,
      token_ref: 'github-code-scanning',
      options: { owner: 'acme', repo: 'web' },
    },
  ];
}

function currentProjectSources(): SourceConfig[] {
  return [
    ...gitHubSources(),
    {
      id: 'sonarcloud-web',
      type: 'sonarcloud',
      enabled: true,
      project_key: 'acme_web',
      token_ref: 'sonarcloud',
      options: { organization: 'acme' },
    },
    {
      id: 'sonarcloud-unconfigured',
      type: 'sonarcloud',
      enabled: true,
      token_ref: 'sonarcloud',
      options: { organization: 'acme' },
    },
    {
      id: 'sarif-web',
      type: 'sarif',
      enabled: true,
      path: 'web.sarif',
      options: {},
    },
  ];
}

function sonarCloudSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'sonarcloud-web',
    type: 'sonarcloud',
    enabled: true,
    token_ref: 'sonarcloud',
    options: { organization: 'acme' },
    ...overrides,
  };
}

function createObservedSyncService(options: {
  db: Database.Database;
  config: Config;
  repository?: { owner: string; repo: string };
  projects?: Array<{ key: string; name: string; project?: string }> | Array<Array<{ key: string; name: string; project?: string }>>;
  discoveryFailureMessage?: string;
}): { observedSources: SourceConfig[]; service: SourceSyncService } {
  const observedSources: SourceConfig[] = [];
  return {
    observedSources,
    service: new SourceSyncService({
      db: options.db,
      config: options.config,
      databasePath: ':memory:',
      credentialStore: new StaticCredentialStore('token-123') as unknown as CredentialStore,
      detectCurrentGitHubRepository: async () => options.repository ?? { owner: 'acme', repo: 'web' },
      createSonarCloudClient: () => {
        if (options.discoveryFailureMessage) {
          throw new Error(options.discoveryFailureMessage);
        }
        return new StaticSonarCloudProjectClient(options.projects ?? []);
      },
      createAdapter: async (source) => {
        observedSources.push(source);
        return new StaticAdapter([createFinding({ id: `fb-${source.id}`, fingerprint: `${source.id}-fingerprint` })]);
      },
    }),
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

class StaticSonarCloudProjectClient {
  private readonly pages: Array<Array<{ key: string; name: string; project?: string }>>;

  constructor(projects: Array<{ key: string; name: string; project?: string }> | Array<Array<{ key: string; name: string; project?: string }>>) {
    this.pages = Array.isArray(projects[0])
      ? projects as Array<Array<{ key: string; name: string; project?: string }>>
      : [projects as Array<{ key: string; name: string; project?: string }>];
  }

  async listProjects(page = 1): Promise<{
    projects: Array<{ key: string; name: string; project?: string }>;
    total: number;
    hasMore: boolean;
  }> {
    const projects = this.pages[page - 1] ?? [];
    return {
      projects,
      total: this.pages.reduce((sum, current) => sum + current.length, 0),
      hasMore: page < this.pages.length,
    };
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
