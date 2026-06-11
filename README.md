# FindingBridge 🌉

> Connect your scanners. Let AI explain the noise.

[![npm version](https://img.shields.io/npm/v/findingbridge)](https://www.npmjs.com/package/findingbridge)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=BG-QWQ_FindingBridge&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=BG-QWQ_FindingBridge)
## 🤔 Why FindingBridge?

As a developer, you’ve probably been overwhelmed by security scanner alerts. SonarCloud, GitHub Code Scanning, Semgrep, Trivy — each has its own interface, severity levels, and jargon. FindingBridge connects these scanners and exposes their findings through **MCP (Model Context Protocol)** tools, so your AI assistant can help you understand, prioritize, and fix them.

**Key principles:**
- **Scanner-agnostic**: Not locked to any single scanner
- **Privacy-first**: Data stays local (SQLite by default)
- **MCP-native**: Works with Claude, Cursor, and any MCP client
- **Open source**: Self-hosted, no SaaS lock-in

## ✨ 3-Minute Quick Start

### Method 1: Download & Run (Recommended for beginners)

1. Download the release for your platform from [Releases](https://github.com/yourname/findingbridge/releases)
2. Extract and run `findingbridge` (or `findingbridge.exe` on Windows)
3. Follow the web setup wizard at `http://localhost:3456/setup`
4. Ask Claude: *"What are my most critical security findings?"*

### Method 2: npm (For developers)

```bash
npx findingbridge@latest server
# First run automatically opens the setup wizard
```

### Method 3: Zero-Config Demo

```bash
npx findingbridge@latest server --demo
# Pre-loaded sample findings for instant exploration
```

## 🔌 Supported Scanners

| Scanner | Status | Input |
|---------|--------|-------|
| SARIF files | ✅ | Local file path |
| GitHub Code Scanning | ✅ | Personal Access Token |
| SonarCloud | ✅ | User Token |
| Socket.dev | 🚧 | Planned for v0.2 |
| Snyk | 🚧 | Planned for v0.2 |
| Semgrep | 🚧 | Planned for v0.2 |

## 🛠️ MCP Tools

All tools use the `findingbridge_` prefix:

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `findingbridge_list_findings` | List findings with filters and pagination | ✅ |
| `findingbridge_get_finding_detail` | Get full finding details + code context | ✅ |
| `findingbridge_explain_finding` | Explain a finding in plain language | ✅ |
| `findingbridge_suggest_fix` | Get remediation suggestions | ✅ |
| `findingbridge_prioritize_findings` | Rank findings by business impact | ✅ |
| `findingbridge_deduplicate_findings` | Preview duplicate findings | ✅ |
| `findingbridge_generate_report` | Generate Markdown/HTML report | ✅ |

## 🖥️ CLI Commands

```bash
findingbridge init              # Initialize configuration
findingbridge setup             # Run guided setup wizard
findingbridge setup --cli       # CLI fallback (no browser)
findingbridge ingest --sarif <path>   # Import SARIF file
findingbridge server            # Start MCP server
findingbridge server --demo     # Start with demo data
findingbridge config show       # Show current config
findingbridge config test       # Test scanner connections
findingbridge diagnose          # Generate diagnostic report
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  LLM Agent (Claude / Cursor / Copilot)  │
└─────────────────┬───────────────────────┘
                  │ MCP Protocol (stdio)
┌─────────────────▼───────────────────────┐
│  FindingBridge MCP Server               │
│  - 7 read-only tools                    │
│  - Structured JSON outputs            │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Core Engine                            │
│  - Normalization (severity mapping)     │
│  - Deduplication (fingerprinting)       │
│  - Prioritization (scoring)             │
│  - Reporting (Markdown/HTML)            │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Adapters                               │
│  - SARIF File Reader                    │
│  - GitHub Code Scanning API             │
│  - SonarCloud API                       │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  SQLite (default) / PostgreSQL (opt)    │
└─────────────────────────────────────────┘
```

## 🔒 Privacy & Security

- **Data stays local**: SQLite database in `~/.findingbridge/`
- **Token storage**: System keychain (keytar) with env fallback
- **No source upload**: Only finding metadata + 20-line code snippets
- **Secret redaction**: Automatic redaction in logs and responses
- **Read-only**: No tools modify your repositories

## 📄 Documentation

- [Architecture](docs/architecture.md)
- [MCP Tools](docs/mcp-tools.md)
- [Security](docs/security.md)
- [Scanner Setup](docs/scanners/)
  - [SARIF](docs/scanners/sarif.md)
  - [GitHub Code Scanning](docs/scanners/github-code-scanning.md)
  - [SonarCloud](docs/scanners/sonarcloud.md)

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
