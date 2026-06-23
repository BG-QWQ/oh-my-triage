# Socket.dev

## Setup

### 1. Create Socket.dev Token

1. Go to your Socket.dev dashboard → Settings → API Tokens
2. Generate an organization API token with `alerts:list` scope
3. Copy the token

### 2. Configure oh-my-triage

```bash
oh-my-triage setup
# Select "Socket.dev", paste token, and enter the organization slug
```

Or set directly:

```bash
oh-my-triage config set-token socket
```

## Token Validation

oh-my-triage validates your token by:

1. Calling `GET /v0/organizations`
2. Confirming the token can list organizations
3. Optionally testing alert access when an organization slug is configured

## Sync Behavior

Socket.dev sources are not auto-inferred from the current GitHub repository. Save the organization slug in the source options or pass it per sync call.

```json
{
  "id": "socket",
  "type": "socket",
  "options": {
    "organization": "your-org-slug"
  }
}
```

## Data Retrieved

- Socket.dev alerts
- Severity, type, artifact, repository, and branch metadata
- CVE and CWE identifiers when available

## Severity Mapping

| Socket.dev | Unified Severity |
|------------|-----------------|
| critical | critical |
| high | high |
| medium / middle | medium |
| low | low |

## API Behavior

- Base URL: `https://api.socket.dev/v0`
- Authentication: `Authorization: Bearer <token>`
- Pagination: cursor-based via `startAfterCursor` and `endCursor`
- Page size: up to 1000 alerts per request

**Important**: An empty `items` array with a non-null `endCursor` does not mean there are no more pages. oh-my-triage continues until `endCursor` is `null`.

## Troubleshooting

| Error | Solution |
|-------|----------|
| Invalid token | Regenerate the token in Socket.dev settings |
| Missing organization slug | Save `options.organization` or pass `org_slug` |
| No organizations found | Verify the token belongs to the expected Socket.dev organization |
| 403/401 | Confirm the token has the `alerts:list` scope |

## Privacy

- No source code is uploaded
- Only alert metadata is retrieved
- Token is stored in the system keychain
