#!/bin/bash
# Kingdom post-commit hook — automatic vault sync after every commit
# Install: ln -sf ../../scripts/post-commit.sh .git/hooks/post-commit
# Runs sync-to-vault --quick silently so commits feel instant.

node scripts/sync-to-vault.js --quick > /dev/null 2>&1 &
