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

/**
 * Auto-enable system CA certificates on Node.js 24+.
 *
 * Node.js's bundled CA list may not include corporate proxy root CAs
 * that are installed in the OS trust store. This causes outbound HTTPS
 * via fetch() to fail with "unable to verify the first certificate" in
 * enterprise environments. Re-exec the process with --use-system-ca so
 * that the OS certificate store is used alongside the bundled CAs.
 */
const __nodeMajor = Number.parseInt(process.version.slice(1).split('.')[0], 10);
const __hasSystemCa = process.execArgv.includes('--use-system-ca') ||
                      (process.env.NODE_OPTIONS ?? '').includes('--use-system-ca');

if (__nodeMajor >= 24 && !__hasSystemCa) {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--use-system-ca', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('Failed to restart FindingBridge with system CA certificates:', err.message);
    process.exit(1);
  });
} else {
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
}
