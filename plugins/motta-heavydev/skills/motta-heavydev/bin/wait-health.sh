#!/usr/bin/env bash
# Waits until a health command succeeds, or gives up.
# Usage: wait-health.sh <timeout-seconds> <command> [args...]
#   e.g. wait-health.sh 180 curl -sf http://localhost:4111/health
set -uo pipefail

if [ $# -lt 2 ]; then
  echo "usage: wait-health.sh <timeout-seconds> <command> [args...]" >&2
  exit 2
fi
timeout=$1
shift
start=$SECONDS
until "$@" >/dev/null 2>&1; do
  if [ $((SECONDS - start)) -ge "$timeout" ]; then
    echo "wait-health: not healthy after ${timeout}s: $*" >&2
    exit 1
  fi
  sleep 2
done
echo "healthy after $((SECONDS - start))s"
