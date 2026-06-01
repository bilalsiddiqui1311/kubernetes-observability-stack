#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/logs"
ACTION="${1:-start}"
SESSION_PREFIX="local-platform"

mkdir -p "$PID_DIR" "$LOG_DIR"

APP_PORT="${APP_PORT:-8080}"
GRAFANA_PORT="${GRAFANA_PORT:-3000}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
KIBANA_PORT="${KIBANA_PORT:-5601}"
TEMPO_PORT="${TEMPO_PORT:-3200}"
ELASTICSEARCH_PORT="${ELASTICSEARCH_PORT:-9200}"

screen_running() {
  local session="$1"
  { screen -list 2>/dev/null || true; } | grep "[.]$session" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

start_forward() {
  local name="$1"
  local namespace="$2"
  local service="$3"
  local local_port="$4"
  local remote_port="$5"
  local session="$SESSION_PREFIX-$name"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name-port-forward.log"

  if ! command -v screen >/dev/null 2>&1; then
    echo "screen is required to keep local port-forwards alive after this script exits."
    return 1
  fi

  if screen_running "$session"; then
    if port_in_use "$local_port"; then
      echo "$name is already exposed on localhost:$local_port."
      return
    fi
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    echo "Restarting stale $name port-forward."
  fi

  if port_in_use "$local_port"; then
    local upper_name
    upper_name="$(printf '%s' "$name" | tr '[:lower:]-' '[:upper:]_')"
    echo "Port $local_port is already in use. Set ${upper_name}_PORT to choose another port."
    return 1
  fi

  rm -f "$pid_file"
  : >"$log_file"
  screen -dmS "$session" env \
    LOG_FILE="$log_file" \
    NAMESPACE="$namespace" \
    SERVICE="$service" \
    LOCAL_PORT="$local_port" \
    REMOTE_PORT="$remote_port" \
    bash -lc 'exec kubectl -n "$NAMESPACE" port-forward "svc/$SERVICE" "$LOCAL_PORT:$REMOTE_PORT" >"$LOG_FILE" 2>&1'

  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if port_in_use "$local_port"; then
      echo "$name -> http://localhost:$local_port"
      return
    fi
    sleep 0.5
  done

  if ! screen_running "$session"; then
    echo "Failed to expose $name. See $log_file"
    return 1
  fi

  echo "Timed out waiting for $name on localhost:$local_port. See $log_file"
  return 1
}

stop_forward() {
  local name="$1"
  local session="$SESSION_PREFIX-$name"
  local pid_file="$PID_DIR/$name.pid"
  if screen_running "$session"; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    echo "Stopped $name."
  fi
  rm -f "$pid_file"
}

status_forward() {
  local name="$1"
  local port="$2"
  local session="$SESSION_PREFIX-$name"
  if screen_running "$session" && port_in_use "$port"; then
    echo "$name running in screen session $session."
  elif screen_running "$session"; then
    echo "$name has a stale screen session but localhost:$port is not listening."
  else
    echo "$name not running."
  fi
}

case "$ACTION" in
  start)
    start_forward app local-app gateway "$APP_PORT" 80
    start_forward grafana observability grafana "$GRAFANA_PORT" 3000
    start_forward prometheus observability prometheus "$PROMETHEUS_PORT" 9090
    start_forward kibana observability kibana "$KIBANA_PORT" 5601
    start_forward tempo observability tempo "$TEMPO_PORT" 3200
    start_forward elasticsearch observability elasticsearch "$ELASTICSEARCH_PORT" 9200
    ;;
  stop)
    for name in app grafana prometheus kibana tempo elasticsearch; do
      stop_forward "$name"
    done
    ;;
  status)
    status_forward app "$APP_PORT"
    status_forward grafana "$GRAFANA_PORT"
    status_forward prometheus "$PROMETHEUS_PORT"
    status_forward kibana "$KIBANA_PORT"
    status_forward tempo "$TEMPO_PORT"
    status_forward elasticsearch "$ELASTICSEARCH_PORT"
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
