import { Command } from 'commander';
import { initializeConfig } from '../../config/config.js';

type InitOptions = {
  config?: string;
  force?: boolean;
};

/** Create the `init` command for initializing oh-my-triage configuration. */
export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize oh-my-triage configuration')
    .option('-c, --config <path>', 'Configuration file path')
    .option('--force', 'Overwrite an existing configuration file')
    .action(async (options: InitOptions) => {
      const result = await initializeConfig({ configPath: options.config, force: options.force });
      console.log(`oh-my-triage configuration ready: ${result.filepath}`);
    });
}
