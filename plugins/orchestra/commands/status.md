---
description: (Maestro) Status round: one table of every workstream, what needs the owner, and what you will do next
---

You are the maestro (skill `orchestra:maestro`). Run a status round. Use only data that already exists; do not dispatch agents or ask sessions for reports to build it.

## Gather

For each open workstream (the registry in `.orchestra/workstreams.md`):

1. **Session state and context:** first read `.orchestra/sessions/*.json`, the band's per-session reports: state, context, stage, PR and update time, at no token cost. For a session whose report is missing or older than 30 minutes, fall back to the desktop app: the linked session list and `get_usage` per session; `list_events` to spot a session with pending work that has gone quiet. Without the app, read the status line of the workstream's handoff note and the time of its last commit.
2. **Status line:** the `Status:` line at the top of `<worktree>/docs/workstreams/<name>.md` (state, context, stage and task, PR, waiting on, updated). Read it straight from the worktree folder.
3. **PR and CI:** `gh pr list --state open` and `gh pr checks <number>` for the workstream's PR. With no GitHub remote, write `no remote` in that column; the merge checklist needs one.

## Report

Always in this shape, nothing more:

| Workstream | State | Context | Stage and task | PR and CI | Waiting on owner | Next |
| --- | --- | --- | --- | --- | --- | --- |

- **State:** running, idle, waiting on owner, or stalled (pending work and no activity for 30 minutes: no report update, no commit, no status line update). On the first round there is no earlier round to compare, so judge by those times alone.
- **Context:** in thousands of tokens; mark 250k or more with ⚠.
- **Stage and task:** brainstorm, spec, plan, build, review or PR, plus "task N of M" from the plan's checkboxes.

Then two short lists:

- **Needs you:** decisions, 👤 steps and approvals, most urgent first, each with the session to answer in.
- **I'll do next:** what you will do on your own, each marked with its level from "Owner authorizations" in `CLAUDE.md` (for example "merge the PR for `<name>` (ask)"). `auto` items appear only in the table's Next column, not in this list.

## Act

- **Stalled session:** tell it to resume (`SendMessage` to its session; without the desktop app, ask the owner to type it there), or check its worktree and output first if an agent died with the session.
- **A principal at 250k or more at a natural stop** that has no alarm (no entry in `.orchestra/alarms.json`): clear it with `/orchestra:close-wave <name>`. One with an alarm clears itself.
- **Your own context** at 200k or more, or a wave just ended: clear yourself at this natural stop, as "Context and clearing" in the maestro skill says.
- **Authorizations:** if any of the three opening and clearing lines in "Owner authorizations" is missing or `ask`, propose `auto` for it once, in "Needs you", and never again after the owner answers. Change `CLAUDE.md` only on the owner's word, through a docs PR, dated in `docs/HANDOFF.md`.
- **PR ready:** run the merge checklist in `${CLAUDE_PLUGIN_ROOT}/skills/maestro/checklists.md`.
- **Registry:** set each row's Stage in `.orchestra/workstreams.md` to the stage in its status line, so the registry never lags behind the note.

Finally, write the same table, with the date and time, to `.orchestra/status.md` (the round rewrites the table and the `## Resume` block under it, never appending). That file is not versioned (`/orchestra:init` adds `.orchestra/` to `.gitignore`), so the round never needs a commit; nobody commits to the integration branch directly.
