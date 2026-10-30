---
description: Close a wave of tasks: check context, update the handoff note, and clear the session at a natural stop when it is above 250k tokens
argument-hint: "[workstream-name, when run from the maestro]"
---

Close a wave of tasks. First decide which role this session has: a principal (skill `orchestra:principal`) or the maestro (skill `orchestra:maestro`).

## In a principal session

1. Make sure no subagent or command is still running. If one is, wait for it; never close a wave mid-task.
2. Check your own context size: `get_usage` on this session in the desktop app; without it, `context.tokens` in your band report, the newest file in `<main checkout>/.orchestra/sessions/` whose `branch` is yours (the main checkout is the first line of `git worktree list`). Never estimate it.
3. Update your handoff note `docs/workstreams/<name>.md` with the `orchestra:handoff-note` template (the status line and all 8 sections), and commit it with `git add <path>` only.
4. Report to the maestro in one line: wave done, what landed, next task, context size, and whether you need a clear (above 250k tokens). In the desktop app, `SendMessage` to the maestro session; without it, the status line you just committed is the report, and the maestro reads it from your worktree.
5. Below 250k, carry on with the next wave. Above 250k, stop dispatching and wait for the maestro.

## In the maestro ($ARGUMENTS names the workstream)

1. Check the workstream's usage (`get_usage`) and its last events (`list_events`): it must be at a natural stop (PR merged, wave done or checkpoint) with no agent or command running.
2. Below 250k tokens, do nothing: clearing does not pay off.
3. Above 250k: confirm the handoff note is committed and current, then clear at its level in "Owner authorizations" (`CLAUDE.md`) with `clear_session`.
4. Send the briefing back: "Load the `orchestra:principal` skill. Read `docs/workstreams/<name>.md` and follow its clean-session checklist. Continue from task <N> of `<plan path>`."
5. If the workstream's PR is merged and no work is coming, archive the session instead, at its level in "Owner authorizations" (`archive_session`, after checking no agent is running).
