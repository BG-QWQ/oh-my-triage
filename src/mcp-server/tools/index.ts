import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { FindingBridgeMcpContext } from '../context.js';
import {
  DeduplicateFindingsInputSchema,
  ExplainFindingInputSchema,
  GenerateReportInputSchema,
  GetFindingDetailInputSchema,
  ListSourceProjectsInputSchema,
  ListFindingsInputSchema,
  PrioritizeFindingsInputSchema,
  SuggestFixInputSchema,
  SyncSourcesInputSchema,
} from '../tool-schemas.js';
import { deduplicateFindingsTool } from './deduplicate-findings.js';
import { explainFindingTool } from './explain-finding.js';
import { generateReportTool } from './generate-report.js';
import { getFindingDetailTool } from './get-finding-detail.js';
import { listFindingsTool } from './list-findings.js';
import { listSourceProjectsTool } from './list-source-projects.js';
import { prioritizeFindingsTool } from './prioritize-findings.js';
import { suggestFixTool } from './suggest-fix.js';
import { summaryTool } from './summary.js';
import { syncSourcesTool } from './sync-sources.js';

const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const LOCAL_WRITE_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const WORKSPACE_CONFIRMATION_DESCRIPTION =
  'Before relying on results as applying to the current workspace, confirm the repository/project with the user and match it to the configured FindingBridge database or synchronized scanner source.';

/**
 * Register every FindingBridge MCP tool on the server.
 *
 * All names use the required `findingbridge_` prefix. Read tools are annotated
 * separately from synchronization tools because sync writes only FindingBridge's
 * local database while leaving user repositories untouched.
 */
export function registerFindingBridgeTools(
  server: McpServer,
  context: FindingBridgeMcpContext
): void {
  server.registerTool(
    'findingbridge_summary',
    {
      title: 'Summarize Findings',
      description:
        `Return global FindingBridge database counts with explicit no-data and scope metadata. ${WORKSPACE_CONFIRMATION_DESCRIPTION} For current or latest scanner platform results, call findingbridge_sync_sources before this tool. If no findings are returned, report that fact and do not invent vulnerabilities.`,
      inputSchema: {},
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Summarize Findings' },
    },
    () => summaryTool(context)
  );

  server.registerTool(
    'findingbridge_list_findings',
    {
      title: 'List Findings',
      description:
        `List normalized scanner findings with filters, pagination, redacted summaries, and explicit no-data metadata. ${WORKSPACE_CONFIRMATION_DESCRIPTION} rule_id is an exact scanner rule ID match; file_path matches normalized stored finding locations, not scanner project keys, repository names, or current-project selectors. For SonarCloud project keys, use findingbridge_list_source_projects and findingbridge_sync_sources project_keys[source_id]. For current or latest scanner platform results, call findingbridge_sync_sources before this tool. If findings is empty, report that no stored findings matched this request or filters unless a broader unfiltered call or sync proves otherwise; do not invent vulnerabilities.`,
      inputSchema: ListFindingsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'List Findings' },
    },
    (input) => listFindingsTool(context, ListFindingsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_get_finding',
    {
      title: 'Get Finding',
      description:
        `Legacy alias for findingbridge_get_finding_detail. Return one finding with redacted metadata and at most 20 lines of code context. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: GetFindingDetailInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Get Finding' },
    },
    (input) => getFindingDetailTool(context, GetFindingDetailInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_get_finding_detail',
    {
      title: 'Get Finding Detail',
      description: `Return one finding with redacted metadata and at most 20 lines of code context. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: GetFindingDetailInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Get Finding Detail' },
    },
    (input) => getFindingDetailTool(context, GetFindingDetailInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_explain_finding',
    {
      title: 'Explain Finding',
      description: `Explain a finding from local normalized metadata without calling an external LLM. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: ExplainFindingInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Explain Finding' },
    },
    (input) => explainFindingTool(context, ExplainFindingInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_suggest_fix',
    {
      title: 'Suggest Fix',
      description: `Return remediation guidance without generating patches or modifying repositories. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: SuggestFixInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Suggest Fix' },
    },
    (input) => suggestFixTool(context, SuggestFixInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_prioritize_findings',
    {
      title: 'Prioritize Findings',
      description: `Rank selected findings using severity, duplicate status, and caller-supplied risk context. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: PrioritizeFindingsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Prioritize Findings' },
    },
    (input) => prioritizeFindingsTool(context, PrioritizeFindingsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_deduplicate_findings',
    {
      title: 'Deduplicate Findings',
      description: `Preview duplicate groups in dry-run mode without mutating stored findings. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: DeduplicateFindingsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Deduplicate Findings' },
    },
    (input) => deduplicateFindingsTool(context, DeduplicateFindingsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_generate_report',
    {
      title: 'Generate Report',
      description: `Generate inline JSON or Markdown report content for a selected findings scope. ${WORKSPACE_CONFIRMATION_DESCRIPTION}`,
      inputSchema: GenerateReportInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Generate Report' },
    },
    (input) => generateReportTool(context, GenerateReportInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_list_source_projects',
    {
      title: 'List Source Projects',
      description:
        'List projects visible to configured scanner source credentials, such as SonarCloud project keys. The MCP server cannot reliably auto-detect the client workspace; have the user confirm every discovered scanner project that matches the current repository across configured sources before synchronization. SonarCloud discovery is organization-scoped; pass organizations[source_id] when the source config lacks an organization. Use this when synchronization needs project_keys before reading current platform findings, then call findingbridge_sync_sources without source_ids and pass a complete project_keys map for all matching sources that need keys.',
      inputSchema: ListSourceProjectsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'List Source Projects', openWorldHint: true },
    },
    async (input) => listSourceProjectsTool(context, ListSourceProjectsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_sync_sources',
    {
      title: 'Sync Scanner Sources',
      description:
        'Synchronize configured scanner sources into the local FindingBridge database. For current workspace repository results, prefer omitting source_ids: FindingBridge will sync all inferred current-project sources, including GitHub sources matching the current origin remote and SonarCloud sources with saved project_key, per-call project_keys[source_id], or one unique exact/normalized SonarCloud project match for the current GitHub owner/repository. Ambiguous, missing, truncated, or failed SonarCloud project discovery returns skipped source guidance instead of fuzzy auto-syncing. Use source_ids only when the user explicitly asks for specific sources, and use all_sources only when intentionally syncing every enabled source. This may call scanner APIs and write findings to FindingBridge storage, but it never modifies user repositories.',
      inputSchema: SyncSourcesInputSchema.shape,
      annotations: { ...LOCAL_WRITE_TOOL_ANNOTATIONS, title: 'Sync Scanner Sources' },
    },
    async (input) => syncSourcesTool(context, SyncSourcesInputSchema.parse(input))
  );
}
