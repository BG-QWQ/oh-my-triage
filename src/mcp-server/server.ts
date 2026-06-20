import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createOMTMcpContext, type CreateOMTMcpContextOptions } from './context.js';
import { registerTriageWorkflowPrompt } from './prompts/triage-workflow.js';
import { registerOMTTools } from './tools/index.js';

/**
 * Configure an oh-my-triage MCP server instance.
 *
 * The server exposes only read-only tools over the normalized finding database,
 * preserving oh-my-triage's role as a triage layer rather than an automated
 * repository modifier.
 */
export function createOMTMcpServer(
  options: CreateOMTMcpContextOptions = {}
): McpServer {
  const context = createOMTMcpContext(options);
  const server = new McpServer({
    name: 'oh-my-triage',
    version: '0.1.2',
  });

  registerOMTTools(server, context);
  registerTriageWorkflowPrompt(server);

  return server;
}
