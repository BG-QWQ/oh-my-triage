import { redactSecrets } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Simple logger that redacts secrets from output */
export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] < levels[this.level]) return;

    const timestamp = new Date().toISOString();
    const redactedMessage = redactSecrets(message);
    const redactedMeta = meta ? redactSecrets(JSON.stringify(meta)) : undefined;

    const output = redactedMeta
      ? `[${timestamp}] ${level.toUpperCase()}: ${redactedMessage} ${redactedMeta}`
      : `[${timestamp}] ${level.toUpperCase()}: ${redactedMessage}`;

    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

/** Default logger instance */
export const logger = new Logger();
