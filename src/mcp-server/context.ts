import type Database from 'better-sqlite3';
import { createConnection } from '../database/connection.js';
import { FindingRepository } from '../database/repositories/finding-repo.js';
import { RuleRepository } from '../database/repositories/rule-repo.js';

/**
 * Hold shared dependencies for MCP tool handlers.
 *
 * Repositories are created once per server so every tool sees the same SQLite
 * connection and avoids duplicating initialization logic.
 */
export interface FindingBridgeMcpContext {
  db: Database.Database;
  findings: FindingRepository;
  rules: RuleRepository;
}

/**
 * Configure the server context factory.
 *
 * Tests and embedded callers can provide an existing SQLite connection, while
 * the stdio entrypoint can pass a database path and let the context own setup.
 */
export interface CreateFindingBridgeMcpContextOptions {
  db?: Database.Database;
  dbPath?: string;
}

/**
 * Create repository-backed MCP server context.
 *
 * The default database path supports local development and MCP Inspector smoke
 * tests without additional configuration.
 */
export function createFindingBridgeMcpContext(
  options: CreateFindingBridgeMcpContextOptions = {}
): FindingBridgeMcpContext {
  const db = options.db ?? createConnection(options.dbPath ?? 'findingbridge.db');

  return {
    db,
    findings: new FindingRepository(db),
    rules: new RuleRepository(db),
  };
}
