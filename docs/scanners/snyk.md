# Snyk

## Setup

### 1. Create Snyk Token

1. Go to https://app.snyk.io/account
2. Generate a personal access token or service account token with REST API access
3. Copy the token

### 2. Configure oh-my-triage

```bash
oh-my-triage setup
# Select "Snyk", paste token, and enter the organization ID
```

Or set directly:

```bash
oh-my-triage config set-token snyk
```

## Token Validation

oh-my-triage validates your token by:

1. Calling `GET /rest/orgs?version=2024-10-15`
2. Confirming the token can list organizations
3. Optionally testing issue access when an organization ID is configured

## Sync Behavior

Snyk sources are not auto-inferred from the current GitHub repository. Save the organization ID in the source options or pass it per sync call.

```json
{
  "id": "snyk",
  "type": "snyk",
  "options": {
    "organization": "your-org-id"
  }
}
```

## Data Retrieved

- Snyk issues (vulnerabilities and license issues)
- Issue titles, keys, statuses, and severities
- Package PURL relationships when available

## Severity Mapping

| Snyk | Unified Severity |
|------|-----------------|
| critical | critical |
| high | high |
| medium | medium |
| low | low |

When multiple severity sources are present, oh-my-triage selects the highest severity.

## API Behavior

- Base URL: `https://api.snyk.io/rest`
- Authentication: `Authorization: token <token>` (note: not `Bearer`)
- API version: `2024-10-15`
- Pagination: cursor-based via `links.next` and `starting_after`
- Page size: 100 issues per request

## Regional Endpoints

If your Snyk organization uses a regional endpoint, set `api_url` in the source configuration:

- US-02: `https://api.us.snyk.io`
- EU-01: `https://api.eu.snyk.io`
- AU-01: `https://api.au.snyk.io`

## Troubleshooting

| Error | Solution |
|-------|----------|
| Invalid token | Generate a new Snyk token with REST API access |
| Missing organization ID | Save `options.organization` or pass `org_id` |
| No organizations found | Verify the token is active and belongs to the expected Snyk group |
| 429 rate limit | Reduce sync frequency or use a dedicated service account |

## Privacy

- No source code is uploaded
- Only issue metadata is retrieved
- Token is stored in the system keychain
