# Setup

Everything you need to install, update and tune orchestra. The [README](../README.md) has the short version.

[README](../README.md) · **Setup** · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [The band](band.md) · [The liveview](liveview.md) · [Benchmarks](benchmarks.md)

## Install

**With the script.** [`install.mjs`](../install.mjs) adds this marketplace, installs orchestra, then installs each plugin listed below unless you already have it from any marketplace. It installs at user scope and prints what it skipped. Run it from a terminal (it needs Node 18 or newer):

```bash
npx orchestra-install
```

npx downloads [`orchestra-install`](https://www.npmjs.com/package/orchestra-install) from npm: that package is this script and nothing else. To fetch it from this repository instead, run `npx github:oarthurbg/orchestra`. Add `--dry-run` to see what it would run without changing anything. Without npx, pipe it into node: `curl -fsSL https://raw.githubusercontent.com/oarthurbg/orchestra/main/install.mjs | node --input-type=module` (in PowerShell, `irm` in place of `curl -fsSL`).

**By hand,** in a Claude Code session:

```
/plugin marketplace add oarthurbg/orchestra
/plugin install orchestra@orchestra
```

Install it at user scope (the default). Principals work in their own worktrees, so a project-scope install reaches them only if `.claude/settings.json` is committed.

Then install the plugins the workflow uses. This marketplace lists them, fetched from their own upstream repositories (nothing is copied here):

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

Skip any you already have from another marketplace (for example `superpowers@claude-plugins-official`): two copies of one plugin load duplicate skills. From a shell, the same steps are `claude plugin marketplace add oarthurbg/orchestra` and `claude plugin install <name>@orchestra`.

`dataviz` (chart and dashboard design) is built into recent Claude Code versions, so there is nothing to install. If you already added `security-audit` or `playwright-cli` by hand to `~/.claude/skills`, skip their plugins. `playwright-cli` is only for apps with a web UI, and it also needs the CLI itself: `npm install -g @playwright/cli@latest`. `claude-security` is an optional deep scan of finished code before a release.

Then, in your project:

1. Run `/orchestra:init`. It looks at the project, proposes the "Project settings" (including test data commands that match your data store, or `none`), and scaffolds `CLAUDE.md` settings, `docs/HANDOFF.md` and `docs/workstreams/`.
2. In your main session, load the `orchestra:maestro` skill. Its "First session" steps confirm the settings and owner authorizations with you, write the first backlog and open the first workstreams with `/orchestra:start-workstream <name> <goal>`.
3. Ask "how is it going?" any time: the maestro answers with `/orchestra:status`, one table of every workstream plus what needs you.

## Updating

Claude Code installs a new version of orchestra only when its version number changes, and every release bumps it. Auto-update is off by default for marketplaces you add yourself, so pick one:

- **Automatic:** run `/plugin`, open **Marketplaces**, select `orchestra` and choose **Enable auto-update**. Claude Code then checks for new versions up to ten minutes after your first message in a session. This covers every plugin installed from this marketplace.
- **By hand:** run `claude plugin update orchestra@orchestra`, or choose **Update now** on the **Installed** tab of `/plugin`. The plugins listed above update the same way, with their own name in place of the first `orchestra`; they follow their authors' repositories.

A new version loads in your next session, or right away after `/reload-plugins`. A liveview that is already running keeps the old version until you restart it: `/orchestra:liveview stop`, then `/orchestra:liveview`.

## Requirements

- **Claude Code desktop app** (Code tab) for the session tools the workflow relies on: starting sessions, messaging between them, reading their context size, clearing and archiving them. In the plain CLI the roles and agents still work, but you start, brief, clear and archive sessions by hand.
- **Docker** only if you pick the optional Postgres-in-Docker test data example.
- **git** with worktrees, and the **GitHub CLI** (`gh`) for PRs.
- **Claude Code 2.1.309 or newer** for the band. Older versions were not tested.
- **Node 18 or newer** for the liveview and the code navigation command.

## Code navigation

The explorer and planner answer "who calls X", "what breaks if X changes" and "how is X reached" with a language server instead of sweeping files with grep. The command (`lsp/lsp.mjs`) prints each reference with its source line and the function around it, or the callers as a tree. It needs no build step and no index: it reads the working tree, so each worktree sees its own branch.

- **TypeScript and JavaScript:** nothing to install. It uses the project's own `typescript` package.
- **Python:** needs Pyright on `PATH` (`npm install -g pyright` or `pip install pyright`). `/orchestra:init` checks for it.
- **Anything else,** or when the server is missing or fails: the agents use grep and say so.

How much it saves, and where it breaks, is in [Benchmarks](benchmarks.md).

## Recommended settings

- **Bypass permissions, per project.** With 4 to 6 sessions and their subagents, approval prompts would stall the work all day, so orchestra is meant to run with the permission mode set to bypass, in the project only: the desktop app's permission-mode picker per session, or `"permissions": { "defaultMode": "bypassPermissions" }` in the project's `.claude/settings.local.json` (not in your global settings). Claude Code then never stops to ask, so these take over as the gates:
  - **Owner authorizations** in the project's `CLAUDE.md`: for merges, releases, hotfixes, clears, archiving and new sessions, `ask`, `tell` or `auto`. They start at `ask`. Anything that needs admin rights, deletes data or branches, or touches credentials, money or production data is always `ask`, for every session and subagent.
  - **The branch guard**, which `/orchestra:init` offers to install: a `pre-push` hook that refuses direct pushes to your integration and production branches. It is a local net (per clone, and skipped by `--no-verify`), so also turn on branch protection on GitHub for both branches.

  Use bypass permissions only in repositories you trust, keep real credentials out of the repository, and don't run it on a machine where an agent could reach production data you can't afford to lose.

- **Auto-compact safety net at 600k tokens.** In `~/.claude/settings.json`:

  ```json
  {
    "autoCompactWindow": 600000,
    "modelSettings": { "claude-opus-5-5": { "autoCompactWindow": 600000 } }
  }
  ```

  A window under `modelSettings` beats the top-level key in the same file for that model, and `/autocompact` writes one there, so check that entry too (or remove it). It applies to new or restarted sessions. The real rule is earlier: a principal above 250k tokens at the end of a wave writes its handoff note and gets cleared at a natural stop. The 600k net catches the case where nobody checked in time.

  The maestro cannot get a larger window than principals in the desktop app: the window is set per model, not per session, and a worktree session started from the app reads project settings from the main checkout's root, so a window in the main checkout's `.claude/settings.local.json` reaches every principal too. In the plain CLI, start the maestro with `claude --autocompact 800000`, which applies to that launch only.

  **After a compact.** Several principals reporting at once can push the maestro over its window. When it compacts, orchestra's `SessionStart` hook rebuilds what still waits on it from disk and puts the list in its context: messages from sessions it has not answered with `SendMessage` (from its own transcript, last 24 hours), waiting band reports in `.orchestra/sessions/`, and handoff notes whose status line waits on someone. The maestro then answers each one that is still open.
- **Auto-archive on PR close: off** (desktop app setting). Archiving a session kills its process and its background agents, and unarchiving does not bring them back. Principals open spec and plan PRs and keep working after those merge, so auto-archive would stop them mid-workstream. The maestro archives finished sessions itself, after checking nothing is running.
- **Session models.** Subagents carry their own model and effort (see [Agents](agents.md)); the sessions run on what you pick:
  - **maestro:** Opus at medium effort. Its turns are short (status rounds, checklists, merges): judgment matters, long thinking mostly spends plan limits.
  - **principals:** Opus at high effort, for brainstorming, specs and judging reviews. Raise it to xhigh for a hard spec or a long debugging stretch, then lower it again.
- **Ponytail modes per session.** Every session starts in full. The maestro stays in full. The principal switches its own mode per stage and states it in every subagent briefing: brainstorm and mockups off, spec lite, plan ultra, backend full, UI lite, infrastructure ultra, reviews off. The full table is in [`stages.md`](../plugins/orchestra/skills/maestro/stages.md).

## What's inside

```
plugins/orchestra/
  agents/      explorer, planner, implementer, implementer-advanced, mechanic,
               spec-reviewer, quality-reviewer, screenshotter, verifier
  skills/      maestro (with stages.md: modes, skills and reviews per stage,
               and checklists.md: merge, release and hotfix)
               principal, handoff-note, test-databases (test data recipes per data store,
               plus an optional, tested Postgres-in-Docker example)
  commands/    /orchestra:init, /orchestra:start-workstream, /orchestra:status,
               /orchestra:close-wave, /orchestra:liveview
  hooks/       the band above the prompt, and the pending-asks list after a compact
  liveview/    the local dashboard
  lsp/         the code navigation command
  templates/   CLAUDE.md (project settings, owner authorizations), HANDOFF.md, lessons.md,
               handoff-note.md, githooks/pre-push (branch guard)
install.mjs    the one-command install (package.json makes it the npx entry point)
bench/         the benchmark scripts and their raw results
docs/          these pages; index.html is the stack on one page
assets/        brand files and the README's pictures
```

Every project-specific value (branches, commands, dev server, test data commands, how agents sign in for browser checks) lives in one "Project settings" block in the project's `CLAUDE.md`, which `/orchestra:init` writes.

## Credits

orchestra only decides where each of these enters the flow. All credit for the skills themselves goes to their authors:

- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent (obra): brainstorming, plans, subagent-driven development, TDD, debugging, code review. MIT.
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert: the lite, full and ultra modes, review, debt and audit. MIT.
- [impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus: UI implementation craft, the detector and the finish reviewer. Apache-2.0.
- [taste-skill](https://github.com/Leonxlnx/taste-skill) by leonxlnx: art direction for mockups. MIT.
- [frontend-design](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design) by Anthropic: visual direction for mockups. Apache-2.0.
- [design](https://github.com/anthropics/knowledge-work-plugins/tree/main/design) by Anthropic (knowledge-work plugins): design critique and accessibility review. Apache-2.0.
- [security-audit](https://github.com/cloudflare/security-audit-skill) by Cloudflare: multi-phase security audits with verified findings. MIT.
- [playwright-cli](https://github.com/microsoft/playwright-cli) by Microsoft: browser checks and screenshots from the command line. Apache-2.0.
