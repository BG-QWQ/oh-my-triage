import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { ListSourceProjectsInput } from '../tool-schemas.js';
import { toolException, toolSuccess } from '../tool-result.js';
import { ProjectDiscoveryService } from '../../sync/project-discovery.js';

/** List scanner projects visible to configured source credentials. */
export async function listSourceProjectsTool(
  context: FindingBridgeMcpContext,
  input: ListSourceProjectsInput
): Promise<CallToolResult> {
  try {
    const service = new ProjectDiscoveryService({
      config: {
        version: '1',
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        token_storage: context.runtime.tokenStorage,
        sources: context.runtime.configuredSources,
        database_path: context.runtime.databasePath,
      },
    });
    const result = await service.discoverProjects({
      sourceIds: input.source_ids,
      organizations: input.organizations,
      maxPages: input.max_pages,
    });
    return toolSuccess({
      ...result,
      repository_modified: false,
      database_modified: false,
      recommended_next_steps: [
        'For SonarCloud, provide organizations[source_id] when the source configuration does not include an organization.',
        'Choose the project key that matches the current repository.',
        'Call findingbridge_sync_sources with project_keys: { [source_id]: selected_project_key } to sync without editing configuration.',
      ],
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Verify the scanner source is configured and enabled.',
      'Run findingbridge config set-token <source> if the source token is missing.',
      'Retry findingbridge_list_source_projects after fixing credentials.',
    ]);
  }
}
