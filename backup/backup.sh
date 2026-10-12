#!/bin/sh
# Runs pg_dump every 24 hours and whenever the app drops a trigger file
# into /backups (a session close). Keeps the last BACKUP_KEEP_DAYS days.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_SECONDS=86400
LAST_FILE=/backups/.last_backup
TRIGGER_FILE=/backups/.trigger
REDIS_DATA_DIR="${REDIS_DATA_DIR:-}"

mkdir -p /backups
: > "$LAST_FILE.tmp"
echo "backup service started (keep ${KEEP_DAYS} days)"

# Best-effort copy of the Redis AOF dir. Postgres is the source of truth;
# a torn AOF tail is discarded by Redis on load, so a live copy is acceptable.
copy_redis() {
  if [ -z "$REDIS_DATA_DIR" ] || [ ! -d "$REDIS_DATA_DIR" ]; then
    echo "$(date -u '+%FT%TZ') redis data dir not mounted, skipping redis snapshot"
    return 0
  fi
  dir="/backups/redis-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"
  cp -a "$REDIS_DATA_DIR/." "$dir/" 2>/dev/null || true
  find /backups -maxdepth 1 -type d -name 'redis-*' -mtime "+${KEEP_DAYS}" -exec rm -rf {} + 2>/dev/null || true
  echo "$(date -u '+%FT%TZ') redis snapshot written: $dir"
}

run_backup() {
  file="/backups/attendance-$(date +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc -f "$file"; then
    date +%s > "$LAST_FILE"
    rm -f "$TRIGGER_FILE"
    find /backups -name 'attendance-*.dump' -mtime "+${KEEP_DAYS}" -delete
    copy_redis
    echo "$(date -u '+%FT%TZ') backup written: $file"
  else
    echo "$(date -u '+%FT%TZ') backup failed, retrying in 5 minutes" >&2
    sleep 300
  fi
}

while true; do
  now=$(date +%s)
  last=$(cat "$LAST_FILE" 2>/dev/null || echo 0)
  if [ -f "$TRIGGER_FILE" ] || [ "$((now - last))" -ge "$INTERVAL_SECONDS" ]; then
    run_backup
  fi
  sleep 60
done
