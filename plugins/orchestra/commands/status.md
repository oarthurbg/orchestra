---
description: (Orchestrator) Status round: one table of every workstream, what needs the owner, and what you will do next
---

You are the orchestrator (skill `orchestra:orchestrator`). Run a status round. Use only data that already exists; do not dispatch agents or ask sessions for reports to build it.

## Gather

For each open workstream (the registry in `.orchestra/workstreams.md`):

1. **Session state and context:** in the desktop app, the linked session list and `get_usage` per session; `list_events` to spot a session with pending work that has gone quiet. Without the app, read the status line of the workstream's handoff note and the time of its last commit.
2. **Status line:** the `Status:` line at the top of `<worktree>/docs/workstreams/<name>.md` (state, context, stage and task, PR, waiting on, updated). Read it straight from the worktree folder.
3. **PR and CI:** `gh pr list --state open` and `gh pr checks <number>` for the workstream's PR.

## Report

Always in this shape, nothing more:

| Workstream | State | Context | Stage and task | PR and CI | Waiting on owner | Next |
| --- | --- | --- | --- | --- | --- | --- |

- **State:** running, idle, waiting on owner, or stalled (pending work, no activity since the last round).
- **Context:** in thousands of tokens; mark 250k or more with ⚠.
- **Stage and task:** brainstorm, spec, plan, build, review or PR, plus "task N of M" from the plan's checkboxes.

Then two short lists:

- **Needs you:** decisions, 👤 steps and approvals, most urgent first, each with the session to answer in.
- **I'll do next:** what you will do on your own, each marked with its level from "Owner authorizations" in `CLAUDE.md` (for example "clear reports at its next natural stop (ask)").

## Act

- **Stalled session:** tell it to resume (`SendMessage` to its session; without the desktop app, ask the owner to type it there), or check its worktree and output first if an agent died with the session.
- **250k or more at a natural stop:** propose the clear (`/orchestra:close-wave <name>`).
- **PR ready:** run the merge checklist in `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator/checklists.md`.

Finally, write the same table, with the date and time, to `.orchestra/status.md` (rewrite it each round, never append). That file is not versioned (`/orchestra:init` adds `.orchestra/` to `.gitignore`), so the round never needs a commit; nobody commits to the integration branch directly.
