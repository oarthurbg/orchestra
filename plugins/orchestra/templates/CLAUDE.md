# <Project name>

<One paragraph: what this project is and its stack.>

## How we work

This project uses the orchestra workflow: one maestro session that only coordinates, and one principal per feature, each with its own worktree, its own isolated test data and its own PR. The full rules are in `docs/HANDOFF.md` ("How we work" and "Principal role"). Start there.

- Maestro session: load the `orchestra:maestro` skill.
- Principal: load the `orchestra:principal` skill, then read `docs/workstreams/<name>.md` if it exists.

## Project settings

The orchestra agents read this section for every project-specific value. Keep it current. Write `none` for anything the project does not have; agents skip that part instead of stopping.

- Integration branch (workstream PRs go here): `<develop>`
- Production branch (releases and hotfixes only): `<main>`
- Install dependencies: `<command>`
- Code generation before typecheck: `none` | `<command>`
- Typecheck: `none` | `<command>`
- Lint: `none` | `<command>`
- Unit tests: `<command>`
- Integration tests: `none` | `<command>`
- Build: `none` | `<command>`
- Format (touched files only): `none` | `<command> <files>`
- Migrations: `none` | `<command>`
- Dev server: `none` | `<command with <port>>`. With a dev server, the maestro gives each workstream its own port, starting at `<3001>`.
- Test data: `none` | the lines below (skill `orchestra:test-databases` has recipes per data store)
  - Create: `<command> <workstream>`
  - Drop: `<command> <workstream>`
  - Capture copy for screenshots: `none` | `<command> <workstream>`
  - Tests read: `<ENV_VAR>=<value containing <workstream>>`
  - Real data tests must never touch: `<dev database, data folder, bucket...>`
- Browser checks: `none` | `no login` | <how agents sign in: a test user plus a saved session file outside the repository>. Only for apps with a web UI and a dev server.
- Confidential paths agents must never read or copy: `none` | <paths>
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Language for code, commits and docs: English

## Owner authorizations

The maestro reads this before each action below and acts at its level: `ask` (wait for the owner's yes), `tell` (do it, then report right away) or `auto` (do it, report in the next status round). orchestra runs under bypass permissions, so this list is the gate. Change a level only on the owner's own word, and date the change in `docs/HANDOFF.md`.

- Merge a workstream PR into the integration branch: `ask`
- Release (integration branch into production branch): `ask`
- Hotfix into the production branch, and its back-merge: `ask`
- Clear a principal session at a natural stop: `ask`
- Archive a finished principal session: `ask`
- Start a new principal session: `ask`
- Server commands that need no admin rights and touch no production data (send files, read health and logs): `ask`

Always `ask`, whatever is written above, for the maestro, principals and every subagent: anything that needs admin rights, deletes data or branches, or touches credentials, money or production data.
