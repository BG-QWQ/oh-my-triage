import open from 'open';
import { OMTError, ErrorCodes } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_SETUP_HOST, DEFAULT_SETUP_PORT } from './defaults.js';
import { initializeConfig, loadOrCreateConfig, type LoadedConfig } from './config.js';
import { detectMcpClients } from './mcp-client-detector.js';
import { writeMcpClientConfig, type McpConfigWriteResult } from './mcp-config-writer.js';
import { startStaticServer, stopStaticServer } from '../web-ui/static-assets.js';
import type { Config } from './validation.js';

export type SetupResult = {
  config: LoadedConfig;
  mcpWrites: McpConfigWriteResult[];
};

/** Reset or create configuration and optionally write detected MCP client configs. */
export async function runSetupService(params?: {
  configPath?: string;
  reset?: boolean;
  writeMcp?: boolean;
  command?: string;
  config?: Partial<Config>;
}): Promise<SetupResult> {
  const config = params?.reset
    ? await initializeConfig({ configPath: params.configPath, force: true, config: params.config })
    : await loadOrCreateConfig(params?.configPath);

  const mcpWrites: McpConfigWriteResult[] = [];
  if (params?.writeMcp) {
    const clients = await detectMcpClients(config.config.mcp_client_paths);
    const writableClients = clients.filter((client) => client.exists);
    for (const client of writableClients) {
      mcpWrites.push(
        await writeMcpClientConfig({
          client,
          command: params.command ?? process.execPath,
          args: params.command ? ['server'] : [process.argv[1] ?? 'oh-my-triage', 'server'],
        })
      );
    }
  }

  return { config, mcpWrites };
}

/** Start the local web setup wizard and serve the full Web UI. */
export async function startWebSetup(params?: { host?: string; port?: number; configPath?: string; reset?: boolean }): Promise<SetupResult> {
  const host = params?.host ?? DEFAULT_SETUP_HOST;
  const port = params?.port ?? DEFAULT_SETUP_PORT;
  const setupUrl = `http://${host}:${port}/setup`;

  // Start the static server serving the Web UI
  const staticServer = await startStaticServer({ host, port });
  logger.info(`Web setup wizard available at ${staticServer.url}`);

  // Open the browser
  try {
    await open(setupUrl);
    logger.info(`Opened browser to ${setupUrl}`);
  } catch (error: unknown) {
    await stopStaticServer(staticServer.server);
    throw new OMTError({
      code: ErrorCodes.SETUP_BROWSER_FAILED,
      message: 'Unable to open the setup wizard in a browser.',
      nextSteps: [`Open ${setupUrl} manually or run oh-my-triage setup --cli.`],
      details: { error: String(error) },
    });
  }

  // Keep server running for a reasonable timeout so the user can complete setup
  // In a real implementation, the server would have API endpoints that the Web UI
  // calls to save config; for now, we keep the server alive and wait for user
  console.log(`\nSetup wizard running at ${setupUrl}`);
  console.log('Press Ctrl+C to stop the server when done.\n');

  // Wait indefinitely (or until process is interrupted)
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down setup server');
      resolve();
    });
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down setup server');
      resolve();
    });
  });

  await stopStaticServer(staticServer.server);

  // Load or create the config after setup. The web UI already persisted any
  // changes through the setup API, so re-saving here would be redundant and
  // could overwrite a backup made during an active wizard session.
  return await runSetupService({ configPath: params?.configPath, reset: params?.reset });
}
