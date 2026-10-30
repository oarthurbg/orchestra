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

Built: see graphify in "Requirements" in the README and the spec at [`docs/superpowers/specs/2026-10-30-graphify-design.md`](superpowers/specs/2026-10-30-graphify-design.md). [graphify](https://github.com/Graphify-Labs/graphify) runs its free code pass only, on TypeScript and JavaScript projects with 500 or more tracked files, behind "Build the code graph" in "Owner authorizations".

Still open: the 500-file threshold is a guess, calibrated in the real-project trial: the same task with and without the graph, tokens compared.
