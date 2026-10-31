# Commands

How to use each of orchestra's commands: what it does, when to run it, and what it changes. In Claude Code, `/orchestra:help` lists them, and `/orchestra:help <command>` explains one in the chat.

[README](../README.md) · [Setup](setup.md) · **Commands** · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [The band](band.md) · [The liveview](liveview.md) · [Benchmarks](benchmarks.md)

| Command | Run it in | Use |
| --- | --- | --- |
| [`/orchestra:init`](#orchestrainit) | Your main session | Set orchestra up in a project, once. |
| [`/orchestra:start-workstream`](#orchestrastart-workstream) | The maestro | Open a workstream with its own branch, worktree and session. |
| [`/orchestra:status`](#orchestrastatus) | The maestro | One table of every workstream and what needs you. |
| [`/orchestra:close-wave`](#orchestraclose-wave) | A principal or the maestro | Finish a wave of tasks and clear a full session. |
| [`/orchestra:liveview`](#orchestraliveview) | Any session | A page with limits, progress and ETAs. |
| [`/orchestra:settings`](#orchestrasettings) | Any session | Show or change orchestra's settings. |
| [`/orchestra:help`](#orchestrahelp) | Any session | This guide, in the chat. |

The maestro is your main session, the one that plans and coordinates. A principal is the session that runs one workstream. [Agents](agents.md) has the full picture.

## `/orchestra:init`

Sets up the orchestra workflow in the current project. Run it once, in your main session, then load the `orchestra:maestro` skill there.

```text
/orchestra:init
```

It looks at the project first (scripts, test runner, branches, dev server, how it stores data) and proposes values instead of asking from scratch. Then it adds:

- **`CLAUDE.md`:** "How we work", "Project settings" and "Owner authorizations". Every authorization starts at `ask`; it changes one only if you say so.
- **`docs/HANDOFF.md`**, **`docs/workstreams/`**, **`docs/decisions.md`**, **`docs/lessons.md`** and **`docs/superpowers/specs/`**, when missing.
- **`.orchestra/`** in `.gitignore`, for the live files the band and status rounds write.
- **Test data commands,** from the matching recipe for your data store, or `none`.
- **A branch guard,** if you accept it: a pre-push hook that refuses direct pushes to your integration and production branches.

It never overwrites a file without showing you the change first, changes none of your own Claude Code settings (it tells you what is recommended), and commits nothing unless you ask.

## `/orchestra:start-workstream`

Opens a new workstream. Run it in the maestro.

```text
/orchestra:start-workstream <name> <one-line goal>
/orchestra:start-workstream invoices Let customers download their invoices as PDF
```

The name becomes the branch name: lowercase letters, digits, `_` and `-`. Before it creates anything, it checks that the goal does not overlap an open spec or workstream, that no other workstream is already changing the same data schema, and that the machine and your token limits have room. Then it:

- creates a worktree on a new branch from your integration branch, next to the main checkout;
- creates the workstream's test data and picks a free dev server port, when the project has them;
- adds a row to `.orchestra/workstreams.md`;
- starts the principal's session in the worktree with a briefing (outside the desktop app, it prints the briefing for you to paste), at the level "Start a new principal session" has in your owner authorizations.

## `/orchestra:status`

A status round. Run it in the maestro whenever you want to know how things are going.

```text
/orchestra:status
```

It reads only what already exists (the band's session reports, each workstream's handoff note, PRs and CI) and dispatches no agents, so it is cheap. It answers with one table:

| Workstream | State | Context | Stage and task | PR and CI | Waiting on owner | Next |
| --- | --- | --- | --- | --- | --- | --- |

Then two short lists: **Needs you** (decisions and approvals, most urgent first, with the session to answer in) and **I'll do next** (what the maestro will do, each with its authorization level). It also nudges stalled sessions, proposes clearing a session at 250k tokens or more, and runs the merge checklist on a PR that is ready. The same table goes to `.orchestra/status.md`, which is not committed.

## `/orchestra:close-wave`

Closes a wave of tasks, so a long session can be cleared without losing its place.

```text
/orchestra:close-wave
/orchestra:close-wave invoices
```

- **In a principal,** with no argument: it waits for running agents, checks the session's context size, updates and commits the handoff note, and reports to the maestro. Below 250k tokens it carries on; above, it waits for the maestro.
- **In the maestro,** with the workstream's name: above 250k tokens and at a natural stop, it confirms the handoff note is current, clears the session and sends it back to where it was. Below 250k it does nothing. A workstream whose PR is merged and has no more work is archived instead.

## `/orchestra:liveview`

Starts or stops the liveview: a local page with your limits, each workstream's progress and ETAs. It uses no LLM tokens and needs Node 18 or newer. [The liveview](liveview.md) explains the page.

```text
/orchestra:liveview
/orchestra:liveview phone
/orchestra:liveview stop
```

- **No argument:** starts it, or finds the one already running for this project, and gives you its address.
- **`phone`:** also opens it to your own devices on Tailscale and gives you a second address for your phone. With `/orchestra:settings tailscale on`, every start does this.
- **`stop`:** stops it.

The project needs orchestra set up first. A liveview already running keeps its mode: to switch it to the phone, stop it and start it again with `phone`.

## `/orchestra:settings`

Shows or changes orchestra's settings. It works in every Claude Code window, the desktop app and Remote Control included.

```text
/orchestra:settings
/orchestra:settings tailscale on
/orchestra:settings cacheMinutes 5
```

- **No argument:** a table of the settings, their values and what each does.
- **A setting and a value:** changes it. `tailscale` is short for `liveviewTailnet`. On and off settings take `on`, `off`, `true`, `false`, `yes` or `no`; number settings take a positive number. An unknown setting or a value that does not fit changes nothing.

A change takes effect in sessions started after it, or after `/reload-plugins`. [orchestra's settings](setup.md#orchestras-settings) lists every setting.

## `/orchestra:help`

A short guide in the chat.

```text
/orchestra:help
/orchestra:help liveview
```

- **No argument:** your orchestra version, the command to run next in this project (`/orchestra:init` when it is not set up, otherwise `/orchestra:status` or `/orchestra:start-workstream`), the list of commands, and links to these docs.
- **A command's name:** how to use that command, with examples and a link to its section here.
