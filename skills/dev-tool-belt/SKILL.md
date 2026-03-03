---
name: dev-tool-belt
description: Development tools for the Octiv project — running tests, linting, git operations, and Docker management.
---

# Dev Tool Belt Skill

Common development operations for the Octiv project.

## When to Use
- Running the test suite
- Starting/stopping Docker services
- Git operations (status, commit, push)
- Checking Node.js dependencies

## Instructions

### Tests
```bash
npm test                    # run all tests
node --test test/bot.test.js         # single test file
node --test test/blackboard.test.js
```

### Docker
```bash
docker compose up -d        # start Redis + PaperMC
docker compose down         # stop all
docker compose ps           # check status
docker compose logs -f      # follow logs
```

### Git
```bash
git status                  # check changes
git add <files>             # stage specific files
git commit -m "emoji P-N: message"
git push origin main        # push to GitHub
```

### Node
```bash
node agent/bot.js           # single bot
node agent/team.js          # full team (5 agents)
npm install                 # install dependencies
```
