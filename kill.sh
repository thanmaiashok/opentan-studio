#!/usr/bin/env bash
# Stop the Open TAN board started by ./start.sh.
# Usage: ./kill.sh            (port 3210)
#        PORT=4000 ./kill.sh  (other port)
set -uo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3210}"
PID_FILE=".run/dev.pid"

# Only ever stop OUR server: a pid or listener whose command line is `next …` / `npm exec next …` / next-server.
# A stale pid file (the pid now belongs to something else) is dropped, never killed.
is_next() { ps -o command= -p "$1" 2>/dev/null | grep -q "next"; }

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null && is_next "$PID"; then
    pkill -TERM -P "$PID" 2>/dev/null   # child processes (next-server)
    kill -TERM "$PID" 2>/dev/null
    echo "Stopped pid $PID"
  elif [[ -n "$PID" ]]; then
    echo "Stale pid file ($PID is not our next dev server) — removed"
  fi
  rm -f "$PID_FILE"
fi

# Anything of ours still listening on the port (a listener that is not next is left alone).
ours() {
  local p out=""
  for p in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    is_next "$p" && out="$out $p"
  done
  echo "$out"
}
PIDS="$(ours)"
if [[ -n "${PIDS// /}" ]]; then
  kill -TERM $PIDS 2>/dev/null
  sleep 1
  PIDS="$(ours)"
  [[ -n "${PIDS// /}" ]] && kill -KILL $PIDS 2>/dev/null
  echo "Freed port $PORT"
fi
OTHER=""
for p in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do is_next "$p" || OTHER="$OTHER $p"; done
[[ -n "$OTHER" ]] && echo "Port $PORT is held by something else (pid$OTHER) — not ours, left running"
echo "Done."
