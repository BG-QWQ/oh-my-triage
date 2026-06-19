# MCP Tools Reference

All tools use the `omt_` prefix. Read-only tools declare
`readOnlyHint: true`.

> **Renamed from FindingBridge.** The legacy `findingbridge_*` MCP tool names are not retained as deprecated aliases. On first run, any legacy `findingbridge` config, `~/.findingbridge/` data, and `FINDINGBRIDGE_*` environment variables are migrated into `oh-my-triage.config.json`, `~/.oh-my-triage/`, and `OMT_TOKEN_*` / `OMT_DB_PATH` automatically. After that one-time migration, the legacy names are not consulted.

`omt_sync_sources` may call scanner APIs and writes scanner findings
to oh-my-triage's local database only; it never modifies user repositories.

## Workspace Confirmation Guardrail

oh-my-triage MCP tools return findings from the configured local database or
from scanner sources synchronized into that database. The MCP server cannot
reliably know the calling agent's current IDE/workspace repository, so agents
must ask the user to confirm the repository or scanner project under review
before relying on findings as applicable to that workspace.

Do not use `file_path`, `rule_id`, or stored scanner project keys as implicit
current-project selectors. When current/latest platform data is requested,
confirm the current repository/project with the user, synchronize the matching
source or sources with `omt_sync_sources`, then read
`omt_summary` or `omt_list_findings`.

## omt_list_findings

List findings with optional filtering and pagination.

### Input Schema

```json
{
  "severity": ["critical", "high", "medium", "low", "info"],
  "tool": ["github", "sonarcloud"],
  "status": ["open", "dismissed", "fixed", "false_positive"],
  "rule_id": "js/sql-injection",
  "file_path": "src/db.ts",
  "limit": 50,
  "offset": 0,
  "sort_by": "priority_score",
  "include_stale": false
}
```

By default, stale or out-of-current-scope findings are excluded. Set
`include_stale: true` only when intentionally reviewing historical findings.

### Filter Semantics

- `rule_id` is an exact scanner rule ID match, such as `js/sql-injection` or
  `python:S3776`; it is not a prefix or fuzzy search.
- `file_path` matches normalized stored finding locations, such as `src/db.ts`
  or `ensemble.py`; it is not a repository name, scanner project key, or
  current-project selector.
- SonarCloud project keys belong in the discovery and synchronization flow. If
  default sync cannot infer a unique exact/normalized current-repository match,
  call `omt_list_source_projects`, choose the matching project key,
  then pass it to `omt_sync_sources.project_keys[source_id]`.
- Empty results with filters mean no stored findings matched those filters. For
  current or latest scanner platform results, synchronize first before
  concluding the scanner platform has no findings.

### Output Schema

```json
{
  "findings": [
    {
      "id": "omt-001",
      "title": "Potential SQL Injection",
      "severity": "high",
      "tool": "github-code-scanning",
      "rule_id": "js/sql-injection",
      "location": "src/db.ts:42",
      "status": "open",
      "priority_score": 85,
      "is_duplicate": false,
      "is_stale": false
    }
  ],
  "total": 128,
  "has_more": true
}
```

## omt_get_finding_detail

Get detailed information about a single finding.

### Input Schema

```json
{
  "finding_id": "omt-001",
  "include_code_context": true,
  "context_lines": 5,
  "include_stale": false
}
```

Exact-ID finding tools exclude stale findings by default. Set
`include_stale: true` only when intentionally reviewing historical findings.

### Output Schema

```json
{
  "id": "omt-001",
  "title": "Potential SQL Injection",
  "severity": "high",
  "tool": "github-code-scanning",
  "rule_id": "js/sql-injection",
  "cwe_id": "CWE-89",
  "location": {
    "file": "src/db.ts",
    "start_line": 42,
    "start_column": 10,
    "end_line": 42,
    "end_column": 55
  },
  "code_context": {
    "before": ["const query = `SELECT * FROM users`;"],
    "highlight": "  const result = await db.query(req.body.search);",
    "after": ["  return result;"]
  }
}
```

