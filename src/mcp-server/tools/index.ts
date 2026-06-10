import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { FindingBridgeMcpContext } from '../context.js';
import {
  DeduplicateFindingsInputSchema,
  ExplainFindingInputSchema,
  GenerateReportInputSchema,
  GetFindingDetailInputSchema,
  ListFindingsInputSchema,
  PrioritizeFindingsInputSchema,
  SuggestFixInputSchema,
} from '../tool-schemas.js';
import { deduplicateFindingsTool } from './deduplicate-findings.js';
import { explainFindingTool } from './explain-finding.js';
import { generateReportTool } from './generate-report.js';
import { getFindingDetailTool } from './get-finding-detail.js';
import { listFindingsTool } from './list-findings.js';
import { prioritizeFindingsTool } from './prioritize-findings.js';
import { suggestFixTool } from './suggest-fix.js';

const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Register every FindingBridge MCP tool on the server.
 *
 * All names use the required `findingbridge_` prefix and all annotations mark
 * the tools as read-only so clients understand they only inspect existing data.
 */
export function registerFindingBridgeTools(
  server: McpServer,
  context: FindingBridgeMcpContext
): void {
  server.registerTool(
    'findingbridge_list_findings',
    {
      title: 'List Findings',
      description: 'List normalized scanner findings with filters, pagination, and redacted summaries.',
      inputSchema: ListFindingsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'List Findings' },
    },
    (input) => listFindingsTool(context, ListFindingsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_get_finding_detail',
    {
      title: 'Get Finding Detail',
      description: 'Return one finding with redacted metadata and at most 20 lines of code context.',
      inputSchema: GetFindingDetailInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Get Finding Detail' },
    },
    (input) => getFindingDetailTool(context, GetFindingDetailInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_explain_finding',
    {
      title: 'Explain Finding',
      description: 'Explain a finding from local normalized metadata without calling an external LLM.',
      inputSchema: ExplainFindingInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Explain Finding' },
    },
    (input) => explainFindingTool(context, ExplainFindingInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_suggest_fix',
    {
      title: 'Suggest Fix',
      description: 'Return remediation guidance without generating patches or modifying repositories.',
      inputSchema: SuggestFixInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Suggest Fix' },
    },
    (input) => suggestFixTool(context, SuggestFixInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_prioritize_findings',
    {
      title: 'Prioritize Findings',
      description: 'Rank selected findings using severity, duplicate status, and caller-supplied risk context.',
      inputSchema: PrioritizeFindingsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Prioritize Findings' },
    },
    (input) => prioritizeFindingsTool(context, PrioritizeFindingsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_deduplicate_findings',
    {
      title: 'Deduplicate Findings',
      description: 'Preview duplicate groups in dry-run mode without mutating stored findings.',
      inputSchema: DeduplicateFindingsInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Deduplicate Findings' },
    },
    (input) => deduplicateFindingsTool(context, DeduplicateFindingsInputSchema.parse(input))
  );

  server.registerTool(
    'findingbridge_generate_report',
    {
      title: 'Generate Report',
      description: 'Generate inline JSON or Markdown report content for a selected findings scope.',
      inputSchema: GenerateReportInputSchema.shape,
      annotations: { ...READ_ONLY_TOOL_ANNOTATIONS, title: 'Generate Report' },
    },
    (input) => generateReportTool(context, GenerateReportInputSchema.parse(input))
  );
}
