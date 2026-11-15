#!/usr/bin/env bash
# Start the Open TAN board (Next.js dev server) and open it in Chrome.
# Usage: ./start.sh            (port 3210)
#        PORT=4000 ./start.sh  (other port)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3210}"
URL="http://localhost:$PORT"
RUN_DIR=".run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"
mkdir -p "$RUN_DIR"

# Already running? Only if the pid is still OUR next dev server (a stale pid file after a crash or
# reboot may now belong to some other process).
is_next() { ps -o command= -p "$1" 2>/dev/null | grep -q "next"; }
if [[ -f "$PID_FILE" ]]; then
  OLD="$(cat "$PID_FILE")"
  if [[ "$OLD" =~ ^[0-9]+$ ]] && kill -0 "$OLD" 2>/dev/null && is_next "$OLD"; then
    echo "Already running (pid $OLD) at $URL"
    open -a "Google Chrome" "$URL"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
  echo "Port $PORT is busy. Run ./kill.sh or use PORT=<other> ./start.sh"
  exit 1
fi

# First run: install dependencies.
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting dev server on $URL (log: $LOG_FILE)"
# 127.0.0.1 only: the board has no login, so nothing outside this Mac may reach it
nohup npx next dev -H 127.0.0.1 -p "$PORT" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

# Wait up to 90 s for the server to answer.
for _ in $(seq 1 90); do
  if curl -fs -o /dev/null "$URL"; then
    echo "Ready: $URL"
    open -a "Google Chrome" "$URL"
    exit 0
  fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Server exited. Last log lines:"; tail -20 "$LOG_FILE"; rm -f "$PID_FILE"; exit 1
  fi
  sleep 1
done
echo "Server did not answer in 90 s. See $LOG_FILE"
exit 1
