import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { loadConfig } from '../../config/config.js';
import { detectMcpClients } from '../../config/mcp-client-detector.js';
import { redactSecrets } from '../../utils/redaction.js';

type DiagnoseOptions = {
  config?: string;
};

/** Create the `diagnose` command for generating redacted troubleshooting context. */
export function createDiagnoseCommand(): Command {
  return new Command('diagnose')
    .description('Generate diagnostic report for troubleshooting')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: DiagnoseOptions) => {
      const report: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        cwd: process.cwd(),
      };

      try {
        const loaded = await loadConfig(options.config);
        report.config = {
          filepath: loaded.filepath,
          source_count: loaded.config.sources.length,
          database_path: loaded.config.database_path,
          database_exists: loaded.config.database_path ? existsSync(loaded.config.database_path) : false,
          token_storage: loaded.config.token_storage,
        };
        report.mcp_clients = await detectMcpClients(loaded.config.mcp_client_paths);
      } catch (error: unknown) {
        report.config_error = String(error);
        report.mcp_clients = await detectMcpClients();
      }

      console.log(redactSecrets(JSON.stringify(report, null, 2)));
    });
}
