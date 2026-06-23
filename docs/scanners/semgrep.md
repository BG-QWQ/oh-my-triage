# Semgrep

## Setup

### 1. Create Semgrep Token

1. Go to https://semgrep.dev/orgs/-/settings/tokens
2. Generate an API token with the **Web API** scope
3. Copy the token

### 2. Configure oh-my-triage

```bash
oh-my-triage setup
# Select "Semgrep", paste token, and enter the deployment slug
```

Or set directly:

```bash
oh-my-triage config set-token semgrep
```

## Token Validation

oh-my-triage validates your token by:

1. Calling `GET /api/v1/deployments`
2. Confirming the token has the Web API scope
3. Listing deployments visible to the token

## Sync Behavior

Semgrep sources are not auto-inferred from the current GitHub repository. Save the deployment slug in the source options or pass it per sync call.

```json
{
  "id": "semgrep",
  "type": "semgrep",
  "options": {
    "deployment": "your-deployment-slug"
  }
}
```

You can also configure `issue_type` as `"sast"` (default) or `"sca"`.

## Data Retrieved

- Semgrep findings for the configured deployment
- Rule names, messages, file paths, and line numbers
- Severity, status, CWE names, and CVE identifiers when available

## Severity Mapping

| Semgrep | Unified Severity |
|---------|-----------------|
| critical | critical |
| high / ERROR | high |
| medium / WARNING | medium |
| low / INFO | low |

## API Behavior

- Base URL: `https://semgrep.dev`
- Authentication: `Authorization: Bearer <token>`
- Pagination: page-based via `page` and `page_size`
- Default page size: 100 findings

## Troubleshooting

| Error | Solution |
|-------|----------|
| Invalid token | Generate a new Semgrep API token |
| Missing deployment slug | Save `options.deployment` or pass `deployment_slug` |
| 404 on findings | Confirm the token has the **Web API** scope (CLI/CI tokens will not work) |
| No deployments found | Verify the token belongs to the expected Semgrep organization |

## Privacy

- No source code is uploaded
- Only finding metadata is retrieved
- Token is stored in the system keychain
