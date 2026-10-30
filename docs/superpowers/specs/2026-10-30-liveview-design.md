# Liveview dashboard: design

Phase 2, item 2 of `docs/ROADMAP.md`. Brainstormed with the owner on 2026-10-30.

## Goal

A localhost page that shows, for one orchestra project: the active sessions, each workstream's plan progress, an ETA per task and per workstream, a timeline with the rollout, and a projection of the weekly plan limit. It is a plain local process that uses zero LLM tokens to stay live.

The decision inbox (item 3) becomes a second view of this page later; nothing here depends on it.

## Contracts with the band mod

Fixed by `docs/superpowers/specs/2026-10-30-band-mod-design.md`, not changed here:

- Each session writes `.orchestra/sessions/<session id>.json` (format `v: 1` in the band spec). The dashboard reads these, so the orchestrator-written `status.json` from the roadmap is dropped.
- While running, the dashboard writes `.orchestra/liveview.json` with a `url` of `http://localhost:<port>/`, and deletes it when it stops. The band opens only `localhost` or `127.0.0.1` URLs and reads only `url`; the dashboard also writes `pid`, for its own stop command.
- The registry is `.orchestra/workstreams.md`; handoff notes are `docs/workstreams/<name>.md` with a `Status:` line.

## Architecture

Zero-dependency Node (18 or newer), ES modules, in `plugins/orchestra/liveview/`:

| File | Responsibility |
| --- | --- |
| `server.mjs` | HTTP server, the 5-second rebuild loop, `liveview.json`, idle exit, signals. |
| `sources.mjs` | Reads session files, registry, notes, plans, `CLAUDE.md`, git and transcripts. All I/O lives here. |
| `snapshot.mjs` | Pure functions: parsing, task timing, ETA, token weighting, projection, rollout, calendar window. No I/O. |
| `page.html` | The page: one file, inline CSS and JS, no build step. |
| `tests/*.test.mjs` | `node --test`. |

### Server

- Binds `127.0.0.1` only. Tries port 4317, then the next 20; if all are busy it exits with a message and writes no `liveview.json`.
- Routes: `GET /` (the page), `GET /api/snapshot` (JSON), `GET /api/ping` (`{ "root": "<main checkout>" }`). Anything else is 404.
- Refuses with 403 any request whose `Host` header is not `localhost:<port>` or `127.0.0.1:<port>`, which blocks DNS rebinding.
- Read-only toward the project: it writes only `.orchestra/liveview.json` and `.orchestra/eta-history.jsonl`.
- Rebuilds the snapshot every 5 seconds; the page polls `/api/snapshot` on the same beat.
- If a rebuild throws, it keeps serving the last snapshot with `staleSince` set, and the page shows `stale since <time>`.

### Lifecycle

- **Start by the band:** on `session.start` in an orchestrator session, the band runs `node <plugin root>/liveview/server.mjs --root <main checkout>` detached through `$.process.run`. It skips this when `node` is not on PATH, or when `.orchestra/liveview.json` points to a server whose `/api/ping` answers with the same root.
- **Start and stop by hand:** `/orchestra:liveview` starts it in the background the same way; `/orchestra:liveview stop` reads `pid` from `liveview.json` and ends it.
- **Stop:** on SIGINT or SIGTERM it deletes `liveview.json` and exits. It also exits on its own when it has run for 30 minutes and no session file was updated in the last 30 minutes. A `liveview.json` left behind by a crash is overwritten at the next start.
- **Band change:** the start call is a small addition to the band's `hooks/band/register.tsx`, built after the band lands. The band's spec and plan files are not changed.
- **Live check first:** whether `$.process.run` can start a detached process that outlives the call. If it cannot, the band does not start the dashboard; the command and a README line cover it.

## Data sources

