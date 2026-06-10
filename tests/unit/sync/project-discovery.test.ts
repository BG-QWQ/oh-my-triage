import { describe, expect, it } from 'vitest';
import type { CredentialStore } from '@/config/credential-store.js';
import type { Config, SourceConfig, TokenStorage } from '@/config/validation.js';
import { ProjectDiscoveryService } from '@/sync/project-discovery.js';

describe('ProjectDiscoveryService', () => {
  it('lists SonarCloud projects visible to the configured token', async () => {
    const service = new ProjectDiscoveryService({
      config: createConfig([
        {
          id: 'sonarcloud',
          type: 'sonarcloud',
          enabled: true,
          options: { organization: 'acme' },
          token_ref: 'sonarcloud',
        },
      ]),
      credentialStore: new StaticCredentialStore('token-123') as unknown as CredentialStore,
      createSonarCloudClient: (_source, token) => new StaticSonarCloudClient(token),
    });

    const result = await service.discoverProjects();

    expect(result).toMatchObject({
      sources_total: 1,
      sources_succeeded: 1,
      sources_failed: 0,
      sources_skipped: 0,
    });
    expect(result.results[0]).toMatchObject({
      source_id: 'sonarcloud',
      status: 'success',
      total: 1,
      pages_fetched: 1,
      projects: [
        {
          key: 'acme_project',
          name: 'ACME Project',
          qualifier: 'TRK',
          visibility: 'private',
          organization: 'acme',
          last_analysis_date: '2024-01-01T00:00:00+0000',
        },
      ],
    });
    expect(result.results[0]?.next_steps).toEqual([
      expect.stringContaining('Choose the project key'),
      expect.stringContaining('project_keys[source_id]'),
      expect.stringContaining('Optionally save'),
    ]);
  });

  it('returns an actionable failure when the source token is missing', async () => {
    const service = new ProjectDiscoveryService({
      config: createConfig([
        {
          id: 'sonarcloud',
          type: 'sonarcloud',
          enabled: true,
          options: {},
        },
      ]),
      credentialStore: new StaticCredentialStore(undefined) as unknown as CredentialStore,
    });

    const result = await service.discoverProjects();

    expect(result.sources_failed).toBe(1);
    expect(result.results[0]).toMatchObject({
      source_id: 'sonarcloud',
      status: 'failed',
      error_message: expect.stringContaining('Token is missing'),
      next_steps: [expect.stringContaining('findingbridge config set-token sonarcloud')],
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

class StaticCredentialStore {
  constructor(private readonly token: string | undefined) {}

  async getToken(_sourceId: string, _storage: TokenStorage, _tokenRef?: string): Promise<string | undefined> {
    return this.token;
  }
}

class StaticSonarCloudClient {
  constructor(private readonly token: string) {}

  async listProjects(): Promise<{
    projects: Array<{
      key: string;
      name: string;
      qualifier?: string;
      visibility?: string;
      organization?: string;
      lastAnalysisDate?: string;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    if (this.token !== 'token-123') {
      throw new Error('Unexpected token.');
    }

    return {
      projects: [
        {
          key: 'acme_project',
          name: 'ACME Project',
          qualifier: 'TRK',
          visibility: 'private',
          organization: 'acme',
          lastAnalysisDate: '2024-01-01T00:00:00+0000',
        },
      ],
      total: 1,
      hasMore: false,
    };
  }
}
