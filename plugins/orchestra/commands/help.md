---
description: What orchestra's commands do and how to use one, which to run next in this project, and where the docs are
argument-hint: "[command]"
---

Give the owner a short guide to orchestra. Read only what each step names; change nothing. The guide for every command is at https://github.com/oarthurbg/orchestra/blob/main/docs/commands.md, each command in its own section: `#orchestra` followed by the command's name, for example `#orchestraliveview`.

## With a command's name in `$ARGUMENTS`

Take the name with or without `/orchestra:` in front, for example `liveview` or `/orchestra:liveview`. If it is not one of the commands listed below, say so and give the list.

Otherwise read `${CLAUDE_PLUGIN_ROOT}/commands/<name>.md`, the installed command itself, and explain it to the owner, not to an agent:

- one line on what it does and which session to run it in (the maestro, a principal, or any session);
- its arguments, with two or three example lines in a `text` block;
- what it creates or changes, and what it asks before doing;
- a link to its section in the guide.

Keep it under 15 lines. Leave out the steps that are only instructions for the agent running it.

## With no arguments

1. **Version:** read `version` from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`.
2. **Where this project stands:** it is set up when `docs/HANDOFF.md` exists and `CLAUDE.md` has an "Owner authorizations" section.
   - Not set up: the next step is `/orchestra:init`, then loading the `orchestra:maestro` skill in this session.
   - Set up: the next step is `/orchestra:status` for where every workstream stands, or `/orchestra:start-workstream <name> <goal>` to open one.
3. **Reply** with, in this order:
   - One line: orchestra and its version.
   - The next step from step 2, as one or two lines.
   - A table of the commands, each name linking to its section in the guide, with its one-line use:
     - `/orchestra:init`: set orchestra up in this project.
     - `/orchestra:start-workstream <name> <goal>`: (maestro) open a workstream with its own worktree and session.
     - `/orchestra:status`: (maestro) one table of every workstream and what needs you.
     - `/orchestra:close-wave`: finish a wave of tasks and update the handoff note.
     - `/orchestra:liveview [stop | phone]`: a local page with limits, progress and ETAs.
     - `/orchestra:settings [<setting> <value>]`: show or change orchestra's settings, for example `/orchestra:settings tailscale on`.
     - `/orchestra:help [command]`: this guide, or how to use one command.
   - One line: `/orchestra:help <command>` explains one, for example `/orchestra:help liveview`.
   - The docs, as links: [Commands](https://github.com/oarthurbg/orchestra/blob/main/docs/commands.md), [Setup](https://github.com/oarthurbg/orchestra/blob/main/docs/setup.md), [The band](https://github.com/oarthurbg/orchestra/blob/main/docs/band.md), [The liveview](https://github.com/oarthurbg/orchestra/blob/main/docs/liveview.md), [Agents](https://github.com/oarthurbg/orchestra/blob/main/docs/agents.md), [Changelog](https://github.com/oarthurbg/orchestra/blob/main/CHANGELOG.md).