**Security Note**: Code context is limited to max 20 lines and secrets are redacted.

## omt_explain_finding

Explain a finding in plain language.

### Input Schema

```json
{
  "finding_id": "omt-001",
  "audience": "beginner",
  "language": "zh-CN",
  "include_stale": false
}
```

### Output Schema

```json
{
  "finding_id": "omt-001",
  "explanation": "This vulnerability allows attackers to inject malicious SQL...",
  "why_it_matters": "Attackers can steal or modify database data...",
  "is_likely_false_positive": false,
  "confidence": 0.92,
  "suggested_next_steps": [
    "1. Verify the vulnerable code path",
    "2. Use parameterized queries",
    "3. Re-run the scanner after fixing"
  ]
}
```

## omt_suggest_fix

Get remediation suggestions.

### Input Schema

```json
{
  "finding_id": "omt-001",
  "approach": "secure"
}
```

### Output Schema

```json
{
  "finding_id": "omt-001",
  "suggestions": [
    {
      "type": "secure",
      "description": "Use parameterized queries instead of string concatenation",
      "code_example": "const result = await db.query('SELECT * FROM users WHERE name = ?', [req.body.search]);",
      "rationale": "Parameterized queries prevent SQL injection by separating code from data",
      "breaking_risk": "low",
      "estimated_effort": "5 minutes"
    }
  ]
}
```

## omt_prioritize_findings

Rank findings by business impact.

### Input Schema

```json
{
  "finding_ids": ["omt-001", "omt-002"],
  "criteria": "combined",
  "context": {
    "is_public_facing": true,
    "handles_sensitive_data": true
  }
}
```

### Output Schema

```json
{
  "prioritized": [
    {
      "finding_id": "omt-001",
      "rank": 1,
      "score": 95,
      "reasoning": "SQL Injection (CWE-89) in public API with sensitive data"
    }
  ],
  "summary": "42 findings total. Prioritize 3 Critical and 8 High."
}
```

## omt_deduplicate_findings

Preview duplicate findings (dry-run by default).

### Input Schema

```json
{
  "scope": {
    "tool": ["github-code-scanning", "semgrep"],
    "include_stale": false
  },
  "dry_run": true
}
```

Deduplication excludes stale findings by default. Set `scope.include_stale` to
`true` only when intentionally previewing historical findings.

### Output Schema

```json
{
  "groups": [
    {
      "group_id": "dup-001",
      "representative_id": "omt-001",
      "findings": ["omt-001", "omt-042"],
      "tools": ["github-code-scanning", "semgrep"],
      "reason": "Same SQL injection at src/db.ts:42",
      "confidence": 0.88
    }
  ],
  "total_findings": 128,
  "unique_after_dedup": 103,
  "reduction_ratio": 1.24
}
```

## omt_generate_report

Generate a security findings report.

### Input Schema

```json
{
  "format": "markdown",
  "scope": {
    "severity": ["critical", "high"],
    "include_stale": false
  },
  "include_recommendations": true,
  "language": "en"
}
```

Reports exclude stale findings by default. Set `scope.include_stale` to `true`
only when intentionally reporting on historical findings.

### Output Schema

```json
{
  "report": {
    "title": "Security Findings Report",
    "content": "# Security Findings Report\n\n...",
    "summary": {
      "total": 128,
      "critical": 3,
      "high": 12,
      "medium": 45,
      "low": 68
    },
    "top_priorities": ["omt-001", "omt-003", "omt-007"]
  }
}
```

## omt_list_source_projects

List scanner projects visible to configured source credentials. Use this before
`omt_sync_sources` when a source, such as SonarCloud, needs a project
key.

### Input Schema

```json
{
  "source_ids": ["sonarcloud"],
  "organizations": {
    "sonarcloud": "your-organization-key"
  },
  "max_pages": 10
}
```

