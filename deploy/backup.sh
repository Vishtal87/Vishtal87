#!/bin/sh
# Database backups for the production stack (runs in the `backup` service, postgis image => pg_dump matches the server).
#   sh /backup.sh        loop: dump every BACKUP_EVERY_HOURS, keep the newest BACKUP_KEEP dumps in /backups
#   sh /backup.sh once   one dump now
set -eu

dump_once() {
  f="/backups/geonews-$(date -u +%Y%m%d-%H%M%S).dump"
  pg_dump -h db -U geonews -Fc geonews > "$f.part"
  mv "$f.part" "$f"
  echo "backup: $f ($(du -h "$f" | cut -f1))"
  ls -1t /backups/geonews-*.dump | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
}

if [ "${1:-}" = once ]; then
  dump_once
  exit 0
fi
while true; do
  dump_once || echo "backup failed" >&2
  sleep "$((BACKUP_EVERY_HOURS * 3600))"
done
