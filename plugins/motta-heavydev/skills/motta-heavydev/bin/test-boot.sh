#!/usr/bin/env bash
# Starts a throwaway HTTP server the way the flow starts a system under test,
# then checks wait-health.sh sees it and teardown.sh frees the port.
# Usage: test-boot.sh   (exit 0 = every check passed)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
port=${TEST_PORT:-47613}
fail() { echo "FAIL: $*" >&2; exit 1; }

node -e "require('http').createServer((q,s)=>s.end(q.url==='/health'?'ok':'hi')).listen($port)" &
"$here/wait-health.sh" 20 curl -sf "http://localhost:$port/health" || fail "server never became healthy"
echo "ok   wait-health sees a started server"

"$here/teardown.sh" "$port" || fail "teardown did not free the port"
curl -sf "http://localhost:$port/health" >/dev/null 2>&1 && fail "server still answers after teardown"
echo "ok   teardown frees the port and the server is gone"

"$here/wait-health.sh" 3 curl -sf "http://localhost:$port/health" 2>/dev/null && fail "wait-health passed with nothing running"
echo "ok   wait-health gives up when nothing answers"
echo "PASS"
