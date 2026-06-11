# GitHub Code Scanning

## Setup

### 1. Create GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (or `public_repo` for public repos only)
   - `security_events`
4. Generate and copy token

### 2. Configure FindingBridge

```bash
findingbridge setup
# Select "GitHub Code Scanning", paste token, test the connection,
# then choose the repository owner and repository from the discovered list.
```

For headless systems, the CLI fallback prompts for the same repository coordinates:

```bash
findingbridge setup --cli
# Enter the GitHub token, repository owner or organization, and repository name.
```

Or set directly:

```bash
findingbridge config set-token github
```

## Token Permissions

FindingBridge validates your token has required permissions:

| Check | Required Scope |
|-------|--------------|
| Read repos | `repo` or `public_repo` |
| Read alerts | `security_events` |

If permissions are missing, the setup wizard shows:
- Exact missing scopes
- Link to token settings
- Option to retry or skip

## Data Retrieved

- Code scanning alerts
- Repository metadata needed to populate setup owner/repository selectors
- Alert locations (file, line, column)
- Rule metadata (severity, description, CWE)
- Alert state (open, dismissed, fixed)

## API Behavior

- Pagination: 100 alerts per page
- Rate limiting: Follows GitHub API limits
- Error handling: 401/403/404/429 with actionable messages

## Scope Validation

The adapter checks `X-OAuth-Scopes` header when available to verify:
- `repo` or `public_repo` present
- `security_events` present

## Troubleshooting

| Error | Solution |
|-------|----------|
| 401 Unauthorized | Token expired or invalid — regenerate |
| 403 Forbidden | Missing `security_events` scope — update token |
| 404 Not Found | Repository not found or no access — check repo name |
| 429 Rate Limited | Wait 1 hour or use token with higher rate limit |

## Privacy

- No source code is uploaded
- Only alert metadata is retrieved
- Token is stored in system keychain
