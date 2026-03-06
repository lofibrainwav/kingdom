---
name: verify-dependencies
description: Use when dependencies change, security advisories appear, or release hygiene requires an audit of npm vulnerabilities, outdated packages, and package manifest integrity.
---

# verify-dependencies

Audit npm dependencies for vulnerabilities and outdated packages.

## When to Use

- After changing `package.json` or `package-lock.json`
- When GitHub or npm reports a dependency vulnerability
- Before a release or production deployment
- When major version drift may be increasing maintenance risk

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

## Implementation

1. Run `npm audit` and capture severity plus fixability.
2. Run `npm outdated` and separate patch/minor drift from major-version drift.
3. Review `package.json` for risky dependency sources and missing engine constraints.
4. Report actionable changes first and upstream-only issues second.
