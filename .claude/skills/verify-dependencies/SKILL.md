---
name: verify-dependencies
description: Audit npm dependencies for security vulnerabilities and outdated packages. Checks package.json integrity, known upstream vulns (axios/undici), and major version drift.
---

# verify-dependencies

Audit npm dependencies for vulnerabilities and outdated packages.

## Steps

1. Run `npm audit --json 2>&1` and parse the output:
   - Count vulnerabilities by severity: critical, high, moderate, low
   - List each vulnerable package with: name, severity, path, fix available

2. Run `npm outdated --json 2>&1` and parse:
   - List packages with: current version, wanted version, latest version
   - Flag major version bumps separately

3. Check `package.json` integrity:
   - Verify `engines.node` is set
   - Verify no `file:` or `git:` dependencies (supply chain risk)
   - Verify `optionalDependencies` are truly optional (discord.js, groq-sdk)

4. Report format:
```
## Dependency Audit Report

### Vulnerabilities
- Critical: 0
- High: N (axios via mineflayer — upstream fix pending)
- Moderate: N
- Low: 0

### Outdated Packages
| Package | Current | Wanted | Latest | Type |
|---------|---------|--------|--------|------|
| example | 1.0.0   | 1.0.1  | 2.0.0  | dep  |

### Recommendations
- [actionable items]
```

## Notes
- Known transitive vulns: axios (via mineflayer), undici (via discord.js)
- These are upstream issues — document but don't force-fix
