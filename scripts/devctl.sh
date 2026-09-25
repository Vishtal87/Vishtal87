#!/usr/bin/env bash
# Local dev process control: scripts/devctl.sh start|stop|restart|status <service>...
# Services: db api ingest process devstand web. Logs & pids in .run/
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.run"; mkdir -p "$RUN"
PY="$ROOT/backend/.venv/bin/python"

cmd_for() {
  case "$1" in
    api)      echo "cd $ROOT/backend && exec $PY -m geonews.cli api --host 0.0.0.0 --port ${API_PORT:-8000}" ;;
    ingest)   echo "cd $ROOT/backend && exec $PY -m geonews.cli worker ingest" ;;
    process)  echo "cd $ROOT/backend && exec $PY -m geonews.cli worker process" ;;
    maintenance) echo "cd $ROOT/backend && exec $PY -m geonews.cli worker maintenance" ;;
    devstand) echo "cd $ROOT && exec $PY -m devstand.server --port ${DEVSTAND_PORT:-8090}" ;;
    web)      echo "cd $ROOT/frontend && exec pnpm dev --host 0.0.0.0 --port ${WEB_PORT:-5173}" ;;
    *) return 1 ;;
  esac
}

start() {
  local s=$1
  if [ "$s" = db ]; then pg_lsclusters | grep -q online || service postgresql start >/dev/null; echo "db: up"; return; fi
  if [ -f "$RUN/$s.pid" ] && kill -0 "$(cat "$RUN/$s.pid")" 2>/dev/null; then echo "$s: already running"; return; fi
  local c; c=$(cmd_for "$s") || { echo "unknown service $s"; return 1; }
  nohup bash -c "$c" >"$RUN/$s.log" 2>&1 &
  echo $! >"$RUN/$s.pid"; echo "$s: started (pid $!, log .run/$s.log)"
}

stop() {
  local s=$1
  [ "$s" = db ] && { service postgresql stop >/dev/null; echo "db: stopped"; return; }
  if [ -f "$RUN/$s.pid" ]; then kill "$(cat "$RUN/$s.pid")" 2>/dev/null; rm -f "$RUN/$s.pid"; echo "$s: stopped"; fi
}

status() {
  local s=$1
  if [ "$s" = db ]; then pg_lsclusters | tail -n +2; return; fi
  if [ -f "$RUN/$s.pid" ] && kill -0 "$(cat "$RUN/$s.pid")" 2>/dev/null; then echo "$s: running"; else echo "$s: stopped"; fi
}

action=${1:-status}; shift || true
services=${*:-db api ingest process devstand web}
for s in $services; do
  case "$action" in
    start) start "$s" ;; stop) stop "$s" ;; restart) stop "$s"; sleep 1; start "$s" ;; status) status "$s" ;;
  esac
done
