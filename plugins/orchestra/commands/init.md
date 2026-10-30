---
description: Scaffold the orchestra workflow into this project (CLAUDE.md settings, HANDOFF.md, docs/workstreams/, test database compose file and scripts)
---

Set up the orchestra workflow in the current project. Never overwrite an existing file without asking: show the user what would change and wait for a yes.

1. Look at the project first: package manager and scripts (`package.json`, `Makefile`, `pyproject.toml` and so on), ORM and migration tool, test runner, git branches (`git branch -a`), and any existing Postgres or compose setup. Use this to propose values for "Project settings" instead of asking from scratch.
2. **CLAUDE.md:** if the project has none, create it from `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` with the values from step 1. If it exists, add only the "How we work" and "Project settings" sections from the template. Ask the user to confirm the values you could not detect (integration and production branch names, browser sign-in for agents, confidential paths).
3. **docs/HANDOFF.md:** create it from `${CLAUDE_PLUGIN_ROOT}/templates/HANDOFF.md`, replacing the database names, ports and branch names with the project's values. If one exists, offer to add the "How we work" and "Workstream session role" sections.
4. **docs/workstreams/:** create it with a `README.md` of one line: "One handoff note per running workstream, template in the orchestra:handoff-note skill. Each note is deleted before its PR merges."
5. **Test databases:** copy `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/docker-compose.yml` to `docker-compose.test-db.yml`, and `test-db.sh` and `test-db.ps1` from `${CLAUDE_PLUGIN_ROOT}/skills/test-databases/scripts/` to `scripts/test-db/`. If the project already runs Postgres in a container, skip the compose file and tell the user which `PG_*` and `DEV_DB` variables to set instead.
6. **Specs and decisions:** create `docs/superpowers/specs/` and `docs/decisions.md` (one heading, "Decisions", if new) when missing.
7. Do not change the user's own settings. Tell them what is recommended, so they can apply it themselves: `"autoCompactWindow": 600000` in `~/.claude/settings.json`; the desktop app's auto-archive on PR close turned off; the third-party plugins listed in the orchestra README installed.
8. Show the list of files created or changed and stop. Do not commit unless the user asks.
