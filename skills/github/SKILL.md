---
name: github
description: GitHub operations for the Octiv MVP project. Use for creating PRs, managing issues, viewing CI status, and automating Git workflows.
---

# GitHub Skill

Manages GitHub operations for `octivofficial/mvp`.

## When to Use
- Create or review pull requests
- Check CI/CD status
- Manage issues and milestones
- Automate release notes

## Instructions

1. **Authentication**: PAT stored in macOS Keychain. Use `gh auth status` to verify.
2. **Common operations**:
   - View repo: `gh repo view octivofficial/mvp`
   - Create PR: `gh pr create --title "..." --body "..."`
   - List issues: `gh issue list`
   - Check runs: `gh run list`
3. **Commit convention**: `emoji Phase-N: English description`
4. **Push**: Always use `git push origin main` (credentials in Keychain)

## Examples
```bash
# Create PR for a phase completion
gh pr create --title "feat: AC-2 shelter construction" --body "Implements 3x3x3 auto-shelter"

# Check test status
gh run list --limit 5
```
