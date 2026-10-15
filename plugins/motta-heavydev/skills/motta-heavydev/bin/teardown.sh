#!/usr/bin/env bash
# Stops whatever listens on a port, with its whole process tree, and verifies
# the port is free. Stopping only the shell that launched a dev server leaves
# its children running, on Windows especially.
# Usage: teardown.sh <port>
set -uo pipefail

if [ $# -ne 1 ]; then
  echo "usage: teardown.sh <port>" >&2
  exit 2
fi
port=$1

pids() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      netstat -ano | awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" { print $5 }' | sort -u
      ;;
    *)
      lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | sort -u
      ;;
  esac
}

for pid in $(pids); do
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) taskkill //PID "$pid" //T //F >/dev/null 2>&1 ;;
    *)
      pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
      kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
      ;;
  esac
done

for _ in $(seq 1 15); do
  [ -z "$(pids)" ] && { echo "port $port free"; exit 0; }
  sleep 1
done
for pid in $(pids); do kill -KILL "$pid" 2>/dev/null; done
sleep 1
if [ -n "$(pids)" ]; then
  echo "teardown: port $port still in use by: $(pids | tr '\n' ' ')" >&2
  exit 1
fi
echo "port $port free"