| Source | Gives |
| --- | --- |
| `.orchestra/sessions/*.json` | State, context, stage, PR, title, link, limit readings, `updatedAt`. A file whose `v` is not 1 is skipped. |
| `.orchestra/workstreams.md` | Open workstreams, each with its branch and worktree path. |
| `<worktree>/docs/workstreams/<name>.md` | The `Plan:` line (section 1 of the handoff note), naming the plan file. |
| `<worktree>/<plan file>` | `### Task N: <title>` headings, the `**Agent:**` and `**Risk:**` line, and the step checkboxes. |
| `CLAUDE.md`, "Project settings" | The integration and production branch names. |
| `docs/HANDOFF.md`, "Next workstreams" | The queued workstreams. |
| git | Plan file history, merges into the integration branch, releases on the production branch. |
| `~/.claude/projects/**/*.jsonl` (or under `$CLAUDE_CONFIG_DIR`) | Token usage, subagent transcripts included. |

- **Which plan:** the handoff note's `Plan:` line; when it is missing, the one file under `docs/superpowers/plans/` that the workstream branch adds against the integration branch; otherwise `no plan`.
- **Progress:** a task is done when every checkbox under it is ticked. The current task is the first one not done.
- **Transcripts:** only `timestamp`, `message.model`, `message.id` and `message.usage` are read, and assistant lines are deduplicated by `message.id`. Each file is read incrementally from a stored byte offset; a file shorter than its offset was rewritten and is read again from 0. Only files modified in the last 7 days are opened. No message content is kept or shown.

## ETA

The simple version: per-task medians by agent and risk, calibrated from git. Files and test counts join the weights later, once there is history to fit them.

- **Rule added to the workstream skill:** tick a task's checkboxes in the plan file in the task's last commit, after its reviews pass.
- **Finish time:** the commit that ticked a task's last box, found by walking the plan file's history (`git log` with the file at each commit).
- **Duration:** the sum of the gaps between consecutive commits on the branch after the previous task's finish, up to this task's finish, each gap capped at 2 hours, so nights and owner waits do not count. Review rounds fall inside it.
  `shortcut: wall-clock commit gaps, not real agent time; switch to subagent transcript spans if ETAs drift.`
- **History:** each finished task is appended to `.orchestra/eta-history.jsonl` (`plan`, `task`, `agent`, `risk`, `minutes`, `finishedAt`), keyed by plan and task so nothing is written twice. At start it is seeded from `git log --all` on plan files. Squash merges and deleted branches then lose nothing already seen.
- **Estimate for an open task:** the median of past tasks with the same agent and risk. With fewer than 3 of those, the same agent; then all tasks; then 45 minutes, marked uncalibrated (`?`). The agent stands in for the model, since each agent pins one.
- **Workstream ETA:** the sum of its open tasks' estimates. On the timeline, done tasks sit at their real times and the open ones are laid out back to back from now.

## Limit projection

- **Weighted tokens per message:** `input + 1.25 × cache write + 0.1 × cache read + 5 × output`, times a model weight: Opus 5, Sonnet 3, Haiku 1, matched on the model id.
  `shortcut: price ratios as a proxy for how plans count usage; recalibrated on every reading, so only the ratios matter.`
- **Reading:** the freshest `seven_day` reading across session files (limits are per account).
- **Calibration:** `k = percentUsed / weighted tokens from the window start (resetsAt minus 7 days) to the reading`.
- **Now:** `k × weighted tokens from the window start to now`.
- **Run-out:** at the burn rate of the last 24 hours. No run-out time when it falls after `resetsAt`.
- **5-hour:** the same method on the `five_hour` reading.
- **No reading yet:** weighted tokens only, labelled `no reading yet`.

## Rollout

- **Past:** merges into the integration branch and releases (first-parent commits on the production branch) inside the calendar window, as filled diamonds.
- **Projected:** each open workstream's merge at its ETA, as hollow diamonds.
- **Queued:** the n-th item of "Next workstreams" starts at the n-th earliest projected end and lasts the median length of past workstreams (from `eta-history.jsonl`, per plan), else 2 days marked `?`, drawn as a dashed bar.

## Page

Layout B, approved from the mockups: everything about one workstream on one line.

