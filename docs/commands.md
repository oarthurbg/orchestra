# Commands

What each orchestra command does and when to run it. In Claude Code, `/orchestra:help` lists them and `/orchestra:help <command>` explains one.

[README](../README.md) · [Setup](setup.md) · **Commands** · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [Memory and handoff](memory.md) · [The band](band.md) · [The liveview](liveview.md) · [Benchmarks](benchmarks.md)

| Command | Run it in | Use |
| --- | --- | --- |
| [`/orchestra:init`](#orchestrainit) | Your main session | Set orchestra up in a project, once. |
| [`/orchestra:start-workstream`](#orchestrastart-workstream) | The maestro | Open a workstream with its own branch, worktree and session, or adopt work already on a branch. |
| [`/orchestra:status`](#orchestrastatus) | The maestro | One table of every workstream and what needs you. |
| [`/orchestra:codemap`](#orchestracodemap) | The maestro | Map an existing codebase before planning work on it. |
| [`/orchestra:cost`](#orchestracost) | Any session | Where the project's tokens went, per branch and per session. |
| [`/orchestra:close-wave`](#orchestraclose-wave) | A principal or the maestro | Finish a wave of tasks and clear a full session. |
| [`/orchestra:liveview`](#orchestraliveview) | Any session | A page with limits, progress and ETAs. |
| [`/orchestra:settings`](#orchestrasettings) | Any session | Show or change orchestra's settings. |
| [`/orchestra:help`](#orchestrahelp) | Any session | This guide, in the chat. |

The maestro is your main session, which plans and coordinates. A principal is the session that runs one workstream. See [Agents](agents.md).

## `/orchestra:init`

```text
/orchestra:init
```

Sets up orchestra in the current project. Run it once in your main session, then load the `orchestra:maestro` skill there.

It reads the project first (scripts, test runner, branches, dev server, data store) and proposes values. Then it adds:

- **`CLAUDE.md`:** "How we work", "Project settings", "Owner authorizations" and "Rules from lessons". Every authorization starts at `ask`. If your docs are in another language, it records that and lists any file or heading that breaks the names orchestra's tools read (a translated `## Next workstreams`, `### Tarefa N:`), renaming them only on your yes. See [Docs in another language](setup.md#docs-in-another-language).
- **`docs/HANDOFF.md`**, **`docs/workstreams/`**, **`docs/decisions.md`**, **`docs/lessons.md`** and **`docs/superpowers/specs/`**, when missing.
- **`.orchestra/`** in `.gitignore`, for the live files the band and status rounds write.
- **Test data commands** for your data store, or `none`.
- **A branch guard,** if you accept: a pre-push hook that refuses direct pushes to your integration and production branches.

It shows every change to an existing file before making it, never changes your Claude Code settings (it lists the [recommended ones](setup.md#recommended-settings)), and commits nothing unless you ask.

## `/orchestra:start-workstream`

```text
/orchestra:start-workstream <name> <one-line goal>
/orchestra:start-workstream invoices Let customers download their invoices as PDF
/orchestra:start-workstream search --adopt feature/search Finish the search page
```

Opens a new workstream. Run it in the maestro. The name becomes the branch: lowercase letters, digits, `_` and `-`.

With `--adopt <branch>`, the workstream takes over work already on that branch instead of starting a new one. The branch keeps its name and its commits; nothing on it is reset or rebased. The principal's first job is a spec of what is built and what is left, which you confirm before any new code. The maestro offers this when it [takes stock of an ongoing project](setup.md#already-have-a-project).

First it checks that the goal does not overlap an open spec or workstream, that no other workstream is changing the same data schema, and that the machine and your token limits have room. Then it:

- creates a worktree on a new branch from your integration branch, next to the main checkout (when adopting, on the existing branch, or reuses the worktree it already has);
- creates the workstream's test data and picks a free dev server port, when the project has them;
- adds a row to `.orchestra/workstreams.md`;
- starts the principal's session in the worktree with a briefing, at the level of "Start a new principal session" in your owner authorizations. Outside the desktop app, it prints the briefing for you to paste.

## `/orchestra:status`

```text
/orchestra:status
```

A status round. Run it in the maestro whenever you want to know how things are going. It reads only what exists (band reports, handoff notes, PRs and CI) and dispatches no agents, so it is cheap. It answers with one table:

| Workstream | State | Context | Stage and task | PR and CI | Waiting on owner | Next |
| --- | --- | --- | --- | --- | --- | --- |

Then two lists: **Needs you** (decisions and approvals, most urgent first, with the session to answer in) and **I'll do next** (with each action's authorization level). It also nudges stalled sessions, proposes clearing any session at 250k tokens or more (the maestro itself at 200k or at the end of a wave), and runs the merge checklist on a ready PR. The table is also saved to `.orchestra/status.md`, which is not committed.

## `/orchestra:codemap`

```text
/orchestra:codemap
```

Maps a codebase that already exists, so every plan starts from how it is really built. The maestro runs it once when it [takes stock of an ongoing project](setup.md#already-have-a-project); run it again yourself after the code has moved a lot.

- A script reads the folders, entry points, which folders import which, the tests, and the last 12 months of git history: the files that change most and the files with the most fix commits. It costs no tokens and records no names.
- The explorer turns that into `docs/codebase-map.md`: how it is built, its parts, its conventions, where the risk is, and a little history. It arrives through a docs PR.
- Planners and principals read the map before they plan. A task that changes a file listed under Risk is reviewed as `sensitive`.

The map does not refresh itself. The raw facts stay in `.orchestra/codemap.json`, which is not committed.

## `/orchestra:cost`

```text
/orchestra:cost
/orchestra:cost 7
```

Shows where the project's tokens went, from Claude Code's own transcripts on this computer: one table per branch and one per session, for all time or the last few days. It covers the main checkout and every worktree beside or under it, subagents included, and counts each model request once.

The numbers are weighted by what each kind of token costs (input 1, cache write 1.25 for 5 minutes or 2 for an hour, cache read 0.1, output 5), so they compare sessions but are not dollars. A long-lived maestro often tops the list without writing any code: every wake re-reads its whole context, which is why it clears at the end of each wave.

## `/orchestra:close-wave`

```text
/orchestra:close-wave
/orchestra:close-wave invoices
```

Closes a wave of tasks, so a long session can be cleared without losing its place.

- **In a principal,** no argument: waits for running agents, checks the context size, commits the updated handoff note and reports to the maestro. Below 250k tokens it carries on; above, it waits for the maestro.
- **In the maestro,** with the workstream's name: above 250k tokens and at a natural stop, it confirms the handoff note is current, clears the session and briefs it to resume. Below 250k it does nothing. If the PR is merged and no work remains, it leaves the session idle for the app to archive after a day. Each time, it also checks the size of `docs/HANDOFF.md` on the integration branch: above 12 KB, the next docs PR trims it (see [Memory and handoff](memory.md#the-handoff)).

## `/orchestra:liveview`

```text
/orchestra:liveview
/orchestra:liveview phone
/orchestra:liveview stop
```

Starts or stops the liveview, a local page with your limits, each workstream's progress and ETAs. It uses no LLM tokens, needs Node 18 or newer, and needs `/orchestra:init` run first. See [The liveview](liveview.md).

- **No argument:** starts it, or finds the one running for this project, and gives you its address.
- **`phone`:** also opens it to your devices on Tailscale and gives a second address for your phone. With `/orchestra:settings tailscale on`, every start does this.
- **`stop`:** stops it.

A running liveview keeps its mode. To switch it to the phone, stop it and start it again with `phone`.

## `/orchestra:settings`

```text
/orchestra:settings
/orchestra:settings tailscale on
/orchestra:settings cacheMinutes 5
```

Shows or changes orchestra's settings, in any Claude Code window, including the desktop app and Remote Control.

- **No argument:** a table of the settings, their values and what each does.
- **A setting and a value:** changes it. `tailscale` is short for `liveviewTailnet`. On/off settings take `on`, `off`, `true`, `false`, `yes` or `no`; number settings take a positive number. A wrong name or value changes nothing.

A change takes effect in new sessions, or after `/reload-plugins`. The settings are listed in [orchestra's settings](setup.md#orchestras-settings).

## `/orchestra:help`

```text
/orchestra:help
/orchestra:help liveview
```

- **No argument:** your orchestra version, the command to run next in this project, the list of commands, and links to these docs.
- **A command's name:** how to use that command, with examples and a link to its section here.
