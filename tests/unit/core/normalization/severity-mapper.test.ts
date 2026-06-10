import { describe, it, expect } from 'vitest';
import { normalizeSeverity, severityOrder, compareSeverity } from '@/core/normalization/severity-mapper.js';
import type { UnifiedSeverity } from '@/core/models/common.js';

describe('normalizeSeverity', () => {
  const testCases: Array<{ raw: string; tool: string; expected: UnifiedSeverity }> = [
    // SARIF
    { raw: 'error', tool: 'sarif', expected: 'high' },
    { raw: 'warning', tool: 'sarif', expected: 'medium' },
    { raw: 'note', tool: 'sarif', expected: 'low' },
    { raw: 'none', tool: 'sarif', expected: 'info' },
    // GitHub
    { raw: 'critical', tool: 'github', expected: 'critical' },
    { raw: 'high', tool: 'github', expected: 'high' },
    { raw: 'medium', tool: 'github', expected: 'medium' },
    { raw: 'low', tool: 'github', expected: 'low' },
    { raw: 'warning', tool: 'github', expected: 'info' },
    // SonarCloud
    { raw: 'BLOCKER', tool: 'sonarcloud', expected: 'critical' },
    { raw: 'CRITICAL', tool: 'sonarcloud', expected: 'high' },
    { raw: 'MAJOR', tool: 'sonarcloud', expected: 'medium' },
    { raw: 'MINOR', tool: 'sonarcloud', expected: 'low' },
    { raw: 'INFO', tool: 'sonarcloud', expected: 'info' },
    // Generic
    { raw: 'unknown', tool: 'unknown', expected: 'info' },
    { raw: 'whatever', tool: 'unknown', expected: 'info' },
  ];

  for (const { raw, tool, expected } of testCases) {
    it(`maps ${tool}/${raw} to ${expected}`, () => {
      expect(normalizeSeverity(raw, tool)).toBe(expected);
    });
  }
});

describe('severityOrder', () => {
  it('returns ordered severity levels', () => {
    expect(severityOrder()).toEqual(['critical', 'high', 'medium', 'low', 'info']);
  });
});

describe('compareSeverity', () => {
  it('returns negative when a is more severe', () => {
    expect(compareSeverity('critical', 'low')).toBeLessThan(0);
    expect(compareSeverity('high', 'info')).toBeLessThan(0);
  });

  it('returns positive when b is more severe', () => {
    expect(compareSeverity('low', 'critical')).toBeGreaterThan(0);
    expect(compareSeverity('info', 'high')).toBeGreaterThan(0);
  });

  it('returns 0 for equal severity', () => {
    expect(compareSeverity('medium', 'medium')).toBe(0);
  });
});
