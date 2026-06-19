# Contributing to oh-my-triage

Thank you for your interest in contributing!

> **Renamed from FindingBridge.** All references to the old product, CLI (`findingbridge`), and MCP tool prefix (`findingbridge_*`) have been replaced with `oh-my-triage` / `omt_*`. Legacy config and env data is auto-migrated on first run; the legacy CLI and MCP tool names are not retained as deprecated aliases.

## Development Setup

```bash
git clone https://github.com/BG-QWQ/oh-my-triage.git
cd oh-my-triage
npm install
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Build in watch mode |
| `npm run build` | Production build |
| `npm run test` | Run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## Code Style

- TSDoc for all exported functions
- `type` for simple shapes, `interface` for contracts
- Strict null checks enabled
- No `as any` or `@ts-ignore`
- Zod for external validation
- `unknown` for catch variables

## Adding a Scanner Adapter

1. Create `src/adapters/<scanner>/` directory
2. Add Zod schemas for API responses
3. Implement `BaseAdapter` interface
4. Add severity mapping to `severity-mapper.ts`
5. Add tests with fixtures in `tests/fixtures/<scanner>/`
6. Update documentation

## Testing

- All adapters must have unit tests with mocked responses
- All MCP tools must have input validation tests
- SARIF parsing must test valid, malformed, huge, and missing-field cases
- Severity mapping must test all native scanner levels

## Commit Messages

Use multi-line format:

```
feat: add Socket.dev adapter

Implement Socket.dev API client with project/package search.
Supports npm and PyPI package vulnerability lookup.

Refs: #42
```

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
