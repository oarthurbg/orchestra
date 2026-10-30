#!/usr/bin/env bash
# Per-workstream test and capture databases in a local Postgres container.
# Usage: test-db.sh create|drop|capture|drop-capture <workstream>
# Settings (env, with defaults): PG_CONTAINER=orchestra-postgres PG_USER=app
#   PG_PASSWORD=app PG_PORT=5432 DEV_DB=app MIGRATE_CMD= (run after create/capture
#   with DATABASE_URL and TEST_DATABASE_URL set to the new database)
set -euo pipefail

action=${1:-}
ws=${2:-}
container=${PG_CONTAINER:-orchestra-postgres}
user=${PG_USER:-app}
password=${PG_PASSWORD:-app}
port=${PG_PORT:-5432}
dev_db=${DEV_DB:-app}

die() { echo "test-db: $*" >&2; exit 1; }

[[ $ws =~ ^[a-z0-9_]+$ ]] || die "workstream name must match [a-z0-9_]+ (got '$ws')"
[[ $dev_db =~ ^[A-Za-z0-9_]+$ ]] || die "DEV_DB must match [A-Za-z0-9_]+"

# Names always carry a _test_ or _capture_ suffix, so no action here can touch the dev database.
test_db="${dev_db}_test_${ws}"
capture_db="${dev_db}_capture_${ws}"

psql_admin() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$user" -d postgres -qtAc "$1"; }
exists() { [[ $(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$1'") == 1 ]]; }
url() { echo "postgresql://${user}:${password}@localhost:${port}/$1"; }
migrate() {
  [[ -z ${MIGRATE_CMD:-} ]] && return 0
  DATABASE_URL=$(url "$1") TEST_DATABASE_URL=$(url "$1") bash -c "$MIGRATE_CMD"
}

case $action in
  create)
    if exists "$test_db"; then echo "exists: $test_db"; else psql_admin "CREATE DATABASE \"$test_db\""; echo "created: $test_db"; fi
    migrate "$test_db"
    echo "TEST_DATABASE_URL=$(url "$test_db")"
    ;;
  drop)
    psql_admin "DROP DATABASE IF EXISTS \"$test_db\" WITH (FORCE)"
    echo "dropped: $test_db"
    ;;
  capture)
    # A fresh copy of the local dev database for screenshots. Never a production database.
    exists "$dev_db" || die "dev database '$dev_db' not found in container '$container'"
    psql_admin "DROP DATABASE IF EXISTS \"$capture_db\" WITH (FORCE)"
    psql_admin "CREATE DATABASE \"$capture_db\""
    docker exec "$container" sh -c "pg_dump -U '$user' '$dev_db' | psql -q -v ON_ERROR_STOP=1 -U '$user' -d '$capture_db'" >/dev/null
    echo "captured: $dev_db -> $capture_db"
    echo "DATABASE_URL=$(url "$capture_db")"
    ;;
  drop-capture)
    psql_admin "DROP DATABASE IF EXISTS \"$capture_db\" WITH (FORCE)"
    echo "dropped: $capture_db"
    ;;
  *) die "usage: test-db.sh create|drop|capture|drop-capture <workstream>" ;;
esac
