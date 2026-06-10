import { Command } from 'commander';
import { initializeConfig } from '../../config/config.js';

type InitOptions = {
  config?: string;
  force?: boolean;
};

/** Create the `init` command for initializing FindingBridge configuration. */
export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize FindingBridge configuration')
    .option('-c, --config <path>', 'Configuration file path')
    .option('--force', 'Overwrite an existing configuration file')
    .action(async (options: InitOptions) => {
      const result = await initializeConfig({ configPath: options.config, force: options.force });
      console.log(`FindingBridge configuration ready: ${result.filepath}`);
    });
}
