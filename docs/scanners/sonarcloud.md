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
# Select "SonarCloud" and paste token
```

Or set directly:

```bash
findingbridge config set-token sonarcloud
```

## Token Validation

FindingBridge validates your token by:
1. Calling `/api/authentication/validate`
2. Listing projects via `/api/projects/search`
3. Testing issue access via `/api/issues/search`

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
| No projects found | Check token belongs to correct organization |
| Insufficient permissions | Use User Token (not Project Token) |

## Privacy

- No source code is uploaded
- Only issue metadata is retrieved
- Token is stored in system keychain
