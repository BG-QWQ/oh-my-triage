const SECRET_PATTERNS = [
  /token[:\s=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
  /api[_-]?key[:\s=]+['"]?([a-zA-Z0-9_-]{16,})['"]?/gi,
  /password[:\s=]+['"]?[^'"\s]{8,}['"]?/gi,
  /secret[:\s=]+['"]?([a-zA-Z0-9_-]{16,})['"]?/gi,
  /authorization[:\s=]+\s*(bearer\s+)?([a-zA-Z0-9_.-]{20,})/gi,
  /private[_-]?key[:\s=]+['"]?[^'"\s]{20,}['"]?/gi,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /github_pat_\w{22,}/g,
  /sk-[a-zA-Z0-9]{48}/g,
]

/** Redact secrets from a string, replacing with ***REDACTED*** */
export function redactSecrets(input: string): string {
  let result = input
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const prefix = match.slice(0, Math.min(4, match.indexOf('=') + 1 || match.indexOf(':') + 1 || 4))
      return `${prefix}***REDACTED***`
    })
  }
  return result
}

/** Redact object values recursively, preserving structure */
export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = redactSecrets(value)
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

/** Redact sensitive headers from an HTTP header object */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitive = new Set([
    'authorization',
    'x-api-key',
    'x-auth-token',
    'cookie',
    'set-cookie',
  ])
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (sensitive.has(key.toLowerCase())) {
      result[key] = '***REDACTED***'
    } else {
      result[key] = redactSecrets(value)
    }
  }
  return result
}
