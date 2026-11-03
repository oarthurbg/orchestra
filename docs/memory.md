# Memory and handoff

orchestra keeps no memory outside the repository. Everything a session needs to pick work back up is in a few files, committed like code, so any session can read them, they follow the branch, and they show in the diff. Agents keep no memory of their own, so their briefings stay reproducible.

[README](../README.md) · [Setup](setup.md) · [Commands](commands.md) · [Agents](agents.md) · [Stages, modes and skills](stages.md) · **Memory and handoff** · [The band](band.md) · [The liveview](liveview.md) · [Benchmarks](benchmarks.md)

| File | What it holds | Who writes it | Read by |
| --- | --- | --- | --- |
| `docs/HANDOFF.md` | The project's current state, how it works, what comes next | the maestro, through docs PRs | every session |
| `docs/workstreams/<name>.md` | One workstream's handoff note: where it stands and what is next | its principal | the maestro, and the principal after a clear |
| `docs/lessons.md` | One line per problem that must not happen twice | the maestro, through docs PRs | the planner, and briefings |
| "Rules from lessons" in `CLAUDE.md` | Lessons that apply to most tasks | the maestro, on the owner's yes | every agent |
| `docs/decisions.md` | Spec changes and owner decisions, dated | principals and the maestro | searched, never read whole |
| `.orchestra/status.md` | The live status table and the maestro's resume block | `/orchestra:status` | the maestro (not versioned) |

## The HANDOFF

The single entry point: every session reads it first. Because every session reads it, it stays under about 12 KB:

- "Where we are": the current state and the last 5 merges. Older ones are in git and the PRs.
- "Next workstreams": one line per item, with a link to its spec or issue.
- "How we work": only what this project adds to or changes in orchestra's rules.

Details go in the spec, the decisions log or the handoff note, never out of the repository. `/orchestra:close-wave` checks the size on the integration branch each time the maestro runs it. Past 12 KB, the next docs PR trims it: the maestro writes the list of what stays, moves or goes, and the `mechanic` applies only that list, since a summary made on its own drops facts.

## Handoff notes

Each workstream keeps a note on its own branch, from a fixed template ([`orchestra:handoff-note`](../plugins/orchestra/skills/handoff-note/SKILL.md)): a status line the maestro's status round reads, then 8 short sections (current task, last commit, worktrees, test data, next steps, decisions, what waits on the owner, subagent modes). The principal updates it at the end of every wave and before asking for a clear. The last commit before merge deletes it; its summary goes into the HANDOFF and the decisions log.

The same writing rules apply to the note, the HANDOFF and the maestro's resume block:

- The latest state wins: drop what it replaced.
- Work still running is pending, never done.
- Copy exact text (errors, paths, commands, ids, numbers), never rounded or reworded: a later session searches for those words.
- An instruction with a condition stays word for word; owner decisions keep the owner's words and the date.
- Nothing made up: "unknown" rather than a guessed path, hash or date.

## Resuming after a clear

A session that starts after a clear, or takes over a workstream, follows the note's clean-session checklist. Before trusting the note, it compares the note's last commit with `git log` and runs `git status`: newer commits or uncommitted changes mean the session before stopped without updating it, often on a usage limit, so it reads those first and fixes the note. A new session takes over only once the one before it has stopped, since two sessions in one worktree overwrite each other's work.

After the maestro's context is compacted, orchestra's hook rebuilds from disk what still waits on it (unanswered messages, `waiting on:` lines in the notes), and the maestro answers each one before anything else.

## Lessons

`docs/lessons.md` holds one dated line per problem: the area, what to do or never do and why, and the PR or workstream it came from. Principals and reviewers propose lessons; the maestro adds them.

- **What goes in:** a problem that happened, can happen again in another workstream, and has a do or a never-do someone can check. A one-off setup failure, a claim that a tool is broken, or a story stays out.
- **Once only:** a lesson seen again gets the new date on its line, not a second line. A lesson that turns out wrong is deleted.
- **Promotion:** a lesson seen at least twice that applies to most tasks can move into "Rules from lessons" in `CLAUDE.md`, which every agent reads. The maestro proposes it in a status round and the owner approves each one. At most 15 rules, one or two lines each, so `CLAUDE.md` stays short enough to be followed.
- **Contradiction check:** between releases, a read-only reviewer compares the lessons, the HANDOFF, the rules and the decisions log, and reports only entries that contradict each other, entries a later decision made stale, and duplicates. The maestro decides each fix and the `mechanic` applies it in a docs PR.

## In another language

The docs can be in any language. The file names, labels and headings orchestra's tools read stay as the templates write them (`Status:`, `Plan:`, `### Task N:`, `## Where we are`, the `docs/` paths). See [Docs in another language](setup.md#docs-in-another-language).
