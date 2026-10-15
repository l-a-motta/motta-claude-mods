#!/usr/bin/env bash
# Hammers store-write.sh with parallel writers against a local bare remote.
# Usage: test-store-write.sh   (exit 0 = every check passed)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
write="$here/store-write.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

git init -q --bare -b main "$tmp/remote.git"

# 1. Empty store: the first write creates the branch.
git clone -q "$tmp/remote.git" "$tmp/first" 2>/dev/null
echo seed >"$tmp/first/README.md"
"$write" "$tmp/first" "seed" README.md || fail "first write to an empty store"
echo "ok   first write to an empty store"

# 2. Parallel writers: 3 sharing clone A, 2 sharing clone B, 10 files each.
git clone -q "$tmp/remote.git" "$tmp/a"
git clone -q "$tmp/remote.git" "$tmp/b"
writer() { # <clone> <writer-id>
  for n in $(seq 1 10); do
    mkdir -p "$1/runs/w$2"
    echo "writer $2 file $n" >"$1/runs/w$2/step-$n.json"
    "$write" "$1" "w$2 step $n" "runs/w$2/step-$n.json" || return 1
  done
}
pids=()
for w in 1 2 3; do writer "$tmp/a" "$w" & pids+=($!); done
for w in 4 5; do writer "$tmp/b" "$w" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || fail "a writer gave up"; done

git clone -q "$tmp/remote.git" "$tmp/check"
files=$(find "$tmp/check/runs" -name '*.json' | wc -l)
commits=$(git -C "$tmp/check" rev-list --count HEAD)
[ "$files" -eq 50 ] || fail "expected 50 files on the remote, found $files"
[ "$commits" -eq 51 ] || fail "expected 51 commits, found $commits"
echo "ok   5 parallel writers in 2 clones: 50 files, 51 commits, none lost"

# 3. The writers left their clones untouched.
[ -z "$(git -C "$tmp/a" diff --cached --name-only)" ] || fail "clone A index was modified"
[ "$(git -C "$tmp/a" rev-list --count HEAD)" -eq 1 ] || fail "clone A HEAD moved"
echo "ok   shared clones' index and HEAD untouched"

# 4. Re-publishing unchanged content is a no-op.
"$write" "$tmp/a" "again" runs/w1/step-1.json || fail "re-publish"
git -C "$tmp/check" pull -q
[ "$(git -C "$tmp/check" rev-list --count HEAD)" -eq 51 ] || fail "re-publish made a commit"
echo "ok   re-publishing unchanged content makes no commit"

echo "PASS"
