# HANDOFF

The single entry point for every session. Read "Where we are", then your role below.

## Where we are

Durable summary: what is merged and released, open decisions, the schema queue. It changes through PRs (a workstream's last commit, or a docs PR). The live status table is not kept here: each `/orchestra:status` round writes it to `.orchestra/status.md`, which is not versioned.

- <YYYY-MM-DD>: <what is merged, what is released, what comes next>

## Workstreams

The live registry of open workstreams (session, branch and worktree, test data, port, schema change, stage) is `.orchestra/workstreams.md`, which is not versioned: `/orchestra:start-workstream` adds a row, `/orchestra:status` reads it, and the merge checklist removes the row. Record finished workstreams in "Where we are" through a PR.

## How we work

- **The spec rules everything.** Every workstream starts from a spec in `docs/superpowers/specs/` (brainstormed with the owner), never from code. The plan and the tasks come from the spec. If anyone finds the spec wrong or incomplete, work stops and the change goes into the spec first (recorded in `docs/decisions.md`), then into the code. Two workstreams never have overlapping specs: the maestro checks before opening a new one.
- **Main session = maestro.** Chooses the work, opens principals (at their level in "Owner authorizations" in `CLAUDE.md`), watches context and machine load, checks and merges PRs, talks to the owner. Writes no code, not even through subagents; its subagents only read and research.
- **One session per workstream**, each with its own worktree from the integration branch (`git worktree add -b <branch> <path> origin/<integration branch>`), its own isolated test data and dev server port when the project has them, and its own PR into the integration branch. Workstreams run in parallel only when independent. A hotfix branches from the production branch and is merged back into the integration branch right after.
- **Schema queue:** at most one workstream with a data schema change open at a time. The next one rebases and regenerates its migration before merging.
- **Parallelism:** up to 2 tasks at once per workstream; with 4 to 6 workstreams the machine is at its limit.
- **Reviews:** two stages (spec compliance, then code quality), proportional to the risk the planner tags on each task. UI tasks get a third review, `impeccable-finish-reviewer`, from real screenshots (web UIs with a dev server). Before the PR, a close-out review of the whole branch (`requesting-code-review` with `ponytail-review`) and `ponytail-debt` in the PR description.
- **Merging:** a principal never merges its own PR. The maestro merges after reviews and green CI, and runs the full suite after merging.
- **Releases:** the maestro runs the full verification on the integration branch, opens the release PR into the production branch and merges it. Between releases: `ponytail-audit` and the impeccable audit, to open cleanup workstreams.
- **Owner steps (👤):** say so before and wait for the go-ahead.
- **Owner answers in the principal:** checkpoints, mockups and design choices are answered directly in the principal. When a decision affects another workstream, the session sends one line to the maestro.
- **Context:** the auto-compact net is at 600k tokens (`autoCompactWindow`). At the end of each wave, a principal above 250k updates its handoff note (`docs/workstreams/<name>.md`) and asks the maestro to clear it, which happens at its level in "Owner authorizations". The maestro clears only at a natural stop, never mid-task, and sends the briefing back.
- **Archiving:** at its level in "Owner authorizations", the maestro archives a principal whose PR is merged and that has no upcoming work, after checking no agent is running (archiving kills its agents). It reactivates the same session when work returns near its spec and its context is still below 250k. The app's auto-archive on PR close stays off.
- **Ponytail and skills per stage:** every session starts in full and the principal switches mode per stage (brainstorm and mockups off, spec lite, plan ultra, backend full, UI lite, infrastructure ultra, reviews off). The full table is in the `orchestra:maestro` skill (`stages.md`).
- **Test data:** each workstream gets its own isolated test data ("Test data" in `CLAUDE.md`); tests never touch real or dev data, even if a plan points them there. Screenshots use the capture copy when the project has one. Projects that keep no data write `none`.
- **Agents in worktrees:** never `git stash` (the stash list is shared across worktrees); `git add <path>` only; `git diff --cached --stat` before each commit; never commit on the integration or production branch, and never `--no-verify`.
- **Bypass permissions and the gates:** sessions run under bypass permissions, so two things stand in for approval prompts: "Owner authorizations" in `CLAUDE.md`, which the maestro reads before every merge, release, clear or archive, and the `pre-push` branch guard, which refuses direct pushes to the integration and production branches. Branch protection on GitHub backs the guard up, since a hook only runs in clones that installed it. Always ask the owner first, in every session and subagent: anything that needs admin rights, deletes data or branches, or touches credentials, money or production data.
- **Lessons:** `docs/lessons.md` holds one dated line per problem that must not happen twice; the maestro adds them through docs PRs. Agents keep no other memory.
- **Status round:** `/orchestra:status` writes the live table to `.orchestra/status.md` (not versioned); each principal keeps the status line of its handoff note current.

## Principal role

- The principal owns one workstream from start to PR: spec, plan, subagents (one at a time, visible), reviews (spec compliance, quality and, for UI, the third one from screenshots) and the PR into the integration branch.
- It reports to the maestro in one line when a decision affects another workstream, when it opens or changes a schema migration, when it closes a wave (with its context size), and when the PR is ready to check and merge. It never merges its own PR and never touches another workstream's spec, plan or code.
- Skills: `brainstorming` before the spec; `writing-plans` through the planner; `subagent-driven-development` to execute; `dispatching-parallel-agents` for parallel plan tasks (no shared files, self-contained briefings) and for 2 or more independent failures; `systematic-debugging` for flaky failures; `requesting-code-review` before the PR; `receiving-code-review` for review findings; `finishing-a-development-branch` at close-out. Where a skill disagrees with this HANDOFF, this HANDOFF wins.
- Support agents: `screenshotter` (web UIs with a dev server; light and dark, wide and narrow, empty, loading and error states) before `impeccable-finish-reviewer`; `verifier` (full verification, report only) before the PR.
- Handoff note: `docs/workstreams/<name>.md` on the workstream branch, fixed template (skill `orchestra:handoff-note`), deleted in the last commit before merge.

## Next workstreams

1. <name>: <one line>

## Open questions for the owner

- <question>
