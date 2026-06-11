# SonarCloud

## Setup

### 1. Create SonarCloud Token

1. Go to https://sonarcloud.io/account/security/
2. Click "Generate" under User Tokens
3. Name the token (e.g., "FindingBridge")
4. Copy the token

### 2. Configure FindingBridge

```bash
findingbridge setup
# Select "SonarCloud", paste token, and enter the SonarCloud organization key
```

Or set directly:

```bash
findingbridge config set-token sonarcloud
```

## Token Validation

FindingBridge validates your token by:
1. Calling `/api/authentication/validate`
2. Listing organization projects via `/api/components/search?organization=<org>&qualifiers=TRK`
3. Testing issue access via `/api/issues/search`

Project listing is organization-scoped. If the source configuration does not
include `organization`, MCP agents can pass it per call:

```json
{
  "organizations": {
    "sonarcloud": "your-organization-key"
  }
}
```

## Sync Behavior

SonarCloud cannot be matched reliably from a GitHub remote alone. Default
synchronization can include a SonarCloud source as an inferred current-project
source only when the source has a saved `project_key` or the sync call passes a
matching `project_keys[source_id]` override. Use
`findingbridge_list_source_projects` to discover the project key when it is not
already saved.

## Data Retrieved

- SonarCloud issues
- Issue locations (component, line)
- Rule metadata (severity, description)
- Issue status (open, confirmed, false positive, fixed)

## Severity Mapping

| SonarCloud | Unified Severity |
|------------|-----------------|
| BLOCKER | critical |
| CRITICAL | high |
| MAJOR | medium |
| MINOR | low |
| INFO | info |

## API Behavior

- Pagination: 500 issues per page
- Token: Passed via `Authorization: Bearer <token>`
- Rate limiting: Follows SonarCloud limits

## Troubleshooting

| Error | Solution |
|-------|----------|
| Invalid token | Generate new token in SonarCloud settings |
| Missing organization | Enter the SonarCloud organization key in setup, or pass `organizations[source_id]` to `findingbridge_list_source_projects` |
| No projects found | Check token belongs to the selected organization and has Browse permission |
| Insufficient permissions | Use User Token (not Project Token) |

## Privacy

- No source code is uploaded
- Only issue metadata is retrieved
- Token is stored in system keychain
