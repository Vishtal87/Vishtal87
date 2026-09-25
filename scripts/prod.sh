#!/usr/bin/env bash
# Production control for a VPS: scripts/prod.sh <command>   (reads .env, see .env.example and docs/DEPLOY.md)
#   init             build images, create the schema, load the offline gazetteer (first run ~5 min)
#   geonames [CC..]  download + import the full GeoNames dump (default RU: every village and hamlet)
#   verify-sources   check backend/config/sources.ru.candidates.yaml -> write backend/config/sources.ru.yaml
#   up               start / apply changes (migrations run automatically)
#   status           containers + health of the public site
#   logs [service]   follow logs
#   update           git pull + rebuild + restart
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
    "${DC[@]}" run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/backend/config:/out" setup \
      python -m geonews.cli check-sources sources.ru.candidates.yaml --out /out/sources.ru.yaml
    echo "review backend/config/sources.ru.yaml, then: scripts/prod.sh up" ;;
  up)
    src="backend/config/${GEONEWS_SOURCES:-sources.ru.yaml}"
    [ -f "$src" ] || { echo "$src not found: run scripts/prod.sh verify-sources first"; exit 1; }
    mkdir -p backups
    "${DC[@]}" up -d --build --remove-orphans
    "$0" status ;;
  status)
    "${DC[@]}" ps
    insecure=(); [ "$DOMAIN" = localhost ] && insecure=(-k)   # local test certificate
    curl -fsS --max-time 10 "${insecure[@]}" "https://${DOMAIN}/api/health" && echo || echo "https://${DOMAIN} is not answering yet" ;;
  logs)
    "${DC[@]}" logs -f --tail=200 "$@" ;;
  update)
    git pull --ff-only
    "$0" up ;;
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
    sed -n '2,13p' "$0" ;;
esac
