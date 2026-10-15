#!/usr/bin/env bash
# Brings a store clone's HEAD and index up to the published branch.
#
# store-write.sh publishes without moving the clone's HEAD, so after a workflow
# the clone holds the published files as untracked and `git pull` refuses.
# Run this only between workflows, when no writer is active: it moves HEAD and
# the index to the remote tip and leaves the working tree alone, so files the
# writers produced match what was published and the clone reads as clean.
#
# Usage: store-sync.sh <clone-dir>
# Env:   STORE_BRANCH (default main)
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: store-sync.sh <clone-dir>" >&2
  exit 2
fi
branch=${STORE_BRANCH:-main}
cd "$1"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false

git fetch -q origin "$branch"
git reset -q "origin/$branch"
# Files published by another machine are not on disk yet.
git checkout -q -- .
if [ -n "$(git status --porcelain)" ]; then
  echo "store-sync: the clone differs from the published store:" >&2
  git status --short >&2
  exit 1
fi
