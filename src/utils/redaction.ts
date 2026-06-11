/** Redact sensitive information from strings */
export function redactSecrets(text: string): string {
  let redacted = text;

  // Redact API tokens and keys
  redacted = redacted.replace(
    /\b(sk-[a-z0-9]{20,}|gh[pousr]_[a-z0-9]{36}|gho_[a-z0-9]{36}|glpat-[a-z0-9-]{20,}|\b[0-9a-f]{40}\b)\b/gi,
    '***REDACTED***'
  );

  // Redact authorization headers
  redacted = redacted.replace(
    /(Authorization:\s*(Bearer|Basic|Token)\s+)[^\s]+/gi,
    '$1***REDACTED***'
  );

  // Redact password-like strings
  redacted = redacted.replace(
    /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s]+/gi,
    '$1: ***REDACTED***'
  );

  // Redact high-entropy strings that look like secrets
  redacted = redacted.replace(
    /\b[a-zA-Z0-9+/]{40,}={0,2}\b/g,
    (match) => {
      // Calculate Shannon entropy
      const entropy = calculateEntropy(match);
      if (entropy > 4.5 && match.length >= 32) {
        return '***REDACTED***';
      }
      return match;
    }
  );

  return redacted;
}

/** Redact code snippet for finding detail (max 20 lines) */
export function redactCodeSnippet(snippet: string, maxLines = 20): string {
  const lines = snippet.split('\n');
  if (lines.length > maxLines) {
    return redactSecrets(lines.slice(0, maxLines).join('\n') + '\n... (truncated)');
  }
  return redactSecrets(snippet);
}

/** Calculate Shannon entropy of a string */
function calculateEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const char of str) {
    freq[char] = (freq[char] ?? 0) + 1;
  }
  const len = str.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