- **Header:** the brand mark, the wordmark, `liveview`, the project folder name and the time since the last rebuild. Then `5h` %, `week` %, and a pill with the run-out time when there is one.
- **Projection chart:** cumulative weekly % across the 7-day window. Actual is a solid cobalt line, projection a dashed one. The reading is a dot with its label, the 100% line is vermilion, there is a now line, and the reset is marked.
- **Workstream rows**, columns: shape, name, context, stage and PR, `done/total · ETA`, and the timeline track.
  - **Shapes, as in the band:**
    - yellow triangle: waiting;
    - red square: 250k context or more;
    - cobalt circle: running;
    - half circle: idle, stale or unregistered.
  - **Who gets a row:** the orchestrator and unregistered sessions get rows without a plan.
  - **Track:** done in cobalt, estimated in pale blue, and a vermilion now line.
- **Opening a row:** clicking a row opens its task list:
  - the `waiting:` detail;
  - each task with its tick, title, agent and risk;
  - the measured time, or `est` with the estimate, and `?` when uncalibrated.

  Open rows are remembered in `localStorage`, wrapped in try and catch.
- **Names:** a name is a link to the session's `claude://` link when its file has one; otherwise plain text.
- **Last rows:** the queued workstreams (dashed), then the rollout row (diamonds).
- **Footer legend:** the diamonds, the bar fills, and how many past tasks the ETA uses.
- **Calendar window:** from the start of the oldest open workstream, at most 3 days back, to the latest projected end, at least 3 days ahead.
- **Type and colour:** Archivo for the wordmark, IBM Plex Sans and Mono for text, loaded from Google Fonts with system fallbacks. Colours are `docs/BRAND.md` tokens on `:root`, with the brand's dark palette under `prefers-color-scheme: dark`: ink background, paper text, deep-blue half circle.
- **Colour is never the only signal:** every shape has text beside it (state, `254k`, `waiting:`).
- **Narrow windows:** the track column scrolls sideways inside the table, and the page itself does not.

## Errors

The page always draws and labels what is missing; nothing takes the server down.

- **Session file that fails to parse** (read mid-write): the last good reading for that session is kept.
- **Registry row whose worktree is gone:** the row shows `worktree missing`.
- **Missing or unparsable plan:** `no plan`, and no ETA.
- **`git` missing or failing:** no history. ETAs are uncalibrated and the rollout row is empty.
- **Transcript line that fails to parse:** skipped. A missing transcript folder means the projection shows the reading only.

## Changes elsewhere in orchestra

- `commands/liveview.md`: the new `/orchestra:liveview [stop]` command.
- `hooks/band/register.tsx`: the start call on `session.start` in an orchestrator session (after the band lands).
- `skills/workstream/SKILL.md`: the tick rule from the ETA section.
- `plugin.json`: version 0.3.0.
- README: a liveview section with the screenshots, the Node 18 requirement, how to start and stop it, and that it reads token counts (never content) from every project's transcripts, because limits are per account.
- ROADMAP: item 2 links to this spec, and the `status.json` paragraph is replaced by "everything comes from files on disk".

## Testing

- **Unit (`node --test`, `snapshot.mjs`):**
  - registry rows;
  - the handoff `Plan:` line;
  - plan tasks with agent, risk and ticks;
  - finish times from a sequence of plan versions;
  - gap-capped durations;
  - the ETA fallback order and the uncalibrated mark;
  - weighted tokens and the dedupe by message id;
  - calibration, run-out, none after the reset and none without a reading;
  - queued placement;
  - the calendar window.
- **Sources:** the incremental transcript reader on a temp folder: append, shrink, and a bad line.
- **Server**, on a fixture project:
  - `/api/snapshot` returns JSON;
  - a wrong `Host` gets 403;
  - a busy port moves to the next;
  - `liveview.json` is written and removed on SIGTERM;
  - the idle exit fires, with an injected clock.
- **Band addition:** an engine test where an orchestrator session calls `$.process.run` once, and never when a live server answers `/api/ping` with the same root.
- **Live check (owner step):** the detached start from the band in the desktop app; screenshots of the page, light and dark, with fixture data only, for the README.

## Out of scope

- The decision inbox and answering questions (item 3).
- Files and test counts as ETA weights, until history exists.
- Per-project token breakdowns.
- Any write to sessions, plans or git.
