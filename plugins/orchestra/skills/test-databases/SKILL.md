---
name: test-databases
description: Per-workstream Postgres test databases in Docker, a capture-database copy for screenshots, and the rule that tests never touch the real database. Use when opening or closing a workstream, before running integration tests, before taking screenshots, or when a plan says TEST_DATABASE_URL="$DATABASE_URL".
---

# Test databases

## The rule

Integration tests run only against the workstream's own test database, `<db>_test_<workstream>`. Never the dev database, never a shared or production one, even when a plan says `TEST_DATABASE_URL="$DATABASE_URL"`. Several agents on one test database cause intermittent failures; one database per workstream removes that.

A reviewer without `TEST_DATABASE_URL` skips integration tests and says so. The orchestrator runs the full suite after merging.

Screenshots run against a capture database, `<db>_capture_<workstream>`: a fresh copy of the local dev database, so screens show realistic data and nothing writes to the dev database. Never copy a production database.

## Files

`/orchestra:init` copies these into the project; they are also here:

- `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/docker-compose.yml`: Postgres 17 bound to `127.0.0.1`, with throwaway local credentials.
- `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/scripts/test-db.sh` and `test-db.ps1`: the same four actions in Bash and PowerShell.
- `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/scripts/selftest.sh`: starts a throwaway Postgres on port 55432, runs every action of both scripts, and tears it down.

## Usage

```bash
docker compose -f docker-compose.test-db.yml up -d --wait
scripts/test-db/test-db.sh create <workstream>        # prints TEST_DATABASE_URL
scripts/test-db/test-db.sh capture <workstream>       # fresh copy of the dev database
scripts/test-db/test-db.sh drop <workstream>
scripts/test-db/test-db.sh drop-capture <workstream>
```

PowerShell: `./scripts/test-db/test-db.ps1 create <workstream>`, and so on.

Workstream names use `[a-z0-9_]` only. Every name the scripts build carries a `_test_` or `_capture_` suffix, so no action can drop the dev database.

Settings come from environment variables, with these defaults: `PG_CONTAINER=orchestra-postgres`, `PG_USER=app`, `PG_PASSWORD=app`, `PG_PORT=5432`, `DEV_DB=app`. To use a Postgres container the project already runs, set `PG_CONTAINER` and the credentials to match it. Set `MIGRATE_CMD` (for example `npx prisma migrate deploy`) to apply the schema right after `create` or `capture`; it runs with `DATABASE_URL` and `TEST_DATABASE_URL` pointing at the new database, from the workstream's worktree so it applies that workstream's schema.

## Lifecycle

1. Opening a workstream: `create`, then record the URL in the handoff note and the "Project settings" pattern.
2. Before screenshots: `capture`, and run the app from the integration worktree on the workstream's own port with `DATABASE_URL` set to the capture database.
3. After the PR merges: `drop` and `drop-capture`.
