---
description: What orchestra's commands do, which one to run next in this project, and where the docs are
---

Give the owner a short guide to orchestra. Read only what each step names; change nothing.

1. **Version:** read `version` from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`.
2. **Where this project stands:** it is set up when `docs/HANDOFF.md` exists and `CLAUDE.md` has an "Owner authorizations" section.
   - Not set up: the next step is `/orchestra:init`, then loading the `orchestra:maestro` skill in this session.
   - Set up: the next step is `/orchestra:status` for where every workstream stands, or `/orchestra:start-workstream <name> <goal>` to open one.
3. **Reply** with, in this order:
   - One line: orchestra and its version.
   - The next step from step 2, as one or two lines.
   - A table of the commands, each with its one-line use:
     - `/orchestra:init`: set orchestra up in this project.
     - `/orchestra:start-workstream <name> <goal>`: (maestro) open a workstream with its own worktree and session.
     - `/orchestra:status`: (maestro) one table of every workstream and what needs you.
     - `/orchestra:close-wave`: finish a wave of tasks and update the handoff note.
     - `/orchestra:liveview [stop | phone]`: a local page with limits, progress and ETAs.
     - `/orchestra:settings [<setting> <value>]`: show or change orchestra's settings, for example `/orchestra:settings tailscale on`.
     - `/orchestra:help`: this guide.
   - The docs, as links: [Setup](https://github.com/oarthurbg/orchestra/blob/main/docs/setup.md), [The band](https://github.com/oarthurbg/orchestra/blob/main/docs/band.md), [The liveview](https://github.com/oarthurbg/orchestra/blob/main/docs/liveview.md), [Agents](https://github.com/oarthurbg/orchestra/blob/main/docs/agents.md), [Changelog](https://github.com/oarthurbg/orchestra/blob/main/CHANGELOG.md).
