---
name: handoff-note
description: Fixed template for a workstream's handoff note and the checklist a clean session follows to resume from it. Use when a principal closes a wave, before its context is cleared, and when a cleared or new session picks a workstream back up.
---

# Handoff note

## Where it lives

`docs/workstreams/<workstream>.md`, committed on the workstream's branch. A local commit is enough; it goes out with the normal push. It lives in the repository, not in an app folder, so any session (including a cloud session) can read it, it follows the branch, and it shows in the diff.

The last commit of the workstream, before merge, deletes the note. The lasting summary goes into `docs/HANDOFF.md` and the decisions log.

## Status line

The line right under the title is what the maestro's status round reads, so keep it current: update it at the end of every wave, when you start waiting on the owner, and before asking for a clear.

`Status: <running | idle | waiting on owner> · context <N>k · <stage>[, task <N> of <M>] · PR <none | #N open | #N ready> · waiting on: <none | what, for whom> · updated <YYYY-MM-DD HH:MM>`

Leave out the task until the plan exists (`spec`, then `plan, task 1 of 12`). Context is the measured size (see `/orchestra:close-wave` step 2), never a guess. `updated` is the real local time (`date`), never a placeholder: the status round uses it to spot stalled sessions.

It is also how a principal reports without the desktop app: the maestro reads it straight from the worktree folder.

## Template

Copy `${CLAUDE_PLUGIN_ROOT}/templates/handoff-note.md` and keep the status line and its 8 sections, each short:

1. Current task (plan path and task number)
2. Last commit on the workstream branch
3. Worktrees
4. Test data and dev server port (or none)
5. Next steps, in order
6. Accepted decisions (with the date, and whether they are already in the spec and the decisions log)
7. Pending items for the owner
8. Subagent modes (model, effort and ponytail mode for each stage)

Write facts, not history. A section with nothing in it says "none".

## Clean-session checklist

A session that starts after a clear, or a new session taking over a workstream, does exactly this, in order:

1. Read the handoff note.
2. Read the workstream's section in `docs/HANDOFF.md`.
3. Read the spec.
4. Read only the plan task in progress, not the whole plan.
5. Open the decisions log only by searching for the workstream's section, never whole.
6. Continue from the task the note names.
