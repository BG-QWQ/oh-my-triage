# SonarCloud

## Setup

### 1. Create SonarCloud Token

1. Go to https://sonarcloud.io/account/security/
2. Click "Generate" under User Tokens
3. Name the token (e.g., "oh-my-triage")
4. Copy the token

### 2. Configure oh-my-triage

```bash
omt setup
# Select "SonarCloud", paste token, and enter the SonarCloud organization key
```

Or set directly:

```bash
omt config set-token sonarcloud
```

## Token Validation

oh-my-triage validates your token by:
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

Default synchronization can include a SonarCloud source as an inferred
current-project source when the source has a saved `project_key`, the sync call
passes a matching `project_keys[source_id]` override, or project discovery finds
exactly one safe match for the current GitHub owner/repository. Safe automatic
matches are exact or normalized forms such as `owner_repo`, `owner-repo`, or a
SonarCloud project name equal to the repository name.

oh-my-triage does not fuzzy auto-sync ambiguous SonarCloud projects. If a source
has no saved `project_key` and discovery finds no match, multiple matches, no
organization/token, truncated project discovery, or a permissions error, default
sync returns a skipped result with next steps and still synchronizes other
inferable sources. Rerun with a higher `max_pages` value or use
`omt_list_source_projects` to inspect candidates, have the user confirm
the matching key, then rerun `omt_sync_sources` without `source_ids`
and pass `project_keys[source_id]`. Inferred and per-call project keys are not
persisted.

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
| Missing organization | Enter the SonarCloud organization key in setup, or pass `organizations[source_id]` to `omt_list_source_projects` |
| No projects found | Check token belongs to the selected organization and has Browse permission |
| Insufficient permissions | Use User Token (not Project Token) |

## Privacy

- No source code is uploaded
- Only issue metadata is retrieved
- Token is stored in system keychain
