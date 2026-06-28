import { describe, expect, it } from 'vitest';
import { buildSemgrepSetupSources } from '@/web-ui/app.js';

describe('buildSemgrepSetupSources', () => {
  it('builds one Semgrep Code source when SAST only is selected', () => {
    const sources = buildSemgrepSetupSources({
      token: 'token-123',
      deployment: 'acme-deployment',
      issueType: 'sast',
    });

    expect(sources).toEqual([
      {
        id: 'semgrep',
        type: 'semgrep',
        name: 'Semgrep Code',
        enabled: true,
        token: 'token-123',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sast',
        },
      },
    ]);
  });

  it('builds one Semgrep Supply Chain source when SCA only is selected', () => {
    const sources = buildSemgrepSetupSources({
      token: 'token-123',
      deployment: 'acme-deployment',
      issueType: 'sca',
    });

    expect(sources).toEqual([
      {
        id: 'semgrep',
        type: 'semgrep',
        name: 'Semgrep Supply Chain',
        enabled: true,
        token: 'token-123',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sca',
        },
      },
    ]);
  });

  it('builds separate Semgrep Code and Supply Chain sources when both are selected', () => {
    const sources = buildSemgrepSetupSources({
      token: 'token-123',
      deployment: 'acme-deployment',
      issueType: 'both',
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'semgrep',
        name: 'Semgrep Code',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sast',
        },
      }),
      expect.objectContaining({
        id: 'semgrep-supply-chain',
        name: 'Semgrep Supply Chain',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sca',
        },
      }),
    ]);
  });
});
