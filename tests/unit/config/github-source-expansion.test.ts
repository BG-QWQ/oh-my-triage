import { describe, expect, it } from 'vitest';
import { expandGitHubSetupSources } from '@/config/github-source-expansion.js';
import type { SourceConfig } from '@/config/validation.js';

describe('expandGitHubSetupSources', () => {
  it('expands one selected repository into one GitHub source', () => {
    const sources = expandGitHubSetupSources({
      baseId: 'github-code-scanning',
      displayName: 'GitHub Code Scanning',
      repositories: [{ owner: 'acme', repo: 'api' }],
      existingSources: [],
      tokenRef: 'env:GITHUB_CODE_SCANNING_TOKEN',
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'github-code-scanning',
        token_ref: 'env:GITHUB_CODE_SCANNING_TOKEN',
        options: { owner: 'acme', repo: 'api' },
      }),
    ]);
  });

  it('expands multiple repositories into deterministic per-repository sources', () => {
    const sources = expandGitHubSetupSources({
      baseId: 'github-code-scanning',
      displayName: 'GitHub Code Scanning',
      repositories: [
        { owner: 'acme', repo: 'api' },
        { owner: 'acme', repo: 'web' },
      ],
      existingSources: [],
      tokenRef: 'keychain:github',
    });

    expect(sources.map((source) => source.id)).toEqual(['github-code-scanning', 'github-code-scanning-acme-web']);
    expect(sources.map((source) => source.token_ref)).toEqual(['keychain:github', 'keychain:github']);
  });

  it('preserves existing source ids for matching repositories', () => {
    const existingSources: SourceConfig[] = [githubSource('custom-gh', 'acme', 'api')];

    const sources = expandGitHubSetupSources({
      baseId: 'github-code-scanning',
      displayName: 'GitHub Code Scanning',
      repositories: [{ owner: 'ACME', repo: 'API' }],
      existingSources,
      tokenRef: 'env:GITHUB_CODE_SCANNING_TOKEN',
    });

    expect(sources[0]?.id).toBe('custom-gh');
  });

  it('deduplicates repositories case-insensitively', () => {
    const sources = expandGitHubSetupSources({
      baseId: 'github-code-scanning',
      displayName: 'GitHub Code Scanning',
      repositories: [
        { owner: 'acme', repo: 'api' },
        { owner: 'ACME', repo: 'API' },
      ],
      existingSources: [],
      tokenRef: 'token-ref',
    });

    expect(sources).toHaveLength(1);
  });

  it('adds a deterministic hash when generated ids collide', () => {
    const existingSources: SourceConfig[] = [githubSource('github-code-scanning-acme-api', 'other', 'repo')];

    const sources = expandGitHubSetupSources({
      baseId: 'github-code-scanning',
      displayName: 'GitHub Code Scanning',
      repositories: [
        { owner: 'acme', repo: 'seed' },
        { owner: 'acme', repo: 'api' },
      ],
      existingSources,
      tokenRef: 'token-ref',
    });

    expect(sources[1]?.id).toMatch(/^github-code-scanning-acme-api-[a-f0-9]{8}$/);
  });

  it('does not persist setup-only repositories lists', () => {
    const sources = expandGitHubSetupSources({
      baseId: 'github-code-scanning',
      displayName: 'GitHub Code Scanning',
      repositories: [{ owner: 'acme', repo: 'api' }],
      existingSources: [],
      tokenRef: 'token-ref',
    });

    expect(sources[0]?.options).toEqual({ owner: 'acme', repo: 'api' });
  });
});

function githubSource(id: string, owner: string, repo: string): SourceConfig {
  return {
    id,
    type: 'github',
    enabled: true,
    token_ref: 'existing-token-ref',
    options: { owner, repo },
  };
}
