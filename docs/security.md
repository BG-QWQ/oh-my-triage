# Security & Privacy Guide

## Data Minimization

FindingBridge follows the principle of collecting only what's necessary:

- **No full source upload**: Only finding metadata and up to 20 lines of code context
- **No repository access**: Read-only tools, no write operations
- **Local-first**: SQLite database stored in `~/.findingbridge/`

## Secret Handling

### Automatic Redaction

Secrets are automatically redacted from:
- MCP tool responses
- Log output
- Diagnostic reports
- Code snippets

### Redaction Patterns

- API tokens (e.g., `sk-...`, `ghp_...`)
- Authorization headers
- Password-like strings
- High-entropy strings (Shannon entropy > 4.5)

### Token Storage

**Default**: System keychain via `keytar`
- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service / kwallet

**Fallbacks**:
1. Environment variables
2. Encrypted local file
3. Plaintext (development only, with explicit warning)

## Path Security

- Path traversal attempts are rejected (e.g., `../../../etc/passwd`)
- Absolute paths are normalized to relative paths
- SARIF `%SRCROOT%` placeholders are stripped
- `file://` prefixes are removed

## Input Validation

All external inputs are validated with Zod:
- SARIF files must conform to 2.1.0 schema
- API responses are validated before processing
- File size limits: 50MB for SARIF files
- Malformed JSON returns actionable errors

## LLM Safety

The MCP skill file instructs LLM agents to:
- Never send full source files to external services
- Never repeat API tokens in responses
- Never auto-apply fixes without human review
- Always report confidence levels for assessments

## Reporting Security Issues

If you discover a security vulnerability in FindingBridge:

1. Do not open a public issue
2. Email security@findingbridge.dev (placeholder)
3. Include reproduction steps and impact assessment
4. Allow 30 days for remediation before public disclosure

## Compliance Notes

- **Not a scanner**: FindingBridge does not perform SAST/SCA scanning
- **Not a code reviewer**: It only processes existing scanner output
- **No compliance reports**: SOC2/ISO27001 reporting is not implemented
