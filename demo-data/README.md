# Demo Data

This directory contains sample SARIF data for the `omt server --demo` mode (the legacy `oh-my-triage server --demo` command is not retained).

## sample-findings.sarif

A synthetic SARIF file containing 3 findings across different severity levels:

- **SQL Injection (CWE-89)** - High severity in `src/db.ts:42`
- **Cross-Site Scripting (CWE-79)** - Medium severity in `src/app.ts:23`
- **Hardcoded Credentials (CWE-798)** - Critical severity in `src/config.ts:8`

This file is safe to distribute and contains no real vulnerabilities or secrets.

## Usage

```bash
omt server --demo
```

This will load the demo data into a temporary database and start the MCP server,
allowing you to explore the tools without configuring any real scanners.
