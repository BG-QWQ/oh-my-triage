## Code Style

**TSDoc is enforced.** Every exported function, class, and interface must have a `/** */` doc comment. Use the standard TSDoc/Typedoc sections:

- **First line** — imperative summary ("Connect to upstream", not "Connects to upstream")
- **Body** — explain _why_, not _what_. Design decisions, edge cases, non-obvious behavior
- **`@param`** — only when param names + types aren't self-documenting
- **`@returns`** — only when the return type needs clarification beyond the signature
- **`@throws`** — required if the function can throw. List failure modes and error types

Skip sections that would just repeat what the signature already says. No `@param`/`@return` Javadoc style.

**TypeScript specific rules**:
- Prefer `type` over `interface` for simple data shapes; use `interface` for extensible contracts
- Strict null checks must pass (`strictNullChecks: true`)
- No `as any` or `@ts-ignore` suppressions
- Use Zod for all external data validation (MCP tool inputs, API responses)
- Prefer async/await over raw Promise chains
- Use `unknown` as the default catch variable type, never `any`

## Commit Message Policy

All commits must use a multi-line message (subject + body).

- **Subject line**: concise imperative summary (prefer conventional prefixes like `fix:`, `feat:`, `docs:`)
- **Body**: explain why the change exists and any non-obvious context
- **Reference**: include a tracker link when available, such as `Fixes #58`, `Refs #84`, or `PR #85`. For bootstrap work before issues exist, use `Refs: initial project setup`.

Example:

```text
fix: sanitize anyOf/oneOf branches before merge

Prevent forbidden schema keys from leaking back during branch selection.
Fixes #58 (private)
```

## File Editing & Worktree Policy

- Before editing any file, ask the user for permission and explain why the edit is needed.
- Never edit the main repo working tree directly for meaningful changes.
- Use a git worktree for important edits.
- Use `tmp/` (or equivalent temporary paths) for disposable/scratch changes.

---

## Project Mission & Non-goals

**Mission**: oh-my-triage is an open-source, self-hosted, privacy-first MCP-based triage layer for existing code/security scanner findings.

> **Renamed from FindingBridge.** The product, CLI binary (`oh-my-triage`), MCP tool prefix (`omt_*`), config file (`oh-my-triage.config.json`), per-user data directory (`~/.oh-my-triage/`), and environment variables (`OMT_TOKEN_*`, `OMT_DB_PATH`) all use the new name. The legacy `findingbridge` CLI and `findingbridge_*` MCP tools are not retained as deprecated aliases. On first run, the legacy config file, `~/.findingbridge/` data, and `FINDINGBRIDGE_*` env vars are migrated into the new names automatically; after that one-time migration the legacy names are not consulted.

**It does:**
- Ingest scanner results from multiple sources (SARIF, GitHub Code Scanning, SonarCloud, Socket.dev, etc.)
- Normalize and deduplicate findings into a unified data model
- Expose structured findings through MCP tools for LLM agents
- Help LLM agents explain, prioritize, and suggest remediation in natural language

**It does NOT:**
- Scan source code itself (we are not a SAST/SCA scanner)
- Act as a generic AI PR reviewer (we only process existing scanner output)
- Automatically modify code, open PRs, or apply patches
- Upload full source code to external LLM services
- Store secrets or tokens in plaintext without explicit opt-in and warning

---

## MCP Tool Design Rules

- All MCP tools must use the `omt_` prefix (oh-my-triage).
- Tool inputs must be validated with Zod.
- Tool outputs must be structured JSON whenever possible; avoid raw Markdown in tool returns.
- Tools that only read data must declare read-only semantics (e.g., `readOnlyHint: true`).
- MVP tools must not modify user repositories, open PRs, or apply patches.
- Error messages must be actionable and include next steps (e.g., "Token invalid. Run `oh-my-triage config set-token github` to update.").
- Tools must support pagination for large finding sets.
- Never return full source files; only minimal code context around a finding.
- The agent skill file is `src/skills/oh-my-triage-skill.md` (formerly `src/skills/findingbridge-skill.md`).

---

## Security & Privacy Rules

- Never log API tokens, secrets, authorization headers, or full credential values.
- Redact secrets as `***REDACTED***` in logs, diagnostics, reports, and MCP responses.
- Never send full source files to LLMs.
- Return only minimal code context around a finding (max 20 lines by default).
- Store credentials in the system keychain by default.
- Plaintext credential storage is allowed only for explicit development mode and must show a warning.
- All scanner API responses must be validated before use; treat SARIF and imported files as untrusted input.
- Use `unknown` for catch variables and never suppress type errors with `as any` or `@ts-ignore`.

---

## Beginner UX Rules

- Releases must be usable without installing Node.js. Prefer a single-file executable, but platform-specific zip/app bundles are acceptable if native dependencies require it.
- The primary beginner flow is: download release → run executable (`oh-my-triage`) → **local Web Setup Wizard opens in browser** → guided configuration → generate MCP config.
- CLI terminal wizard (`oh-my-triage setup --cli`) must be available as fallback for headless environments.
- Do not require beginners to hand-write YAML, JSON, or command-line flags for the first successful setup.
- If configuration fails, show a clear reason, suggested fix, and retry option.
- Demo mode (`oh-my-triage server --demo`) is optional and must not replace the real guided setup flow.
- MCP config must be merged into existing client configs without overwriting other servers.
- Back up existing MCP config files before writing.

---

## Scanner Adapter Rules

Every scanner adapter must:
- Expose a stable adapter interface (e.g., `BaseAdapter`).
- Normalize findings into the shared `Finding` model.
- Preserve original scanner metadata in `raw_data`.
- Map scanner-native severity into the unified severity scale (`critical` | `high` | `medium` | `low` | `info`).
- Implement connection testing with actionable permission errors.
- Never assume API responses are trusted; validate all external data with Zod.

---

## Testing & Quality Gates

- Every adapter must have unit tests with fixture responses (mocked API/SARIF data).
- Every MCP tool must have input validation tests (valid, invalid, edge cases).
- SARIF parsing must be tested with valid, malformed, huge, and partially missing fields.
- Severity mapping must be tested against all supported scanner native levels.
- Run typecheck (`tsc --noEmit`), lint, and tests before every release.
- Release builds must be smoke-tested on Windows, macOS, and Linux (CI matrix).
- MCP tools must be tested with MCP Inspector before release.
- Native dependencies (`better-sqlite3`, `keytar`) must be tested in packaged builds, not just dev.

---

## Release Rules

- Releases must include Windows, macOS, and Linux artifacts.
- Every release must include SHA256 checksums.
- Release artifacts must start the guided setup flow (Web UI) on first run.
- Release packages must include README-QUICKSTART.md.
- Release builds must not require users to install Node.js.
- Existing MCP client configs must be backed up before modification.
- Native dependencies must be verified in packaged builds before tagging release.
- Web UI static assets must work without external CDN references (offline-capable).
