#!/usr/bin/env bash
# Start/stop the Commerce Platform dev stack (platform :3100, admin :4403, portal :4404).
#
#   ./scripts/commerce.sh start    # all three, background, logs in .commerce-logs/
#   ./scripts/commerce.sh stop
#   ./scripts/commerce.sh status
#
# Prereqs: Postgres.app on :5432 (user $USER, db commerce_db) and Redis on :6379.
# First time: `make setup` (creates DB if missing + runs migrations).
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_DIR=.commerce-logs
PID_DIR=.commerce-pids
APPS=(platform admin portal)
PORTS=(3100 4403 4404)
NAMES=("commerce-platform (API)" "commerce-admin" "commerce-portal")
URLS=("http://localhost:3100/api  ·  docs: http://localhost:3100/api/docs" \
      "http://localhost:4403" "http://localhost:4404")

# nvm: nx needs node >= 20 (repo convention: node 22)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

start() {
  mkdir -p "$LOG_DIR" "$PID_DIR"
  for i in "${!APPS[@]}"; do
    local app="${APPS[$i]}" port="${PORTS[$i]}"
    if lsof -ti ":$port" >/dev/null 2>&1; then
      echo "SKIP  ${NAMES[$i]} — port $port already in use"
      continue
    fi
    nohup npm run "dev:$app" > "$LOG_DIR/$app.log" 2>&1 &
    echo $! > "$PID_DIR/$app.pid"
    echo "START ${NAMES[$i]} (pid $!) → $LOG_DIR/$app.log"
  done
  echo ""
  echo "Waiting for the API to come up..."
  for _ in $(seq 1 60); do
    curl -sf http://localhost:3100/api/integrations >/dev/null 2>&1 && break
    sleep 1
  done
  status
}

stop() {
  for app in "${APPS[@]}"; do
    if [ -f "$PID_DIR/$app.pid" ]; then
      pkill -P "$(cat "$PID_DIR/$app.pid")" 2>/dev/null || true
      kill "$(cat "$PID_DIR/$app.pid")" 2>/dev/null || true
      rm -f "$PID_DIR/$app.pid"
    fi
  done
  # fallback: anything still squatting on our ports
  for port in "${PORTS[@]}"; do
    lsof -ti ":$port" 2>/dev/null | xargs kill 2>/dev/null || true
  done
  echo "stopped"
}

status() {
  for i in "${!APPS[@]}"; do
    if lsof -ti ":${PORTS[$i]}" >/dev/null 2>&1; then
      echo "UP    ${NAMES[$i]}  ${URLS[$i]}"
    else
      echo "DOWN  ${NAMES[$i]}"
    fi
  done
}

case "${1:-}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
