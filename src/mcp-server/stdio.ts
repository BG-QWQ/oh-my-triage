import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFindingBridgeMcpServer } from './server.js';

/**
 * Start the FindingBridge MCP server over stdio.
 *
 * Stdio is the default local transport for MCP clients that spawn FindingBridge
 * as a child process and exchange JSON-RPC messages over standard streams.
 */
export async function startFindingBridgeStdioServer(dbPath?: string): Promise<void> {
  const server = createFindingBridgeMcpServer({ dbPath });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
