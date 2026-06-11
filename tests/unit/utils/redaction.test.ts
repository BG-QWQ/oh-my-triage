import { describe, it, expect } from 'vitest';
import { redactSecrets, redactCodeSnippet } from '@/utils/redaction.js';

describe('redactSecrets', () => {
  it('redacts API tokens', () => {
    const text = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    expect(redactSecrets(text)).toBe('***REDACTED***');
  });

  it('redacts authorization headers', () => {
    const text = 'Authorization: Bearer ghp_1234567890abcdef1234567890abcdef12345678';
    expect(redactSecrets(text)).toBe('Authorization: Bearer ***REDACTED***');
  });

  it('redacts password-like strings', () => {
    const text = 'password: secret123';
    expect(redactSecrets(text)).toBe('password: ***REDACTED***');
  });

  it('leaves normal text unchanged', () => {
    const text = 'This is a normal message about security findings.';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('redactCodeSnippet', () => {
  it('truncates snippets over max lines', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
    const result = redactCodeSnippet(lines.join('\n'), 20);
    expect(result).toContain('line 1');
    expect(result).toContain('... (truncated)');
    expect(result).not.toContain('line 25');
  });

  it('redacts secrets before returning truncated snippets', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
    lines[4] = 'password: secret123';

    const result = redactCodeSnippet(lines.join('\n'), 20);

    expect(result).toContain('password: ***REDACTED***');
    expect(result).not.toContain('secret123');
    expect(result).toContain('... (truncated)');
  });

  it('redacts secrets in snippets', () => {
    const snippet = 'const token = "sk-1234567890abcdef";';
    expect(redactCodeSnippet(snippet)).toContain('***REDACTED***');
  });
});
