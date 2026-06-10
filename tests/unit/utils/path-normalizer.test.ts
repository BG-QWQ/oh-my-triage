import { describe, it, expect } from 'vitest';
import { normalizePath } from '@/utils/path-normalizer.js';

describe('normalizePath', () => {
  it('replaces backslashes with forward slashes', () => {
    expect(normalizePath('src\\db.ts')).toBe('src/db.ts');
  });

  it('removes file:// prefix', () => {
    expect(normalizePath('file:///src/db.ts')).toBe('src/db.ts');
  });

  it('removes %SRCROOT% prefix', () => {
    expect(normalizePath('%SRCROOT%/src/db.ts')).toBe('src/db.ts');
  });

  it('removes project root prefix', () => {
    expect(normalizePath('/project/src/db.ts', '/project')).toBe('src/db.ts');
  });

  it('rejects path traversal', () => {
    expect(() => normalizePath('../../../etc/passwd')).toThrow('Path traversal detected');
  });

  it('removes leading slash', () => {
    expect(normalizePath('/src/db.ts')).toBe('src/db.ts');
  });

  it('handles complex paths', () => {
    expect(normalizePath('file:///project/src/db.ts', '/project')).toBe('src/db.ts');
  });
});