For SonarCloud, project discovery is organization-scoped. Provide
`organizations[source_id]` when the source configuration does not already include
an organization.

### Output Schema

```json
{
  "sources_total": 1,
  "sources_succeeded": 1,
  "results": [
    {
      "source_id": "sonarcloud",
      "status": "success",
      "projects": [
        {
          "key": "org_project",
          "name": "Project Name",
          "qualifier": "TRK",
          "visibility": "private",
          "organization": "your-organization-key"
        }
      ],
      "next_steps": [
        "Choose every project key that matches the current repository, then call omt_sync_sources without source_ids and pass project_keys for every matching source that needs a key."
      ]
    }
  ],
  "repository_modified": false,
  "database_modified": false
}
```

## omt_sync_sources

Synchronize configured scanner sources into the local oh-my-triage database.
Call this before reading current scanner platform results with
`omt_summary` or `omt_list_findings`.

### Input Schema

```json
{
  "source_ids": ["sonarcloud"],
  "project_keys": {
    "sonarcloud": "org_project"
  },
  "all_sources": false,
  "max_pages": 20
}
```

When synchronizing all scanner data for the confirmed current workspace
repository, omit `source_ids`. Omitted `source_ids` tells oh-my-triage to sync
all inferred current-project sources: GitHub sources whose configured
owner/repository matches the local `origin` remote, plus SonarCloud sources with
a saved `project_key`, a per-call `project_keys[source_id]` override, or a
single exact/normalized SonarCloud project match for the current GitHub
owner/repository. SARIF path sources are not inferred from the current
repository; select them explicitly with `source_ids`, make them the only enabled
source, or pass `all_sources: true`.

Pass `all_sources: true` only when you intentionally want to synchronize every
enabled configured source, including sources that are not inferable as the
current project.

For SonarCloud sources without a saved `project_key`, default sync discovers
projects in the configured organization and auto-selects only one unique
exact/normalized match, such as `owner_repo`, `owner-repo`, or a project name
equal to the repository name. Ambiguous matches, missing matches, missing
organization/token, truncated project discovery, or discovery failures are
returned as skipped source results with next steps; oh-my-triage does not fuzzy
auto-sync those projects. In those cases, rerun with a higher `max_pages` value
or call `omt_list_source_projects`, have the user confirm every
matching key, then rerun `omt_sync_sources` without `source_ids` and
pass a complete `project_keys` map for each source that needs a key. Inferred and
per-call project keys are not persisted.

### Output Fields

Each source result includes stale-isolation audit fields:

```json
{
  "source_id": "sonarcloud",
  "status": "success",
  "findings_found": 12,
  "findings_imported": 12,
  "findings_stale_marked": 3,
  "stale_isolation_applied": true,
  "pages_fetched": 1
}
```

`stale_isolation_applied` is false when synchronization fails or stops before
the scanner result set is complete, such as when `max_pages` is too low. In
that case existing findings remain visible until a complete sync establishes
the current scope.

## Error Handling

All tools return structured errors:

```json
{
  "error": {
    "code": "MCP_INVALID_INPUT",
    "message": "Invalid finding_id format",
    "next_steps": [
      "Use a valid finding ID (e.g., omt-001)",
      "Run omt_list_findings to see available IDs"
    ],
    "retryable": false
  }
}
```

## Annotations

Read-only tools declare:
- `readOnlyHint: true` — The tool does not modify data
- `destructiveHint: false` — The tool performs no destructive operations

`omt_sync_sources` declares `readOnlyHint: false` because it writes
scanner findings to oh-my-triage's local database, while still declaring
`destructiveHint: false` because it does not modify user repositories or delete
scanner data.

## Pagination

`omt_list_findings` supports:
- `limit`: Max results per page (default 50, max 200)
- `offset`: Skip N results
- `has_more`: Boolean indicating more results available
- `total`: Total count for query
