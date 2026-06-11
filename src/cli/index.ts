#!/usr/bin/env node
import { Command } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createIngestCommand } from './commands/ingest.js';
import { createServerCommand } from './commands/server.js';
import { createSetupCommand } from './commands/setup.js';
import { createConfigCommand } from './commands/config.js';
import { createDiagnoseCommand } from './commands/diagnose.js';
import { createSyncCommand } from './commands/sync.js';
import { VERSION } from '../utils/version.js';
import { redactSecrets } from '../utils/redaction.js';

const program = new Command()
  .name('findingbridge')
  .description('FindingBridge — Connect your scanners. Let AI explain the noise.')
  .version(VERSION, '-v, --version', 'Show version number');

program.addCommand(createInitCommand());
program.addCommand(createIngestCommand());
program.addCommand(createSyncCommand());
program.addCommand(createServerCommand());
program.addCommand(createSetupCommand());
program.addCommand(createConfigCommand());
program.addCommand(createDiagnoseCommand());

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
