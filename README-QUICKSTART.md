# Quick Start Guide

> **Renamed from FindingBridge.** The old `findingbridge` CLI and `findingbridge_*` MCP tools are not retained. On first run, oh-my-triage migrates any legacy `findingbridge.config.json`, `~/.findingbridge/` data, and `FINDINGBRIDGE_*` environment variables into the new `oh-my-triage.config.json`, `~/.oh-my-triage/`, and `OMT_*` names automatically. After that one-time migration, the legacy names are not consulted.

## 1. Download & Install

Download the latest release for your platform:

- **Windows**: `omt-v0.1.0-win-x64.exe`
- **macOS**: `omt-v0.1.0-macos-arm64` (Apple Silicon) or `-x64` (Intel)
- **Linux**: `omt-v0.1.0-linux-x64`

No Node.js installation required.

## 2. First Run

Double-click the executable (or run in terminal). The setup wizard will automatically open in your browser:

```bash
./omt
# → Opens http://localhost:3456/setup
```

## 3. Configure Scanners

### Option A: SARIF File

1. Select "Import SARIF File"
2. Choose your `.sarif` file
3. Click "Import"

### Option B: GitHub Code Scanning

1. Select "GitHub Code Scanning"
2. Enter your GitHub Personal Access Token
3. Click "Test Connection"
4. Select repositories to monitor

**Required token scopes**: `repo` (or `public_repo`), `security_events`

### Option C: SonarCloud

1. Select "SonarCloud"
2. Enter your SonarCloud User Token
3. Enter your SonarCloud organization key
4. Click "Test Connection"
5. Select projects to monitor

## 4. Generate MCP Config

After configuring scanners, the wizard will:

1. Detect your MCP client (Claude Desktop / Cursor)
2. Generate the correct configuration
3. Backup your existing config
4. Merge the new config (without overwriting other servers)

**Restart your MCP client** after configuration.

## 5. Start Using

Ask your AI assistant:

- "What are my most critical security findings?"
- "Explain finding omt-001 in simple terms"
- "How should I fix the SQL injection issue?"
- "Generate a security report for my team"

## 6. Demo Mode (No Setup)

To try without any configuration:

```bash
./omt server --demo
```

This loads sample findings and starts the MCP server immediately.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Browser doesn't open | Run `omt setup --cli` |
| Token rejected | Check scopes and regenerate token |
| No findings imported | Check SARIF format (must be 2.1.0) |
| Claude can't see tools | Restart Claude Desktop after config |
| Legacy `oh-my-triage` config or env not picked up | The one-time auto-migration only runs on first run. Move `oh-my-triage.config.json` to `oh-my-triage.config.json`, `~/.oh-my-triage/` to `~/.oh-my-triage/`, and `oh-my-triage_*` env vars to `OMT_TOKEN_*` / `OMT_DB_PATH` if your previous install predates v0.1.0. |
