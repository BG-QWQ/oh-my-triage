import { createHash } from 'node:crypto';
import type { SourceConfig } from './validation.js';

/** Repository selected during GitHub setup before expansion into syncable sources. */
export type GitHubRepositorySelection = {
  owner: string;
  repo: string;
};

/** Input for expanding one GitHub setup selection into repository-scoped sources. */
export type ExpandGitHubSourcesInput = {
  baseId: string;
  displayName: string;
  repositories: GitHubRepositorySelection[];
  existingSources: SourceConfig[];
  tokenRef?: string;
};

/**
 * Expand selected GitHub repositories into one source per repository.
 *
 * FindingBridge sync isolation is source-scoped, so the setup wizard fans out a
 * multi-repository selection into the existing single-repository source shape
 * instead of introducing a repository list that sync would need to split later.
 */
export function expandGitHubSetupSources(input: ExpandGitHubSourcesInput): SourceConfig[] {
  const repositories = uniqueRepositories(input.repositories);
  const existingByRepository = mapExistingSourcesByRepository(input.existingSources);
  const usedIds = new Set(input.existingSources.map((source) => source.id));

  return repositories.map((repository, index) => {
    const existing = existingByRepository.get(repositoryKey(repository.owner, repository.repo));
    const id = existing?.id ?? generateSourceId({ baseId: input.baseId, repository, index, usedIds });
    usedIds.add(id);
    return {
      id,
      type: 'github',
      name: `${input.displayName} - ${repository.owner}/${repository.repo}`,
      enabled: existing?.enabled ?? true,
      token_ref: input.tokenRef ?? existing?.token_ref,
      options: {
        owner: repository.owner,
        repo: repository.repo,
      },
    };
  });
}

function mapExistingSourcesByRepository(existingSources: SourceConfig[]): Map<string, SourceConfig> {
  const sourcesByRepository = new Map<string, SourceConfig>();
  for (const source of existingSources) {
    if (source.type !== 'github') {
      continue;
    }

    const key = repositoryKey(readOption(source, 'owner'), readOption(source, 'repo'));
    if (key !== '/') {
      sourcesByRepository.set(key, source);
    }
  }
  return sourcesByRepository;
}

function uniqueRepositories(repositories: GitHubRepositorySelection[]): GitHubRepositorySelection[] {
  const seen = new Set<string>();
  const unique: GitHubRepositorySelection[] = [];
  for (const repository of repositories) {
    const owner = repository.owner.trim();
    const repo = repository.repo.trim();
    if (!owner || !repo) {
      continue;
    }

    const key = repositoryKey(owner, repo);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ owner, repo });
  }
  return unique;
}

function generateSourceId(params: {
  baseId: string;
  repository: GitHubRepositorySelection;
  index: number;
  usedIds: ReadonlySet<string>;
}): string {
  if (params.index === 0 && !params.usedIds.has(params.baseId)) {
    return params.baseId;
  }

  const candidate = `${params.baseId}-${slug(params.repository.owner)}-${slug(params.repository.repo)}`;
  if (!params.usedIds.has(candidate)) {
    return candidate;
  }

  return `${candidate}-${hashRepository(params.repository)}`;
}

function repositoryKey(owner: string | undefined, repo: string | undefined): string {
  return `${owner?.toLowerCase() ?? ''}/${repo?.toLowerCase() ?? ''}`;
}

function readOption(source: SourceConfig, key: string): string | undefined {
  const value = source.options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function slug(value: string): string {
  const slugValue = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slugValue || 'repo';
}

function hashRepository(repository: GitHubRepositorySelection): string {
  return createHash('sha256')
    .update(repositoryKey(repository.owner, repository.repo))
    .digest('hex')
    .slice(0, 8);
}
