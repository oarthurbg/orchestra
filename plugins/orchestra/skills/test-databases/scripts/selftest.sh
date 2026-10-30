#!/usr/bin/env bash
# Self-check for test-db.sh (and test-db.ps1 when pwsh or powershell is on PATH).
# Starts a throwaway Postgres on port 55432, runs every action, asserts, tears down.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
export PG_CONTAINER=orchestra-selftest PG_PORT=55432 DEV_DB=app
compose=(docker compose -p orchestra-selftest -f "$here/../docker-compose.yml")
trap '"${compose[@]}" down -v >/dev/null 2>&1' EXIT

"${compose[@]}" up -d --wait >/dev/null
docker exec "$PG_CONTAINER" psql -U app -d app -qc "CREATE TABLE seed (id int); INSERT INTO seed VALUES (42);"
count() { docker exec "$PG_CONTAINER" psql -U app -d postgres -tAc "SELECT count(*) FROM pg_database WHERE datname = '$1'"; }
check() { [[ $(count "$1") == "$2" ]] || { echo "FAIL: $1 expected $2" >&2; exit 1; }; }

run_suite() { # $1 = command prefix that runs the script
  out=$($1 create ws1); [[ $out == *'TEST_DATABASE_URL=postgresql://app:app@localhost:55432/app_test_ws1'* ]]
  check app_test_ws1 1
  out=$($1 create ws1); [[ $out == *'exists: app_test_ws1'* ]]
  $1 capture ws1 >/dev/null
  [[ $(docker exec "$PG_CONTAINER" psql -U app -d app_capture_ws1 -tAc 'SELECT id FROM seed') == 42 ]] || { echo "FAIL: capture copy" >&2; exit 1; }
  $1 drop ws1 >/dev/null; check app_test_ws1 0
  $1 drop-capture ws1 >/dev/null; check app_capture_ws1 0
  check app 1
  if $1 create 'bad;name' >/dev/null 2>&1; then echo "FAIL: bad name accepted" >&2; exit 1; fi
}

run_suite "bash $here/test-db.sh"
echo "bash: ok"
ps=$(command -v pwsh || command -v powershell || true)
if [[ -n $ps ]]; then
  run_suite "$ps -NoProfile -File $here/test-db.ps1"
  echo "powershell: ok"
fi
