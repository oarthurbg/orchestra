# orchestra

A Claude Code plugin for running one project with several Claude sessions at once: one **orchestrator** session that only coordinates, and one **workstream** session per feature, each taking its feature from spec to PR with its own worktree, isolated test data and subagents. It works for any kind of app: no database, server or Docker required.

It was built while developing an internal media-planning app, and packages the workflow that came out of it: spec first, two-stage and risk-proportional reviews, a third UI review from real screenshots, handoff notes and context clearing, isolated test data per workstream, and a ponytail mode and set of skills for every stage.

**See the whole stack on one page:** [docs/index.html](docs/index.html) (published at <https://oarthurbg.github.io/orchestra/>).

## What's inside

```
plugins/orchestra/
  agents/      explorer, planner, implementer, implementer-advanced, mechanic,
               spec-reviewer, quality-reviewer, screenshotter, verifier
  skills/      orchestrator (with stages.md: modes, skills and reviews per stage)
               workstream, handoff-note, test-databases (test data recipes per data store,
               plus an optional, tested Postgres-in-Docker example)
  commands/    /orchestra:init, /orchestra:start-workstream, /orchestra:close-wave
  templates/   CLAUDE.md, HANDOFF.md, handoff-note.md
docs/index.html  the stack at a glance
```

| Agent | Model, effort | Ponytail | Job |
| --- | --- | --- | --- |
| explorer | Haiku, low | full | Read-only searches and summaries |
| planner | Opus, high | ultra | Spec to plan with `superpowers:writing-plans`, tasks tagged with agent and risk |
| implementer | Sonnet, medium | full (lite on UI) | One task, TDD, commit |
| implementer-advanced | Opus, high | full (ultra on infra) | Security, migrations, integrations, Docker |
| mechanic | Haiku, low | full | Docs, renames, formatting |
| spec-reviewer | Sonnet, medium | off | Does it match the spec, nothing missing or extra? Read-only |
| quality-reviewer | Opus, high | off | Real bugs, security, failure cases, with `ponytail:ponytail-review`. Read-only |
| screenshotter | Sonnet, low | full | Light and dark, wide and narrow, empty, loading and error states |
| verifier | Sonnet, low | full | Full verification before the PR, report only |

Every project-specific value (branches, commands, dev server, test data commands, how agents sign in for browser checks) lives in one "Project settings" block in the project's `CLAUDE.md`, which `/orchestra:init` writes.

## Install

In a Claude Code session:

```
/plugin marketplace add oarthurbg/orchestra
/plugin install orchestra@orchestra
```

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
2. In your main session, load the `orchestra:orchestrator` skill and open workstreams with `/orchestra:start-workstream <name> <goal>`.

## Requirements

- **Claude Code desktop app** (Code tab) for the session tools the workflow relies on: starting sessions, messaging between them, reading their context size, clearing and archiving them. In the plain CLI the roles and agents still work, but you start, brief, clear and archive sessions by hand.
- **Docker** only if you pick the optional Postgres-in-Docker test data example.
- **git** with worktrees, and the **GitHub CLI** (`gh`) for PRs.

## Recommended settings

- **Auto-compact safety net at 600k tokens.** In `~/.claude/settings.json`:

  ```json
  { "autoCompactWindow": 600000 }
  ```

  It applies to new or restarted sessions. The real rule is earlier: a workstream above 250k tokens at the end of a wave writes its handoff note and gets cleared at a natural stop. The 600k net catches the case where nobody checked in time.
- **Auto-archive on PR close: off** (desktop app setting). Archiving a session kills its process and its background agents, and unarchiving does not bring them back. Workstream sessions open spec and plan PRs and keep working after those merge, so auto-archive would stop them mid-workstream. The orchestrator archives finished sessions itself, after checking nothing is running.
- **Ponytail modes per session.** Every session starts in full. The orchestrator stays in full. The workstream session switches its own mode per stage and states it in every subagent briefing: brainstorm and mockups off, spec lite, plan ultra, backend full, UI lite, infrastructure ultra, reviews off. The full table is in [`stages.md`](plugins/orchestra/skills/orchestrator/stages.md).

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

## License

orchestra's own files are under the [MIT license](LICENSE). The third-party plugins above are not part of this repository; each keeps its own license and is fetched from its own repository when you install it.
