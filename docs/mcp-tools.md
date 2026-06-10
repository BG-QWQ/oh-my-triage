# MCP Tools Reference

All tools use the `findingbridge_` prefix and are read-only (`readOnlyHint: true`).

## findingbridge_list_findings

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
  "sort_by": "priority_score"
}
```

### Output Schema

```json
{
  "findings": [
    {
      "id": "fb-001",
      "title": "Potential SQL Injection",
      "severity": "high",
      "tool": "github-code-scanning",
      "rule_id": "js/sql-injection",
      "location": "src/db.ts:42",
      "status": "open",
      "priority_score": 85,
      "is_duplicate": false
    }
  ],
  "total": 128,
  "has_more": true
}
```

## findingbridge_get_finding_detail

Get detailed information about a single finding.

### Input Schema

```json
{
  "finding_id": "fb-001",
  "include_code_context": true,
  "context_lines": 5
}
```

### Output Schema

```json
{
  "id": "fb-001",
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

## findingbridge_explain_finding

Explain a finding in plain language.

### Input Schema

```json
{
  "finding_id": "fb-001",
  "audience": "beginner",
  "language": "zh-CN"
}
```

### Output Schema

```json
{
  "finding_id": "fb-001",
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

## findingbridge_suggest_fix

Get remediation suggestions.

### Input Schema

```json
{
  "finding_id": "fb-001",
  "approach": "secure"
}
```

### Output Schema

```json
{
  "finding_id": "fb-001",
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

## findingbridge_prioritize_findings

Rank findings by business impact.

### Input Schema

```json
{
  "finding_ids": ["fb-001", "fb-002"],
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
      "finding_id": "fb-001",
      "rank": 1,
      "score": 95,
      "reasoning": "SQL Injection (CWE-89) in public API with sensitive data"
    }
  ],
  "summary": "42 findings total. Prioritize 3 Critical and 8 High."
}
```

## findingbridge_deduplicate_findings

Preview duplicate findings (dry-run by default).

### Input Schema

```json
{
  "scope": "cross_tool",
  "dry_run": true
}
```

### Output Schema

```json
{
  "groups": [
    {
      "group_id": "dup-001",
      "representative_id": "fb-001",
      "findings": ["fb-001", "fb-042"],
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

## findingbridge_generate_report

Generate a security findings report.

### Input Schema

```json
{
  "format": "markdown",
  "scope": "all",
  "include_recommendations": true,
  "language": "en"
}
```

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
    "top_priorities": ["fb-001", "fb-003", "fb-007"]
  }
}
```

## Error Handling

All tools return structured errors:

```json
{
  "error": {
    "code": "MCP_INVALID_INPUT",
    "message": "Invalid finding_id format",
    "next_steps": [
      "Use a valid finding ID (e.g., fb-001)",
      "Run findingbridge_list_findings to see available IDs"
    ],
    "retryable": false
  }
}
```

## Annotations

All tools declare:
- `readOnlyHint: true` — Tools do not modify data
- `destructiveHint: false` — No destructive operations

## Pagination

`findingbridge_list_findings` supports:
- `limit`: Max results per page (default 50, max 200)
- `offset`: Skip N results
- `has_more`: Boolean indicating more results available
- `total`: Total count for query
