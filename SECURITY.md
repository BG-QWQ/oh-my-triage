# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x | ✅ |

## Reporting Vulnerabilities

If you discover a security vulnerability in oh-my-triage:

1. **Do not** open a public issue
2. Email: bg-qwq@qq.com
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if known)

## Response Timeline

- Acknowledgment: Within 48 hours
- Assessment: Within 7 days
- Fix release: Within 30 days
- Public disclosure: After fix is released

## Security Measures

- Secrets are redacted in all outputs
- Tokens stored in system keychain
- No full source code transmitted
- Path traversal prevention
- Input validation with Zod

## Known Limitations

- Plaintext token storage in development mode (shows warning)
- No audit trail for configuration changes
- No multi-factor authentication for scanner APIs
