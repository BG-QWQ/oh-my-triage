import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createFindingBridgeMcpContext, type CreateFindingBridgeMcpContextOptions } from './context.js';
import { registerTriageWorkflowPrompt } from './prompts/triage-workflow.js';
import { registerFindingBridgeTools } from './tools/index.js';

/**
 * Configure a FindingBridge MCP server instance.
 *
 * The server exposes only read-only tools over the normalized finding database,
 * preserving FindingBridge's role as a triage layer rather than an automated
 * repository modifier.
 */
export function createFindingBridgeMcpServer(
  options: CreateFindingBridgeMcpContextOptions = {}
): McpServer {
  const context = createFindingBridgeMcpContext(options);
  const server = new McpServer({
    name: 'findingbridge',
    version: '0.1.0',
  });

  registerFindingBridgeTools(server, context);
  registerTriageWorkflowPrompt(server);

  return server;
}
