#!/bin/sh
# Proves a backup can be restored (Sprint 6a). Run by hand, after a backup
# (docs/07-deploy-digitalocean.md):
#
#   deploy/restore-check.sh [dump file]      (default: the newest dump)
#
# Restores the dump into a SCRATCH database (qrpark_restore_check) inside the
# postgres container, counts every table's rows there and in the live
# database, prints the two columns side by side, and drops the scratch
# database. The live database is only read. Prints table names and counts,
# nothing else. Exit 0 only when every count matches (anything written to the
# live database after the dump shows as a difference: run it when quiet).
#
# Settings: BACKUP_DIR (default /var/backups/qrpark), PG_CONTAINER (default qrpark-postgres-1).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/qrpark}"
PG_CONTAINER="${PG_CONTAINER:-qrpark-postgres-1}"
SCRATCH=qrpark_restore_check

dump="${1:-$(ls -1t "$BACKUP_DIR"/qrpark-*.dump 2>/dev/null | head -n 1)}"
[ -n "$dump" ] && [ -s "$dump" ] || { echo "no dump found" >&2; exit 1; }

psql_in() { docker exec -i "$PG_CONTAINER" psql -U qrpark -v ON_ERROR_STOP=1 -qAt "$@"; }

COUNTS="SELECT table_name || ' ' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]::text
        FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"

cleanup() { psql_in -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" > /dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
psql_in -d postgres -c "CREATE DATABASE $SCRATCH" > /dev/null
docker exec -i "$PG_CONTAINER" pg_restore -U qrpark -d "$SCRATCH" --no-owner --exit-on-error < "$dump"

live="$(psql_in -d qrpark -c "$COUNTS")"
restored="$(psql_in -d "$SCRATCH" -c "$COUNTS")"

echo "dump: $(basename "$dump")"
printf '%-24s %12s %12s\n' table live restored
echo "$live" | while read -r table n; do
  r="$(echo "$restored" | awk -v t="$table" '$1 == t { print $2 }')"
  printf '%-24s %12s %12s%s\n' "$table" "$n" "${r:-missing}" "$([ "$n" = "$r" ] || echo '   DIFFERENT')"
done
if [ "$live" = "$restored" ]; then
  echo "RESTORE CHECK: every table's row count matches"
else
  echo "RESTORE CHECK: counts differ (see above)"
  exit 1
fi
