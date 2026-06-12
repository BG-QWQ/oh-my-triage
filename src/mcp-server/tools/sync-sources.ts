import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FindingBridgeMcpContext } from '../context.js';
import type { SyncSourcesInput } from '../tool-schemas.js';
import { toolException, toolSuccess } from '../tool-result.js';
import { SourceSyncService } from '../../sync/source-sync.js';

/** Synchronize configured scanner sources into the local FindingBridge database. */
export async function syncSourcesTool(
  context: FindingBridgeMcpContext,
  input: SyncSourcesInput
): Promise<CallToolResult> {
  try {
    const service = new SourceSyncService({
      db: context.db,
      config: {
        version: '1',
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        token_storage: context.runtime.tokenStorage,
        sources: context.runtime.configuredSources,
        database_path: context.runtime.databasePath,
      },
      databasePath: context.runtime.databasePath,
    });
    const result = await service.syncSources({
      sourceIds: input.source_ids,
      projectKeys: input.project_keys,
      allSources: input.all_sources,
      maxPages: input.max_pages,
    });
    return toolSuccess({
      ...result,
      repository_modified: false,
      database_modified: result.sources_total > 0,
      recommended_next_steps: [
        'Call findingbridge_summary to inspect synchronized finding counts.',
        'Then call findingbridge_list_findings for the synchronized finding details.',
      ],
    });
  } catch (error: unknown) {
    return toolException(error, [
      'Verify FindingBridge scanner sources are configured and enabled.',
      'Run findingbridge config test to check scanner credentials.',
      'Use findingbridge ingest --sarif path/to/results.sarif if the scanner can only export SARIF.',
    ]);
  }
}
