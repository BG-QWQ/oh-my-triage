# SARIF File Support

## Overview

SARIF (Static Analysis Results Interchange Format) is the primary input format for oh-my-triage. Any scanner that produces SARIF 2.1.0 output can be ingested.

## Supported Scanners

| Scanner | SARIF Output | Tested |
|---------|-------------|--------|
| CodeQL | ✅ Native | Yes |
| Semgrep | ✅ Native | Yes |
| Trivy | ✅ Native | Yes |
| GitHub Advanced Security | ✅ Native | Yes |
| SonarQube | Via converter | Planned |
| ESLint | Via `@microsoft/eslint-formatter-sarif` | Yes |

## Ingestion

### CLI

```bash
oh-my-triage ingest --sarif path/to/results.sarif
```

### Programmatic

```typescript
import { SarifAdapter } from 'oh-my-triage/adapters';

const adapter = new SarifAdapter();
const result = await adapter.fetchFindings({ filePath: 'results.sarif' });
```

## Robustness

| Scenario | Behavior |
|-----------|----------|
| Empty SARIF | Returns 0 findings, no error |
| Missing optional fields | Uses safe defaults |
| Missing required fields | Reports skipped results with reason |
| Malformed JSON | Actionable parse error with location |
| Invalid SARIF version | Error with version requirement |
| File > 50MB | Rejected with size limit error |
| Path traversal in URIs | Rejected with security error |

## Severity Mapping

| SARIF Level | Unified Severity |
|-------------|-----------------|
| error (security) | critical |
| error (quality) | high |
| warning | medium |
| note | low |
| none | info |

## Path Handling

SARIF file URIs are normalized:
- `file:///project/src/file.ts` → `src/file.ts`
- `%SRCROOT%/src/file.ts` → `src/file.ts`
- Backslashes converted to forward slashes

## Example SARIF

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "CodeQL",
        "rules": [{
          "id": "js/sql-injection",
          "properties": { "cwe": "CWE-89" }
        }]
      }
    },
    "results": [{
      "ruleId": "js/sql-injection",
      "message": { "text": "SQL injection vulnerability" },
      "locations": [{
        "physicalLocation": {
          "artifactLocation": { "uri": "src/db.ts" },
          "region": { "startLine": 42 }
        }
      }]
    }]
  }]
}
```
