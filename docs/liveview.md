# The liveview

A local page for the project: plan limits with a projection to the reset, what needs you, every workstream's progress, ETA and timeline, and an inbox of the questions waiting on you.

[README](../README.md) · [Setup](setup.md) · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [The band](band.md) · **The liveview** · [Benchmarks](benchmarks.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme/liveview-dark.png">
    <img alt="The liveview overview: plan limits, what needs you, and every workstream with its context, stage, PR, ETA and timeline" src="../assets/readme/liveview-light.png" width="820">
  </picture>
</p>

## Running it

It runs as a plain Node process (Node 18 or newer) and uses no LLM tokens. The band starts it when a maestro session opens and shows a `Liveview` button; `/orchestra:liveview` starts it by hand and `/orchestra:liveview stop` stops it. It stops on its own after 30 minutes with no session activity.

- It listens on `127.0.0.1` only, from port 4317.
- It rebuilds the page every 5 seconds. Each rebuild costs about 0.3 s plus a few milliseconds per open workstream, 0.5 s at 50 workstreams. The first rebuild after a start reads each worktree's plan history from git and takes about 0.4 s per workstream (see [Benchmarks](benchmarks.md)).

## What it shows

- **Symbols.** Each session is drawn with the symbols in [`BRAND.md`](BRAND.md#symbols): the shape is the role, the way it is drawn is the state, and a context of 250k or more shows as a bold vermilion number.
- **Progress** comes from the plan checkboxes. **ETAs** come from how long past tasks took, measured from the commits that ticked them: tasks with the same agent and risk, else the same agent, else all past tasks, using the first group with 3 finished tasks. Until one has 3, the ETA shows `?`.
- **The limit projection** reads token counts (never message content) from Claude Code's transcripts for every project on this machine, because plan limits are per account, and calibrates them on the band's latest limit reading.
- **The band's run-out:** after each rebuild the liveview writes `.orchestra/pace.json` with when the planned work spends the week, and the band shows that time while the liveview runs.

## The inbox

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme/inbox-dark.png">
    <img alt="The inbox: three decisions waiting, oldest first, each with its question, the options it offers, its mockups, specs and PR, and an Answer button" src="../assets/readme/inbox-light.png" width="820">
  </picture>
</p>

The `Inbox` view lists every question a workstream is waiting on you to answer, oldest first, with the options it offers and the pictures, pages and docs on its branch. `Answer in` opens the session, where you answer. Chrome asks once before it opens a `claude://` link.
