# <Project name>

<One paragraph: what this project is and its stack.>

## How we work

This project uses the orchestra workflow: one orchestrator session that only coordinates, and one workstream session per feature, each with its own worktree, test database, port and PR. The full rules are in `docs/HANDOFF.md` ("How we work" and "Workstream session role"). Start there.

- Orchestrator session: load the `orchestra:orchestrator` skill.
- Workstream session: load the `orchestra:workstream` skill, then read `docs/workstreams/<name>.md` if it exists.

## Project settings

The orchestra agents read this section for every project-specific value. Keep it current.

- Integration branch (workstream PRs go here): `develop`
- Production branch (releases and hotfixes only): `main`
- Install dependencies: `npm install`
- Code generation before typecheck (or none): `none`
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint`
- Unit tests: `npm test`
- Integration tests: `npm run test:integration`
- Build: `npm run build`
- Format (touched files only): `npx prettier --write <files>`
- Migrations: `npx prisma migrate deploy`
- Dev server: `npm run dev -- --port <port>`; the orchestrator assigns each workstream its own port, starting at `3001`
- Dev database (never used by tests): `app`
- Test database URL: `postgresql://app:app@localhost:5432/app_test_<workstream>` (skill `orchestra:test-databases`)
- Capture database URL: `postgresql://app:app@localhost:5432/app_capture_<workstream>`
- Browser checks: <how agents sign in: a test user plus a saved session file outside the repository, or "none">
- Confidential paths agents must never read or copy: <paths, or "none">
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Language for code, commits and docs: English
