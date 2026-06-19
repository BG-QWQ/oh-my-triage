# oh-my-triage Architecture

## Overview

oh-my-triage is a TypeScript/Node.js application that bridges security scanners and LLM agents through the Model Context Protocol (MCP). The product, CLI binary (`omt`), and MCP tool prefix (`omt_*`) all use the new name. On first run, any legacy `oh-my-triage` config, `~/.oh-my-triage/` data, and `oh-my-triage_*` environment variables are migrated into `oh-my-triage.config.json`, `~/.oh-my-triage/`, and `OMT_TOKEN_*` / `OMT_DB_PATH` automatically.

## Core Components

### 1. MCP Server Layer (`src/mcp-server/`)

- **Transport**: stdio (default) for direct MCP client communication
- **Server**: `McpServer` from `@modelcontextprotocol/sdk`
- **Tools**: 7 read-only tools with `omt_` prefix
- **Prompts**: Triage workflow guidance for LLM agents

### 2. Core Engine (`src/core/`)

**Models** (`models/`):
- `Finding`: Canonical normalized finding with Zod validation
- `Rule`: Scanner rule definitions with fix patterns
- `Report`: Generated report metadata
- `SyncLog`: Ingestion operation tracking

**Normalization** (`normalization/`):
- `severity-mapper.ts`: Maps scanner-native severities to unified 5-level scale
- `field-mapper.ts`: Maps scanner-native fields to canonical Finding fields
- `source-metadata.ts`: Scanner source metadata and display info

**Deduplication** (`deduplication/`):
- `fingerprint.ts`: Multi-layer fingerprint generation (exact, location, semantic, near)
- `matcher.ts`: Preview duplicate groups without database mutation

**Prioritization** (`prioritization/`):
- `prioritizer.ts`: Score-based ranking with context awareness

**Reporting** (`reporting/`):
- `markdown-report.ts`: Markdown report generation
- `report-summary.ts`: Summary statistics calculation

### 3. Adapter Layer (`src/adapters/`)

Each adapter implements `BaseAdapter`:

```typescript
interface BaseAdapter {
  sourceType: string;
  displayName: string;
  testConnection(): Promise<ConnectionTestResult>;
  fetchFindings(options?: FetchOptions): Promise<AdapterFetchResult>;
}
```

**Adapters**:
- **SARIF** (`sarif/`): File-based ingestion with Zod validation
- **GitHub** (`github/`): REST API with pagination and scope validation
- **SonarCloud** (`sonarcloud/`): API with token validation and project discovery

### 4. Data Layer (`src/database/`)

- **SQLite** (default): Zero-config, WAL mode enabled
- **PostgreSQL** (optional): Production environment
- **Schema**: `findings`, `rules`, `sync_logs`, `reports` tables
- **Repositories**: Type-safe CRUD with pagination support

### 5. CLI Layer (`src/cli/`)

Commands (invoked as `omt <command>`):
- `omt init`: Initialize configuration
- `omt ingest`: Import SARIF files
- `omt server`: Start MCP server
- `omt setup`: Guided configuration wizard
- `omt config`: Configuration management
- `omt diagnose`: Diagnostic reporting

### 6. Config Layer (`src/config/`)

- **Validation**: Zod schemas for all config inputs
- **Storage**: cosmiconfig for discovery of `oh-my-triage.config.json`, keytar/env for credentials
- **MCP Client Detection**: Auto-detect Claude Desktop, Cursor, VS Code
- **Config Writer**: Merge with backup, preserve existing servers
- **Legacy Migration**: On first run, copy `oh-my-triage.config.json`, `~/.oh-my-triage/` data, and `oh-my-triage_*` env vars into the canonical oh-my-triage locations; after migration the legacy names are not consulted.

### 7. Web UI (`src/web-ui/`)

- **Static HTML**: Single-page wizard, no runtime dependencies
- **Offline-capable**: No CDN references
- **Responsive**: Mobile-friendly layout
- **API**: REST endpoints for setup operations

## Data Flow

```
Scanner Output
    ↓
Adapter (SARIF/GitHub/Sonar)
    ↓
Zod Validation
    ↓
Normalization (severity/fields/paths)
    ↓
Fingerprint Generation
    ↓
SQLite Storage
    ↓
MCP Tool Query
    ↓
LLM Agent Response
```

## Security Considerations

1. **Data Minimization**: Only finding metadata + 20-line code snippets
2. **Path Traversal**: Rejected in `normalizePath()`
3. **Secret Redaction**: Automatic in logs and MCP responses
4. **Read-Only Tools**: No repository modification
5. **Token Storage**: System keychain by default

## Extensibility

Adding a new scanner adapter:

1. Create `src/adapters/<scanner>/` directory
2. Implement Zod schemas for API responses
3. Implement `BaseAdapter` interface
4. Add severity mapping to `severity-mapper.ts`
5. Add tests with fixtures
6. Register in CLI setup wizard

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 5.7 (Node.js 20+) |
| Build | tsup |
| Testing | Vitest |
| Linting | ESLint + TypeScript ESLint |
| MCP SDK | @modelcontextprotocol/sdk |
| Database | better-sqlite3 |
| Validation | Zod |
| CLI | Commander.js |
| Config | cosmiconfig |
| UI | Static HTML + CSS |
