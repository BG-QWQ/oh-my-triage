import { redactSecrets } from './redaction.js';
/** Simple logger that redacts secrets from output */
export class Logger {
    level;
    constructor(level = 'info') {
        this.level = level;
    }
    debug(message, meta) {
        this.log('debug', message, meta);
    }
    info(message, meta) {
        this.log('info', message, meta);
    }
    warn(message, meta) {
        this.log('warn', message, meta);
    }
    error(message, meta) {
        this.log('error', message, meta);
    }
    log(level, message, meta) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] < levels[this.level])
            return;
        const timestamp = new Date().toISOString();
        const redactedMessage = redactSecrets(message);
        const redactedMeta = meta ? redactSecrets(JSON.stringify(meta)) : undefined;
        const output = redactedMeta
            ? `[${timestamp}] ${level.toUpperCase()}: ${redactedMessage} ${redactedMeta}`
            : `[${timestamp}] ${level.toUpperCase()}: ${redactedMessage}`;
        if (level === 'error') {
            console.error(output);
        }
        else if (level === 'warn') {
            console.warn(output);
        }
        else {
            console.log(output);
        }
    }
}
/** Default logger instance */
export const logger = new Logger();
