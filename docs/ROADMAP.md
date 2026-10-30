# Roadmap

## Phase 1: base package (done)

Maestro and principal roles, 9 agents, handoff notes, isolated test data per workstream, `/orchestra:init`, `/orchestra:start-workstream`, `/orchestra:close-wave`, and a marketplace that lists the third-party plugins from their upstream repositories.

## Phase 2: backlog

To be brainstormed with the owner before any spec. Nothing here is decided yet.

### 1. A Claude Code mod for the session band

Built in 0.2.0: see "The band" in the README and the spec at [`docs/superpowers/specs/2026-10-30-band-mod-design.md`](superpowers/specs/2026-10-30-band-mod-design.md). The dashboard (item 2) writes `.orchestra/liveview.json` with its local URL while it runs, which shows the band's `Liveview` button.

Complements ponytail's own band and does not duplicate it. Shows:
- 5-hour and weekly plan-limit %;
- burn pace, with a projected time when the weekly limit runs out;
- the context size of each linked session, with a warning near 250k tokens;
- each workstream's state: running, idle, or waiting on the owner.

First step: confirm what a mod can read directly (with the plugin-authoring skill) and what has to come from the maestro.

### 2. A localhost dashboard

A plain local process that uses zero LLM tokens to stay live. Shows:
- active sessions;
- each workstream's plan progress, parsed from the plan checkboxes;
- an ETA per task and overall, weighted by task complexity: the agent, model and risk marked in the plan, files touched, and test count. Calibrated from the git history of similar tasks, including review rounds;
- a timeline and the rollout plan;
- a weekly-limit projection from the token usage in Claude Code's on-disk transcripts, calibrated by the last plan-limit % snapshot.

The only data not on disk (plan-limit % and the official session list) comes from a `status.json` the maestro writes when it already checks progress. Writing it never costs an extra call.

### 3. A single decision inbox

- Pending questions from every session, read from the transcripts.
- Links to the files each workstream produced: mockups, screenshots, PDFs, PRs, specs.
- An "open session" deep link per item.

To investigate: whether the mod can answer inside the app. App sessions are never resumed from the CLI.

### 4. The maestro decides when to build a code graph

**Parked in favour of item 5.** The code graph was built on branch `claude/graphify-e5bb5f` (PR #6, closed, branch kept) and measured: about 25% fewer work tokens on a large TypeScript app, none on Python. The language server in item 5 matched or beat it on both, so item 5 is the way forward. The text below is the original idea.

[graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0, installed with `pip install graphifyy`, not a Claude Code plugin) turns the codebase into a knowledge graph that agents query instead of sweeping files. Idea, to be brainstormed and specced after the band:
- At `/orchestra:init` and at every wave end, the maestro measures the integration branch (files, lines of code, and later the tokens explorers and planners spend per task, from the band's session reports).
- Past a threshold it proposes building the graph on the integration branch in the main checkout. The build costs LLM tokens, so it gets its own level in "Owner authorizations" (default `ask`).
- The merge checklist runs `graphify --update` after each workstream merge, so the graph follows the integration branch.
- When `graphify-out/` exists, the explorer and planner query it first, and treat it as a map of the integration branch, not of their own branch.
- Building late is cheaper than building early for the paid semantic pass: a young project rewrites files often, and each version is paid again. The free structural pass could run from the start, if graphify can run it alone (to check).
- The thresholds (a first guess: 500 files or 50k lines) are calibrated in the real-project trial: the same task with and without the graph, tokens compared.

### 5. A language server for code navigation

A measured trial (9 questions on networkx, the Python standard library and a public TypeScript app, Haiku explorers, one run per cell) found that Pyright and the TypeScript language service cut explorer work tokens about 30% with no loss of accuracy, including on Python, where graphify missed most callers. See [`docs/superpowers/specs/2026-10-30-lsp-measurement.md`](superpowers/specs/2026-10-30-lsp-measurement.md).

Idea, to be brainstormed and specced:
- Explorer and planner call a Claude Code LSP plugin (`find references`, call hierarchy) when one is installed, and fall back to grep otherwise.
- No build step and no update after merges: the server reads the working tree, so it also sees a worktree's own branch.

Still open: a planner task on Opus, an app over 1,000 files, and an installed LSP plugin instead of the hand-made wrapper used in the trial.
