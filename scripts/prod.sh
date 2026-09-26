#!/usr/bin/env bash
# Production control for a VPS: scripts/prod.sh <command>   (reads .env, see .env.example and docs/DEPLOY.md)
#   init             build images, create the schema, load the offline gazetteer (first run ~5 min)
#   geonames [CC..]  download + import the full GeoNames dump (default RU: every village and hamlet)
#   verify-sources   check backend/config/sources.ru.candidates.yaml -> write backend/config/sources.ru.yaml
#   up               start / apply changes (migrations run automatically)
#   status           containers + health of the public site
#   logs [service]   follow logs
#   update           git pull + rebuild + restart
#   autoupdate       unattended update (run by a systemd timer, see bootstrap-server.sh): new commits -> rebuild;
#                    back to the previous commit when the site does not come back healthy
#   health [TRIES]   exit 0 when the site answers through Caddy on this machine (TRIES x 10 s)
#   backup           make a database dump now (also done automatically every BACKUP_EVERY_HOURS)
#   restore FILE     restore a dump from ./backups (stops api/worker meanwhile)
#   down             stop everything (data stays in volumes)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env: cp .env.example .env and fill it in (docs/DEPLOY.md)"; exit 1; }
set -a; . ./.env; set +a
DC=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
cli() { "${DC[@]}" run --rm --no-deps setup python -m geonews.cli "$@"; }

cmd=${1:-help}; shift || true
case "$cmd" in
  init)
    [ -n "${POSTGRES_PASSWORD:-}" ] || { echo "set POSTGRES_PASSWORD in .env (openssl rand -hex 24)"; exit 1; }
    "${DC[@]}" build
    "${DC[@]}" up -d --wait db
    "${DC[@]}" stop worker 2>/dev/null || true   # a reinstall: no old worker processing while the schema changes
    cli migrate
    cli load-categories
    cli import-offline --if-empty
    echo "next: scripts/prod.sh geonames RU && scripts/prod.sh verify-sources && scripts/prod.sh up" ;;
  geonames)
    "${DC[@]}" up -d --wait db
    cli import-geonames "${@:-RU}" --download ;;
  verify-sources)
    # runs as the invoking user so the result file in backend/config belongs to them
    # backend/config is mounted read-only into the services; the result goes through a separate writable mount
    # build first: after `git pull` the image still holds the previous code
    "${DC[@]}" build setup
    "${DC[@]}" run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/backend/config:/out" setup \
      python -m geonews.cli check-sources sources.ru.candidates.yaml --out /out/sources.ru.yaml "$@"
    echo "review backend/config/sources.ru.yaml, then: scripts/prod.sh up" ;;
  up)
    src="backend/config/${GEONEWS_SOURCES:-sources.ru.yaml}"
    [ -f "$src" ] || { echo "$src not found: run scripts/prod.sh verify-sources first"; exit 1; }
    mkdir -p backups
    "${DC[@]}" build
    # the old worker must not take jobs while migrations run (a data migration may queue reprocessing for the new code)
    "${DC[@]}" stop worker 2>/dev/null || true
    "${DC[@]}" up -d --remove-orphans
    "$0" status ;;
  status)
    "${DC[@]}" ps
    insecure=(); [ "$DOMAIN" = localhost ] && insecure=(-k)   # local test certificate
    if [ "${HTTPS_PORT:-443}" = 443 ]; then
      curl -fsS --max-time 10 "${insecure[@]}" "https://${DOMAIN}/api/health" >/dev/null \
        && echo "OK  https://${DOMAIN}" || echo "--  https://${DOMAIN} is not answering yet (certificate may take a minute)"
    fi
    http="http://${PUBLIC_IP:-127.0.0.1}$([ "${HTTP_PORT:-80}" = 80 ] || echo ":${HTTP_PORT}")"
    curl -fsS --max-time 10 "$http/api/health" >/dev/null && echo "OK  $http" || echo "--  $http is not answering yet" ;;
  logs)
    "${DC[@]}" logs -f --tail=200 "$@" ;;
  update)
    git pull --ff-only
    "$0" up ;;
  health)
    for _ in $(seq 1 "${1:-1}"); do
      curl -fsS --max-time 10 -H "Host: ${PUBLIC_IP:-127.0.0.1}" "http://127.0.0.1:${HTTP_PORT:-80}/api/health" \
        >/dev/null && exit 0
      sleep 10
    done
    exit 1 ;;
  autoupdate)
    exec 9>.autoupdate.lock
    flock -n 9 || exit 0                                    # a previous run is still building
    branch=$(git rev-parse --abbrev-ref HEAD)
    git fetch -q origin "$branch"
    old=$(git rev-parse HEAD); new=$(git rev-parse FETCH_HEAD)
    [ "$old" != "$new" ] || exit 0
    [ "$new" != "$(cat .autoupdate.failed 2>/dev/null)" ] || exit 0     # already tried and rolled back: wait for a fix
    echo "update ${old:0:7} -> ${new:0:7}"
    git merge -q --ff-only FETCH_HEAD
    # new candidates or collection code: re-check the sources, keeping the ones verified before
    if ! git diff --quiet "$old" "$new" -- backend/config/sources.ru.candidates.yaml backend/geonews/ingestion \
        backend/geonews/cli.py; then
      "$0" verify-sources --keep-previous || echo "source check failed: the current source list stays"
    fi
    if "$0" up && "$0" health 18; then
      echo "updated to ${new:0:7}"
    else
      echo "the site is not healthy after the update: back to ${old:0:7}"
      echo "$new" > .autoupdate.failed
      git reset -q --hard "$old"
      "$0" up && "$0" health 18
      exit 1
    fi ;;
  backup)
    "${DC[@]}" exec backup sh /backup.sh once ;;
  restore)
    f=$(basename "${1:?usage: scripts/prod.sh restore <file in ./backups>}")
    [ -f "backups/$f" ] || { echo "backups/$f not found"; exit 1; }
    "${DC[@]}" stop api worker
    "${DC[@]}" exec -T backup sh -c "dropdb -h db -U geonews --force geonews && createdb -h db -U geonews geonews \
      && pg_restore -h db -U geonews -d geonews --no-owner /backups/$f"
    "${DC[@]}" start api worker
    echo "restored $f" ;;
  down)
    "${DC[@]}" down ;;
  *)
    sed -n '2,16p' "$0" ;;
esac
