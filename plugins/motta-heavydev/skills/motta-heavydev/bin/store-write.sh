#!/usr/bin/env bash
# Publishes files from a store clone to the store's branch.
#
# Several writers (parallel steps of a run) share one clone, so this never
# touches the clone's index, HEAD or working tree: every attempt builds a
# commit on a private index, on top of a freshly fetched branch tip held in a
# private ref, and pushes it. A writer that loses a push race fetches again
# and rebuilds; since writers never publish the same path, rebuilding always
# succeeds.
#
# Usage: store-write.sh <clone-dir> <message> <path>...
#   paths are files relative to <clone-dir>
# Env:   STORE_BRANCH (default main), STORE_WRITE_ATTEMPTS (default 30)
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: store-write.sh <clone-dir> <message> <path>..." >&2
  exit 2
fi
clone=$1
message=$2
shift 2
branch=${STORE_BRANCH:-main}
attempts=${STORE_WRITE_ATTEMPTS:-30}

cd "$clone"
for p in "$@"; do
  [ -f "$p" ] || { echo "store-write: not a file: $p" >&2; exit 2; }
done

# Auto-gc packs refs and would contend for locks with the other writers.
# Store files are published byte-for-byte, whatever the machine's autocrlf.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=gc.auto GIT_CONFIG_VALUE_0=0
export GIT_CONFIG_KEY_1=core.autocrlf GIT_CONFIG_VALUE_1=false

work=$(mktemp -d)
ref="refs/store-write/$$-$RANDOM"
trap 'rm -rf "$work"; git update-ref -d "$ref" 2>/dev/null || true' EXIT

for ((i = 1; i <= attempts; i++)); do
  # Private ref, no FETCH_HEAD, no remote-tracking update: nothing shared to lock.
  if git fetch -q --no-write-fetch-head --refmap= origin "+refs/heads/$branch:$ref" 2>"$work/err"; then
    base=$(git rev-parse "$ref")
  elif grep -q "couldn't find remote ref" "$work/err"; then
    base="" # empty store: this is its first commit
  else
    base=retry
  fi

  if [ "$base" != retry ]; then
    rm -f "$work/index"
    if [ -n "$base" ]; then GIT_INDEX_FILE="$work/index" git read-tree "$base"; fi
    GIT_INDEX_FILE="$work/index" git add -f -- "$@"
    tree=$(GIT_INDEX_FILE="$work/index" git write-tree)

    # An earlier attempt may have pushed and then failed to hear back.
    if [ -n "$base" ] && [ "$tree" = "$(git rev-parse "$base^{tree}")" ]; then
      exit 0
    fi

    if [ -n "$base" ]; then
      commit=$(git commit-tree "$tree" -p "$base" -m "$message")
    else
      commit=$(git commit-tree "$tree" -m "$message")
    fi
    if git push -q origin "$commit:refs/heads/$branch" 2>"$work/err"; then
      exit 0
    fi
  fi

  # Jittered backoff, capped: losing a race is normal with parallel writers.
  cap=$((i < 5 ? i * 2 : 10))
  sleep $(((RANDOM % cap) + 1))
done

echo "store-write: gave up after $attempts attempts: $(cat "$work/err")" >&2
exit 1
