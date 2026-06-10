import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type Database from 'better-sqlite3';
import { closeConnection, createConnection } from '@/database/connection.js';
import { FindingRepository } from '@/database/repositories/finding-repo.js';
import { RuleRepository } from '@/database/repositories/rule-repo.js';
import { listFindingsTool } from '@/mcp-server/tools/list-findings.js';
import { summaryTool } from '@/mcp-server/tools/summary.js';
import type { FindingBridgeToolEnvelope } from '@/mcp-server/tool-result.js';
import type { FindingBridgeMcpContext } from '@/mcp-server/context.js';
import type { Finding } from '@/core/models/finding.js';

function unwrapData(result: CallToolResult): Record<string, unknown> {
  const envelope = result.structuredContent as FindingBridgeToolEnvelope<Record<string, unknown>> | undefined;
  expect(envelope?.success).toBe(true);
  if (!envelope || !envelope.success) {
    throw new Error('Expected successful FindingBridge tool envelope.');
  }
  return envelope.data;
}

describe('MCP no-data responses', () => {
  let db: Database.Database;
  let context: FindingBridgeMcpContext;

  beforeEach(() => {
    db = createConnection(':memory:');
    context = {
      db,
      findings: new FindingRepository(db),
      rules: new RuleRepository(db),
      runtime: {
        databasePath: ':memory:',
        configuredSources: [],
        demoMode: false,
      },
    };
  });

  afterEach(() => {
    closeConnection(db);
  });

  it('makes empty list_findings responses explicit and non-inferential', () => {
    const data = unwrapData(
      listFindingsTool(context, {
        limit: 20,
        offset: 0,
        sort_by: 'priority_score',
      })
    );

    expect(data.findings).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.has_findings).toBe(false);
    expect(data.data_availability).toMatchObject({
      has_findings: false,
      no_data_reason: 'No findings are available in the configured FindingBridge database for this request.',
      agent_instruction: expect.stringContaining('Do not invent vulnerabilities'),
    });
    expect(data.scope).toMatchObject({
      type: 'global_database',
      project_scope_supported: false,
      current_project_matched: false,
      agent_instruction: expect.stringContaining('Do not claim these findings apply to the current project'),
    });
  });

  it('makes empty summary responses explicit and non-inferential', () => {
    const data = unwrapData(summaryTool(context));

    expect(data.severity_counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    expect(data.total).toBe(0);
    expect(data.has_findings).toBe(false);
    expect(data.data_availability).toMatchObject({
      has_findings: false,
      agent_instruction: expect.stringContaining('Do not invent vulnerabilities'),
    });
    expect(data.scope).toMatchObject({
      type: 'global_database',
      project_scope_supported: false,
      current_project_matched: false,
    });
  });

  it('warns when configured sources do not match stored finding tools', () => {
    context = {
      ...context,
      runtime: {
        databasePath: ':memory:',
        demoMode: false,
        configuredSources: [
          {
            id: 'sonarcloud',
            type: 'sonarcloud',
            enabled: true,
            options: {},
          },
        ],
      },
    };
    context.findings.upsert(createCodeQlFinding());

    const data = unwrapData(summaryTool(context));

    expect(data.total).toBe(1);
    expect(data.provenance_warnings).toEqual([
      expect.objectContaining({
        code: 'source_tool_mismatch',
        observed_tools: ['CodeQL'],
        remediation_steps: expect.arrayContaining([
          expect.stringContaining('Do not treat the current findings as results from the configured code review platform'),
          expect.stringContaining('findingbridge config show'),
          expect.stringContaining('findingbridge server --db path/to/findingbridge.db'),
          expect.stringContaining('findingbridge ingest --sarif path/to/results.sarif --db path/to/findingbridge.db'),
          expect.stringContaining('add a scanner adapter'),
        ]),
        agent_instruction: expect.stringContaining('configured code review platform'),
      }),
    ]);

    const listData = unwrapData(
      listFindingsTool(context, {
        limit: 20,
        offset: 0,
        sort_by: 'priority_score',
      })
    );
    expect(listData.provenance_warnings).toEqual(data.provenance_warnings);
  });

  it('redacts secret-shaped scanner tool names in provenance warnings', () => {
    context.findings.upsert(createCodeQlFinding('CodeQL token=ghp_secret123'));

    const data = unwrapData(summaryTool(context));

    expect(data.provenance_warnings).toEqual([
      expect.objectContaining({
        code: 'unconfigured_findings',
        observed_tools: [expect.stringContaining('***REDACTED***')],
        remediation_steps: expect.arrayContaining([
          expect.stringContaining('back up and delete that stale SQLite database file'),
        ]),
      }),
    ]);
  });
});

function createCodeQlFinding(tool = 'CodeQL'): Finding {
  return {
    id: `fb-codeql-mismatch-${tool === 'CodeQL' ? '001' : '002'}`,
    source: {
      tool,
      rule_id: 'js/sql-injection',
      original_id: 'CodeQL:js/sql-injection:0',
    },
    title: 'SQL injection',
    message: 'Synthetic CodeQL finding used to verify source mismatch warnings.',
    severity: 'medium',
    raw_severity: 'warning',
    location: {
      file_path: 'src/db.ts',
      start_line: 42,
    },
    status: 'open',
    fingerprint: 'codeql-mismatch-fingerprint',
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: '2024-01-01T00:00:00Z',
    last_seen_at: '2024-01-01T00:00:00Z',
    raw_data: { ruleId: 'js/sql-injection' },
  };
}
