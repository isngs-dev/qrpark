#!/bin/sh
# Daily database backup (Sprint 6a). Run by the qrpark-backup systemd timer as
# the deploy user; see docs/07-deploy-digitalocean.md.
#
#  - pg_dump in Postgres's custom format (compressed), taken inside the
#    postgres container over its local socket: no password, no network.
#  - Each file readable by its owner only (umask 077, mode 600), in a
#    directory only the owner can enter (mode 700).
#  - A dump is checked readable (pg_restore --list) before it is kept; a
#    failed or unreadable dump is removed, never kept as if good.
#  - Dumps older than KEEP_DAYS (14) are deleted.
#  - Prints nothing when all is well; on failure, one line saying which step
#    failed (no data, no names, no passwords) and a non-zero exit, which the
#    timer's journal records.
#
# Settings (environment, all optional):
#   BACKUP_DIR    default /var/backups/qrpark
#   KEEP_DAYS     default 14
#   PG_CONTAINER  default qrpark-postgres-1 (compose project "qrpark")
set -eu
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/qrpark}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-qrpark-postgres-1}"

fail() {
  echo "qrpark backup failed: $1" >&2
  rm -f "$partial"
  exit 1
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$BACKUP_DIR/.qrpark-$stamp.dump.partial"
final="$BACKUP_DIR/qrpark-$stamp.dump"

docker exec "$PG_CONTAINER" pg_dump -U qrpark -d qrpark --format=custom --compress=9 > "$partial" 2>/dev/null \
  || fail "pg_dump"
[ -s "$partial" ] || fail "empty dump"
docker exec -i "$PG_CONTAINER" pg_restore --list < "$partial" > /dev/null 2>&1 \
  || fail "the dump is not readable"
chmod 600 "$partial"
mv "$partial" "$final"

# Keep KEEP_DAYS days: delete dumps last changed more than KEEP_DAYS-1 whole days ago.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'qrpark-*.dump' -mtime "+$((KEEP_DAYS - 1))" -delete
