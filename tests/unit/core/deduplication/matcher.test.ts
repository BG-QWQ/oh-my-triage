import { describe, expect, it } from 'vitest';
import { previewDuplicates } from '@/core/deduplication/matcher.js';
import type { Finding } from '@/core/models/finding.js';

describe('previewDuplicates', () => {
  it('groups exact duplicate findings and emits sorted duplicates without reordering input', () => {
    const lowPriority = createFinding('fb-low-priority', { severity: 'low', priority_score: 10 });
    const highPriority = createFinding('fb-high-priority', { priority_score: 90 });
    const mediumPriority = createFinding('fb-medium-priority', { severity: 'medium', priority_score: 50 });
    const findings = [lowPriority, highPriority, mediumPriority];

    const groups = previewDuplicates(findings);

    expect(findings.map((finding) => finding.id)).toEqual(['fb-low-priority', 'fb-high-priority', 'fb-medium-priority']);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      match_level: 'exact',
      confidence: 0.99,
      representative: expect.objectContaining({ id: 'fb-high-priority' }),
      duplicates: [
        expect.objectContaining({ id: 'fb-medium-priority' }),
        expect.objectContaining({ id: 'fb-low-priority' }),
      ],
    });
  });
});

function createFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    source: {
      tool: 'CodeQL',
      rule_id: 'js/sql-injection',
      original_id: `${id}:original`,
    },
    title: 'SQL injection',
    message: 'Synthetic duplicate finding.',
    severity: 'high',
    raw_severity: 'warning',
    location: {
      file_path: 'src/db.ts',
      start_line: 42,
      code_snippet: 'db.query(input)',
    },
    status: 'open',
    fingerprint: `${id}:fingerprint`,
    is_duplicate: false,
    priority_score: 50,
    first_seen_at: '2024-01-01T00:00:00Z',
    last_seen_at: '2024-01-01T00:00:00Z',
    raw_data: {},
    ...overrides,
  };
}
