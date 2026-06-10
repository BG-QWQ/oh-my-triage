import { Command } from 'commander';
import { startWebSetup } from '../../config/setup-service.js';
import { runCliSetupWizard } from '../setup-cli-wizard.js';

type SetupOptions = {
  cli?: boolean;
  add?: boolean;
  reset?: boolean;
  config?: string;
};

/** Create the `setup` command for guided web or CLI setup. */
export function createSetupCommand(): Command {
  return new Command('setup')
    .description('Run the guided setup wizard')
    .option('--cli', 'Use CLI wizard instead of Web UI')
    .option('--add', 'Add new scanner to existing config')
    .option('--reset', 'Reset all configuration')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: SetupOptions) => {
      if (options.cli) {
        const result = await runCliSetupWizard({ configPath: options.config, add: options.add, reset: options.reset });
        console.log(`Setup complete: ${result.config.filepath}`);
        return;
      }

      const result = await startWebSetup({ configPath: options.config, reset: options.reset });
      console.log(`Setup prepared: ${result.config.filepath}`);
    });
}
