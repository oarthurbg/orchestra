# Roadmap

## Phase 1: base package (done)

Maestro and principal roles, 9 agents, handoff notes, isolated test data per workstream, `/orchestra:init`, `/orchestra:start-workstream`, `/orchestra:close-wave`, and a marketplace that lists the third-party plugins from their upstream repositories.

## Phase 2: workstream tooling (done, released as 1.0.0)

Items 1, 2, 3 and 5 are built and shipped in 1.0.0, along with the maestro's capacity rules (it sizes how much runs at once to the machine and the token limits). Item 4 is parked.

### 1. A Claude Code mod for the session band

Built in 0.2.0: see "The band" in the README and the spec at [`docs/superpowers/specs/2026-10-30-band-mod-design.md`](superpowers/specs/2026-10-30-band-mod-design.md). The dashboard (item 2) writes `.orchestra/liveview.json` with its local URL while it runs, which shows the band's `Liveview` button.

Complements ponytail's own band and does not duplicate it. Shows:
- 5-hour and weekly plan-limit %;
- burn pace, with a projected time when the weekly limit runs out;
- the context size of each linked session, with a warning near 250k tokens;
- each workstream's state: running, idle, or waiting on the owner.

First step: confirm what a mod can read directly (with the plugin-authoring skill) and what has to come from the maestro.

### 2. A localhost dashboard

Designed: [`docs/superpowers/specs/2026-10-30-liveview-design.md`](superpowers/specs/2026-10-30-liveview-design.md).

A plain local process that uses zero LLM tokens to stay live. Shows:
- active sessions;
- each workstream's plan progress, parsed from the plan checkboxes;
- an ETA per task and overall, weighted by task complexity: the agent, model and risk marked in the plan, files touched, and test count. Calibrated from the git history of similar tasks, including review rounds;
- a timeline and the rollout plan;
- a weekly-limit projection from the token usage in Claude Code's on-disk transcripts, calibrated by the last plan-limit % snapshot.

Everything comes from files on disk: the band's session files carry the plan-limit readings and the session list.

### 3. A single decision inbox

Designed: [`docs/superpowers/specs/2026-10-30-inbox-design.md`](superpowers/specs/2026-10-30-inbox-design.md).

- Pending questions from every session, read from the band's reports.
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

Built in 0.6.0: see "Code navigation" in the README and the spec at [`docs/superpowers/specs/2026-10-30-lsp-command-design.md`](superpowers/specs/2026-10-30-lsp-command-design.md).

Two measured trials. A command that prints references with their source line and callers as function names (a thin wrapper around Pyright or the TypeScript language service) cut explorer work tokens about 30% on networkx, the Python standard library and a public TypeScript app, and 65% (75% fewer tool calls) on a 1,960-file public app. The real Claude Code `LSP` tool, whose output is bare positions, saved nothing on that app. With Opus (high effort) as the explorer the saving shrinks to about 16%, but grep alone missed 2 of 8 callers on the trace question in every run and the language server did not. See [`docs/superpowers/specs/2026-10-30-lsp-measurement.md`](superpowers/specs/2026-10-30-lsp-measurement.md).

Idea, to be brainstormed and specced:
- Explorer and planner use a language-server command (references with source lines, callers as function names) when one is available, and fall back to grep otherwise. Either orchestra ships the thin command or the plugin's tool output improves.
- No build step and no update after merges: the server reads the working tree, so it also sees a worktree's own branch.

Still open: a planner task on Opus, Python through `pyright-lsp`, whether subagents get the `LSP` tool, and the shape of the command orchestra would ship. Setup note: Anthropic's `typescript-lsp` plugin returns same-file references until `initializationOptions: {"tsserver": {"useSyntaxServer": "never"}}` is set; details in the measurement doc.
