import { describe, expect, it, vi } from 'vitest';
import { generateMarkdownReport } from '@/core/reporting/markdown-report.js';
import type { Finding } from '@/core/models/finding.js';

describe('generateMarkdownReport', () => {
  it('renders summary, priorities, duplicate metadata, and fix suggestions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));

    try {
      const report = generateMarkdownReport([createFinding(), createFinding('fb-report-002', { is_duplicate: true, duplicate_group_id: 'dup-001' })], { title: 'Custom Report' });

      expect(report.title).toBe('Custom Report');
      expect(report.content).toContain('# Custom Report');
      expect(report.content).toContain('Generated: 2024-01-02T03:04:05.000Z');
      expect(report.content).toContain('- **Total findings**: 2');
      expect(report.content).toContain('## Top Priorities');
      expect(report.content).toContain('- **fb-report-001** (critical): SQL injection');
      expect(report.content).toContain('- **Duplicate**: Yes (group dup-001)');
      expect(report.content).toContain('**Fix Suggestion**: Use parameterized queries.');
      expect(report.content).toContain('```ts\nquery();\n```');
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits the detailed findings section when recommendations are disabled', () => {
    const report = generateMarkdownReport([createFinding()], { includeRecommendations: false });

    expect(report.content).not.toContain('## All Findings');
    expect(report.content).toContain('## Top Priorities');
  });
});

function createFinding(id = 'fb-report-001', overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    source: {
      tool: 'SonarCloud',
      rule_id: 'typescript:S3649',
      original_id: 'sonar:issue:1',
    },
    title: 'SQL injection',
    message: 'Synthetic report finding.',
    severity: 'critical',
    raw_severity: 'BLOCKER',
    cwe_id: 'CWE-89',
    location: {
      file_path: 'src/db.ts',
      start_line: 7,
    },
    status: 'open',
    fingerprint: 'report-fingerprint',
    duplicate_group_id: undefined,
    is_duplicate: false,
    priority_score: 95,
    fix_suggestion: {
      description: 'Use parameterized queries.',
      code_example: 'query();',
      effort_estimate: '10min',
      breaking_risk: 'low',
    },
    first_seen_at: '2024-01-01T00:00:00Z',
    last_seen_at: '2024-01-01T00:00:00Z',
    raw_data: {},
    ...overrides,
  };
}
