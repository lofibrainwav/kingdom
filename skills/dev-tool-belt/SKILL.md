---
name: dev-tool-belt
description: Development tools and GitHub operations for the Octiv project — tests, Docker, git, GitHub CLI, and Node.js management.
---

# Dev Tool Belt Skill

Common development and GitHub operations for the Octiv project.

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
node --test test/bot.test.js            # single test file
node --test test/blackboard.test.js
```

### Docker
```bash
docker compose up -d         # start Redis + PaperMC
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
gh repo view octivofficial/mvp
gh pr create --title "..." --body "..."
gh issue list
gh run list --limit 5        # CI runs
gh run view <id>             # CI run details
```

### Node
```bash
node agent/bot.js            # single bot
node agent/team.js           # full team (5 agents)
npm install                  # install dependencies
```
