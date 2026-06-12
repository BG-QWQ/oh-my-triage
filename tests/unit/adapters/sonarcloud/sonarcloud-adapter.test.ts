import { describe, expect, it } from 'vitest';
import { Finding } from '@/core/models/finding.js';
import { mapSonarCloudIssueToFinding } from '@/adapters/sonarcloud/sonarcloud-adapter.js';
import type { SonarCloudIssue } from '@/adapters/sonarcloud/sonarcloud-schemas.js';

describe('mapSonarCloudIssueToFinding', () => {
  it('normalizes SonarCloud compact timezone timestamps into ISO datetimes', () => {
    const finding = mapSonarCloudIssueToFinding({
      key: 'issue-1',
      rule: 'typescript:S1234',
      severity: 'MAJOR',
      component: 'acme_project:src/app.ts',
      project: 'acme_project',
      line: 12,
      status: 'OPEN',
      message: 'Example SonarCloud issue.',
      creationDate: '2024-01-01T12:34:56+0000',
      updateDate: '2024-01-02T13:35:57+0900',
    } satisfies SonarCloudIssue);

    expect(finding.first_seen_at).toBe('2024-01-01T12:34:56.000Z');
    expect(finding.last_seen_at).toBe('2024-01-02T04:35:57.000Z');
    expect(() => Finding.parse(finding)).not.toThrow();
  });

  it('keeps identical SonarCloud issues in different projects fingerprint-isolated', () => {
    const firstFinding = mapSonarCloudIssueToFinding(createIssue('acme_project'));
    const secondFinding = mapSonarCloudIssueToFinding(createIssue('acme_other_project'));

    expect(firstFinding.fingerprint).not.toBe(secondFinding.fingerprint);
    expect(firstFinding.source.rule_id).toBe(secondFinding.source.rule_id);
    expect(firstFinding.location.file_path).toBe(secondFinding.location.file_path);
  });
});

function createIssue(project: string): SonarCloudIssue {
  return {
    key: `${project}-issue-1`,
    rule: 'typescript:S1234',
    severity: 'MAJOR',
    component: `${project}:src/app.ts`,
    project,
    line: 12,
    status: 'OPEN',
    message: 'Example SonarCloud issue.',
    creationDate: '2024-01-01T12:34:56+0000',
    updateDate: '2024-01-02T13:35:57+0000',
  };
}
