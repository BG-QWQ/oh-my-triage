import { describe, it, expect } from 'vitest';
import { sha256, generateFingerprint, generateLocationFingerprint, generateSemanticFingerprint } from '@/utils/hash.js';

describe('sha256', () => {
  it('returns consistent hash for same input', () => {
    const hash1 = sha256('test');
    const hash2 = sha256('test');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('returns different hash for different inputs', () => {
    const hash1 = sha256('test1');
    const hash2 = sha256('test2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('generateFingerprint', () => {
  it('returns consistent fingerprint for same params', () => {
    const params = { tool: 'github', ruleId: 'js/sql', filePath: 'src/db.ts', startLine: 42, message: 'SQL injection' };
    const fp1 = generateFingerprint(params);
    const fp2 = generateFingerprint(params);
    expect(fp1).toBe(fp2);
  });

  it('returns different fingerprint for different params', () => {
    const fp1 = generateFingerprint({ tool: 'github', ruleId: 'js/sql', filePath: 'src/db.ts', startLine: 42, message: 'SQL injection' });
    const fp2 = generateFingerprint({ tool: 'github', ruleId: 'js/sql', filePath: 'src/db.ts', startLine: 43, message: 'SQL injection' });
    expect(fp1).not.toBe(fp2);
  });
});

describe('generateLocationFingerprint', () => {
  it('returns consistent fingerprint for same location', () => {
    const params = { filePath: 'src/db.ts', startLine: 42 };
    const fp1 = generateLocationFingerprint(params);
    const fp2 = generateLocationFingerprint(params);
    expect(fp1).toBe(fp2);
  });
});

describe('generateSemanticFingerprint', () => {
  it('returns consistent fingerprint for same CWE and file', () => {
    const params = { cweId: 'CWE-89', filePath: 'src/db.ts' };
    const fp1 = generateSemanticFingerprint(params);
    const fp2 = generateSemanticFingerprint(params);
    expect(fp1).toBe(fp2);
  });
});
