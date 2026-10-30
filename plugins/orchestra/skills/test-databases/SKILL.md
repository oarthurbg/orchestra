---
name: test-databases
description: Isolated test data per workstream, whatever the data store (SQL, SQLite, MongoDB, Redis, files, or none), the rule that tests never touch real or dev data, and an optional capture copy for screenshots. Use when opening or closing a workstream, before running tests that need data, before taking screenshots, during /orchestra:init, or when a plan points tests at the dev data.
---

# Test data

## The rule

Each workstream gets its own isolated test data, and tests never touch real or dev data, even when a plan points them there (for example `TEST_DATABASE_URL="$DATABASE_URL"`). Several agents sharing one test store cause intermittent failures; one store per workstream removes that. The mechanism belongs to the project; orchestra only needs three commands and one variable, written in the "Test data" block of "Project settings" in `CLAUDE.md`:

- **Create** `<workstream>`: makes the workstream's empty test store and applies the schema.
- **Drop** `<workstream>`: removes it after the PR merges.
- **Capture copy** `<workstream>` (optional): a fresh copy of the local dev data, so screenshots show realistic screens without anything writing to the dev data. Never copy production data.
- **Tests read**: the variable the tests use to find their store, with `<workstream>` in its value.

If the project keeps no data (a CLI, a library, a static site), "Test data" is `none` and agents skip all of this.

A reviewer without the test data skips the tests that need it and says so. The orchestrator runs the full suite after merging.

Workstream names use `[a-z0-9_]`. Every name a test command builds carries a fixed `test` or `capture` marker plus the workstream name (`app_test_<ws>`, `test_<ws>.sqlite`, `test:<ws>:`), so no command can ever resolve to the dev data.

## Recipes

Pick the one that matches the project's data store and write its commands into "Project settings". Run them from the workstream's worktree so the migration applies that workstream's schema.

**PostgreSQL** (tested example included, see below): one database per workstream, `CREATE DATABASE app_test_<ws>`; capture with `pg_dump app | psql app_capture_<ws>`. Tests read `TEST_DATABASE_URL=postgresql://.../app_test_<ws>`.

**MySQL or MariaDB:** one database per workstream.
- Create: `mysql -e "CREATE DATABASE IF NOT EXISTS app_test_<ws>"`, then the migration command.
- Drop: `mysql -e "DROP DATABASE IF EXISTS app_test_<ws>"`.
- Capture: `mysqldump app | mysql app_capture_<ws>` (after creating it).
- Tests read: `TEST_DATABASE_URL=mysql://.../app_test_<ws>`.

**SQLite:** one file per workstream.
- Create: `mkdir -p .data`, then run the migration with `DB_PATH=.data/test_<ws>.sqlite`.
- Drop: delete that file.
- Capture: copy the dev file to `.data/capture_<ws>.sqlite` (`sqlite3 dev.sqlite ".backup .data/capture_<ws>.sqlite"` is safe while the app runs).
- Tests read: `DB_PATH=.data/test_<ws>.sqlite`. Keep `.data/` in `.gitignore`.

**MongoDB:** one database per workstream.
- Create: nothing to do; Mongo creates it on first write. Run index or seed scripts against `app_test_<ws>`.
- Drop: `mongosh app_test_<ws> --eval "db.dropDatabase()"`.
- Capture: `mongodump --db app --archive | mongorestore --archive --nsFrom "app.*" --nsTo "app_capture_<ws>.*"`.
- Tests read: `MONGODB_URI=mongodb://.../app_test_<ws>`.

**Redis:** one key prefix per workstream (or one db index each, if there are few workstreams).
- Create: nothing to do.
- Drop: `redis-cli --scan --pattern "test:<ws>:*" | xargs -r redis-cli del` (Unix shell; GNU `xargs`), or `redis-cli -n <n> flushdb` for the db-index variant.
- Capture: usually not needed; seed instead.
- Tests read: `REDIS_PREFIX=test:<ws>:` (or `REDIS_URL=redis://localhost:6379/<n>`).

**Managed database without rights to create databases:** one schema per workstream.
- Create: `CREATE SCHEMA test_<ws>`, then the migration with the schema set (Prisma: `?schema=test_<ws>`; plain PostgreSQL URLs: `?options=-c%20search_path%3Dtest_<ws>`).
- Drop: `DROP SCHEMA test_<ws> CASCADE`.
- Tests read: the connection URL with that schema. Ask the owner before pointing anything at a shared server.

**Files or object storage:** one folder or bucket prefix per workstream (`.data/test_<ws>/`, `s3://bucket/test/<ws>/`), deleted on drop.

## Optional example: PostgreSQL in Docker

A tested setup for projects that want a local Postgres. Docker is needed only for this example. `/orchestra:init` copies it only if you choose it.

- `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/docker-compose.yml`: Postgres 17 bound to `127.0.0.1`, with throwaway local credentials.
- `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/scripts/test-db.sh` and `test-db.ps1`: `create`, `drop`, `capture` and `drop-capture` in Bash and PowerShell.
- `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/scripts/selftest.sh`: starts a throwaway Postgres on port 55432, runs every action of both scripts, and tears it down.

```bash
docker compose -f docker-compose.test-db.yml up -d --wait
scripts/test-db/test-db.sh create <workstream>        # prints TEST_DATABASE_URL
scripts/test-db/test-db.sh capture <workstream>       # fresh copy of the dev database
scripts/test-db/test-db.sh drop <workstream>
scripts/test-db/test-db.sh drop-capture <workstream>
```

Settings come from environment variables, with these defaults: `PG_CONTAINER=orchestra-postgres`, `PG_USER=app`, `PG_PASSWORD=app`, `PG_PORT=5432`, `DEV_DB=app`. To use a Postgres container the project already runs, set `PG_CONTAINER` and the credentials to match it. Set `MIGRATE_CMD` to apply the schema right after `create` or `capture`; it runs with `DATABASE_URL` and `TEST_DATABASE_URL` pointing at the new database. Every name the scripts build carries a `_test_` or `_capture_` suffix, so no action can drop the dev database.

## Lifecycle

1. Opening a workstream: run Create and record the test value in the handoff note.
2. Before screenshots (web UI only): run Capture copy, if the project has one, and start the app from the integration worktree on the workstream's port, pointed at it.
3. After the PR merges: run Drop (and drop the capture copy).
