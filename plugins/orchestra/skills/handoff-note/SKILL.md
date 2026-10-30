---
name: handoff-note
description: Fixed template for a workstream's handoff note and the checklist a clean session follows to resume from it. Use when a workstream closes a wave, before its context is cleared, and when a cleared or new session picks a workstream back up.
---

# Handoff note

## Where it lives

`docs/workstreams/<workstream>.md`, committed on the workstream's branch. A local commit is enough; it goes out with the normal push. It lives in the repository, not in an app folder, so any session (including a cloud session) can read it, it follows the branch, and it shows in the diff.

The last commit of the workstream, before merge, deletes the note. The lasting summary goes into `docs/HANDOFF.md` and the decisions log.

## Template

Copy `${CLAUDE_PLUGIN_ROOT}/templates/handoff-note.md` and keep its 8 sections, each short:

1. Current task (plan path and task number)
2. Last commit on the integration worktree
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
