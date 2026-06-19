import { Command } from 'commander';
import { password } from '@inquirer/prompts';
import { loadConfig, loadOrCreateConfig, updateConfig } from '../../config/config.js';
import { CredentialStore } from '../../config/credential-store.js';
import { redactSecrets } from '../../utils/redaction.js';

type ConfigCommandOptions = {
  config?: string;
};

/** Create the `config` command group for inspecting and updating configuration. */
export function createConfigCommand(): Command {
  const command = new Command('config').description('Manage oh-my-triage configuration');

  command
    .command('show')
    .description('Show current configuration')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: ConfigCommandOptions) => {
      const loaded = await loadConfig(options.config);
      console.log(redactSecrets(JSON.stringify({ filepath: loaded.filepath, config: loaded.config }, null, 2)));
    });

  command
    .command('test')
    .description('Test all configured scanner connections')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (options: ConfigCommandOptions) => {
      const loaded = await loadOrCreateConfig(options.config);
      const checks = loaded.config.sources.map((source) => ({
        source_id: source.id,
        source_type: source.type,
        valid: source.type === 'sarif' ? Boolean(source.path) : Boolean(source.token_ref),
        suggestion: source.type === 'sarif' ? 'Ensure the SARIF path exists before ingestion.' : 'Run oh-my-triage config set-token <source> (or omt config set-token <source>).',
      }));
      console.log(JSON.stringify({ config: loaded.filepath, checks }, null, 2));
    });

  command
    .command('set-token <source>')
    .description('Update token for a scanner source')
    .option('-c, --config <path>', 'Configuration file path')
    .action(async (source: string, options: ConfigCommandOptions) => {
      const loaded = await loadOrCreateConfig(options.config);
      const token = await password({ message: `Token for ${source}` });
      const credentialStore = new CredentialStore();
      const writeResult = await credentialStore.setToken(source, token, loaded.config.token_storage);
      const updated = await updateConfig(
        (config) => ({
          ...config,
          token_storage: writeResult.storage,
          sources: config.sources.map((item) => (item.id === source ? { ...item, token_ref: writeResult.tokenRef } : item)),
        }),
        loaded.filepath
      );
      console.log(`Token reference updated in ${updated.filepath}.`);
      if (writeResult.warning) {
        console.warn(writeResult.warning);
      }
    });

  return command;
}
