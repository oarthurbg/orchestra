# Setup

How to install, update and configure orchestra.

[README](../README.md) · **Setup** · [Commands](commands.md) · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [The band](band.md) · [The liveview](liveview.md) · [Benchmarks](benchmarks.md)

## Install

Install at user scope (the default). Principals work in their own worktrees, so a project-scope install reaches them only if `.claude/settings.json` is committed.

**With the script** (needs Node 18 or newer). From a terminal:

```bash
npx orchestra-install
```

It adds this marketplace, installs orchestra, then installs each companion plugin listed below, skipping any you already have from any marketplace. It prints what it skipped. Other ways to run it:

- `npx orchestra-install --dry-run`: show what it would run, change nothing.
- `npx github:oarthurbg/orchestra`: fetch the script from this repository instead of npm. The [npm package](https://www.npmjs.com/package/orchestra-install) is the same [`install.mjs`](../install.mjs), published by a [workflow](../.github/workflows/publish-installer.yml).
- Without npx: `curl -fsSL https://raw.githubusercontent.com/oarthurbg/orchestra/main/install.mjs | node --input-type=module` (in PowerShell, use `irm` in place of `curl -fsSL`).

**By hand,** in a Claude Code session:

```
/plugin marketplace add oarthurbg/orchestra
/plugin install orchestra@orchestra
```

Then the companion plugins the workflow uses. Each is fetched from its own repository:

```
/plugin install superpowers@orchestra
/plugin install ponytail@orchestra
/plugin install impeccable@orchestra
/plugin install taste-skill@orchestra
/plugin install frontend-design@orchestra
/plugin install design@orchestra
/plugin install security-audit@orchestra
/plugin install playwright-cli@orchestra
```

From a shell, the same steps are `claude plugin marketplace add oarthurbg/orchestra` and `claude plugin install <name>@orchestra`.

Notes on the companions:

- Skip any you already have from another marketplace (for example `superpowers@claude-plugins-official`) or as a skill in `~/.claude/skills`: two copies load duplicate skills.
- `playwright-cli` is only for apps with a web UI, and also needs its CLI: `npm install -g @playwright/cli@latest`.
- `dataviz` (chart and dashboard design) is built into recent Claude Code versions.
- `claude-security` is an optional deep scan of finished code before a release.

**Then, in your project:**

1. Run `/orchestra:init`. It proposes the project settings and scaffolds the files (see [Commands](commands.md#orchestrainit)).
2. In your main session, load the `orchestra:maestro` skill. Its "First session" steps confirm the settings and owner authorizations with you, write the first backlog and open the first workstreams with `/orchestra:start-workstream`.
3. Ask "how is it going?" any time. The maestro answers with `/orchestra:status`.

### Already have a project?

orchestra works on a project already under way, not only on new ones.

- `/orchestra:init` reads the code first (scripts, tests, branches, data) and adds its sections to your existing `CLAUDE.md` without replacing it. It never overwrites a file without asking.
- If the project has only one long-lived branch, such as `main`, init offers to create an integration branch from it, or to use that one branch for both settings.
- In the first session, the maestro takes stock of the work already under way: open PRs, branches not yet merged, worktrees, open issues and any roadmap file. It shows you one table with a suggested action for each: **adopt** it as a workstream, **let it finish** as it is, put it in the **backlog**, or **close** it. You decide every row; it closes nothing on its own.
- An adopted branch becomes a workstream with [`/orchestra:start-workstream --adopt`](commands.md#orchestrastart-workstream). Its principal writes a spec of what is built and what is left, you confirm it, and the normal plan and reviews take over from there.

## Updating

Claude Code installs a new version only when the version number changes, and every release bumps it. Auto-update is off by default for marketplaces you add yourself. Pick one:

- **Automatic:** run `/plugin`, open **Marketplaces**, select `orchestra` and choose **Enable auto-update**. This covers every plugin from this marketplace.
- **From the band:** when a newer orchestra is out, the band offers **Changelog**, **Update** and **Later**. See [The band](band.md#updates).
- **By hand:** `claude plugin update orchestra@orchestra`, or **Update now** on the **Installed** tab of `/plugin`. Companion plugins update the same way with their own name.

A new version loads in your next session, or after `/reload-plugins`. A running liveview keeps the old version until you restart it: `/orchestra:liveview stop`, then `/orchestra:liveview`.

## Requirements

- **Claude Code desktop app** (Code tab), for starting, messaging, measuring, clearing and archiving sessions. In the plain CLI the roles and agents still work, but you do those steps by hand.
- **Claude Code 2.1.309 or newer** for the band. Older versions were not tested.
- **git** with worktrees, and the **GitHub CLI** (`gh`) for PRs.
- **Node 18 or newer** for the install script, the liveview and code navigation.
- **Docker** only if you pick the optional Postgres-in-Docker test data example.

## Code navigation

The explorer and planner answer "who calls X", "what breaks if X changes" and "how is X reached" with a language server instead of grep. It needs no build step and no index: it reads the working tree, so each worktree sees its own branch.

- **TypeScript and JavaScript:** nothing to install. It uses the project's own `typescript` package.
- **Python:** needs Pyright on `PATH` (`npm install -g pyright` or `pip install pyright`). `/orchestra:init` checks for it.
- **Anything else,** or when the server fails: the agents use grep and say so.

Savings and limits are in [Benchmarks](benchmarks.md).

## orchestra's settings

| Setting | Default | What it does |
| --- | --- | --- |
| `cacheMinutes` | 60 | Your prompt cache lifetime, for the band's [keep-warm](band.md#keep-warm). Use 5 for API keys and overage. |
| `warmMaxHours` | 2 | Stop keeping the cache warm for a subagent that has run this long. |
| `liveviewTailnet` | off | Open the liveview to your own devices on Tailscale, such as your phone. See [The liveview](liveview.md#on-your-phone). |

Show or change them with [`/orchestra:settings`](commands.md#orchestrasettings), in any Claude Code window:

```text
/orchestra:settings tailscale on
/orchestra:settings cacheMinutes 5
```

From a terminal, `claude plugin configure orchestra@orchestra` shows the values; `/plugin configure orchestra@orchestra` in a terminal session opens them as a menu. To set values from a script, pipe JSON with each value as text:

```bash
echo '{"liveviewTailnet":"true"}' | claude plugin configure orchestra@orchestra --values-stdin
```

A change takes effect in sessions started after it, or after `/reload-plugins`.

## Recommended settings

orchestra never changes these for you. Apply them yourself.

- **Bypass permissions, in the project only.** With 4 to 6 sessions and their subagents, approval prompts would stall the work. Set it with the desktop app's permission-mode picker per session, or `"permissions": { "defaultMode": "bypassPermissions" }` in the project's `.claude/settings.local.json`. Never in your global settings. Claude Code then never asks, so two gates take over:
  - **Owner authorizations** in the project's `CLAUDE.md`: `ask`, `tell` or `auto` for merges, releases, hotfixes, clears, archiving and new sessions. They start at `ask`. Anything that needs admin rights, deletes data or branches, or touches credentials, money or production data is always `ask`.
  - **The branch guard**, offered by `/orchestra:init`: a `pre-push` hook that refuses direct pushes to your integration and production branches. It is per clone and `--no-verify` skips it, so also turn on branch protection on GitHub for both branches.

  Use bypass only in repositories you trust, keep real credentials out of the repository, and don't run it where an agent could reach production data you can't afford to lose.

- **Auto-compact safety net at 600k tokens.** In `~/.claude/settings.json`:

  ```json
  {
    "autoCompactWindow": 600000,
    "modelSettings": { "claude-opus-5-5": { "autoCompactWindow": 600000 } }
  }
  ```

  A value under `modelSettings` beats the top-level key for that model, and `/autocompact` writes one there, so check that entry too. It applies to new or restarted sessions. The normal rule clears a principal earlier, at 250k tokens at the end of a wave; this net catches a missed check.

  In the desktop app the maestro cannot get a larger window than principals: the window is per model, and worktree sessions read project settings from the main checkout. In the plain CLI, start the maestro with `claude --autocompact 800000` (that launch only).

  If the maestro compacts anyway, orchestra's `SessionStart` hook lists what still waits on it: unanswered messages from other sessions (last 24 hours), sessions waiting in their band reports, and handoff notes waiting on someone. The maestro then answers each one still open.

- **Auto-archive on PR close: off** (desktop app setting). Archiving kills a session and its background agents, and unarchiving does not bring them back. Principals keep working after their spec and plan PRs merge. The maestro archives finished sessions itself.

- **Session models.** Subagents set their own model (see [Agents](agents.md)). For the sessions:
  - **maestro:** Opus at medium effort. Its turns are short.
  - **principals:** Opus at high effort. Raise to xhigh for a hard spec or long debugging, then lower it again.

- **Ponytail modes.** Every session starts in full. The principal switches mode per stage, as [Stages, modes and skills](stages.md) lists.

## Credits

orchestra builds on open-source plugins by their authors. Each one, its license and where it enters the flow are listed in [Credits](stages.md#credits).

