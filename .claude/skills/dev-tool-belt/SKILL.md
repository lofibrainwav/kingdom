---
name: dev-tool-belt
description: Development tools and GitHub operations for Kingdom — tests, Docker, git, GitHub CLI, and runtime support commands.
---

# Dev Tool Belt Skill

Common development and GitHub operations for Kingdom.

## When to Use
- Running the test suite
- Starting/stopping Docker services
- Git operations (status, commit, push)
- GitHub operations (PRs, issues, CI status)
- Checking Node.js dependencies

## Instructions

### Tests
```bash
npm test                                # run all tests
node --test test/blackboard.test.js
```

### Docker
```bash
docker compose up -d         # start configured services
docker compose down          # stop all
docker compose ps            # check status
docker compose logs -f       # follow logs
docker compose up -d redis   # start Redis only
```

### Git
```bash
git status --short           # quick change summary
git add <files>              # stage specific files
git commit -m "emoji P-N: message"
git push origin main         # push to GitHub
git log --oneline -5         # recent commits
git diff --cached --stat     # what's staged
```

### GitHub (gh CLI)
```bash
gh auth status               # verify authentication
gh repo view
gh pr create --title "..." --body "..."
gh issue list
gh run list --limit 5        # CI runs
gh run view <id>             # CI run details
```

### Node
```bash
node --env-file=.env agent/interface/dashboard.js
node --env-file=.env agent/team/pm-agent.js
npm install                  # install dependencies
```
