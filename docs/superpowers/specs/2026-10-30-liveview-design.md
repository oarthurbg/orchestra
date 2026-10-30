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

- **Routes match the path,** so `/?anything` still serves the page.
- **One instance per project:** `node server.mjs --root <main checkout> --detach` starts the server in the background and prints its URL. When `.orchestra/liveview.json` already points to a server whose `/api/ping` answers with the same root, it prints that URL and starts nothing. `--stop` ends the process in `pid` and deletes `liveview.json` (on Windows a signal cannot run the server's own cleanup).
- **Start by the band:** on `session.start` in an orchestrator session, the band runs that `--detach` command through `$.process.run` without waiting for it. When `node` is missing the call fails and nothing happens.
- **Start and stop by hand:** `/orchestra:liveview` runs the same command; `/orchestra:liveview stop` runs `--stop`.
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

The approved prototype was built with taste-skill (app style `achromatic-ledger`, seed 1286254319, with the brand's palette and type kept), checked with its inspector at 1440, 768 and 390 (0 FAIL), with Playwright, and with impeccable's critique, whose five findings are fixed. Screenshots: `docs/superpowers/specs/liveview/`. Mode: Operate. The screen's question: which workstream needs me, and when does the open work land?

- **Style:**
  - The chrome is ink on paper.
  - Cobalt is the one data hue: done work, the actual limit line.
  - The band's four shapes are the only other colour.
  - Vermilion is kept for a figure that breaks: 250k context, a run-out before the reset, 90% or more at the reset.
  - The tokens are `docs/index.html`'s, including its dark palette and `data-theme` override.
  - Archivo 800, the wordmark's face, carries the wordmark, the `h1`, the card titles, the headline figures and each row's ETA. IBM Plex Sans with tabular figures carries everything else. No monospace.
  - The half circle is pale blue on dark too, in the logo and as a status shape; `docs/BRAND.md` changed with it (the deep blue disappeared on ink).
  - 4px radius, 1px borders, no shadows.
- **Shell:** a 48px top bar with the brand mark, the wordmark, `liveview` and the freshness stamp ("Updated 3 s ago", or "Stale since" in vermilion). No sidebar: one destination for now. The decision inbox (item 3) later adds a second.
- **Title row:**
  - The project folder name as the `h1`.
  - One sentence with the finding: "billing is waiting on you: approve the invoice mockup. Open work lands by Fri 06:19."
  - On the right, the one primary action, "Open <the first waiting session>" (its `claude://` link), shown only when a waiting session has a link.
- **Strip:** one card split into three cells, in the owner's priority order:
  - "All merged by", the latest projected merge, with "ETA from N finished tasks" or "Uncalibrated".
  - 5-hour limit %, with the run-out time or the reset time;
  - weekly limit %, with the run-out time or the projected % at the reset;
- **Middle row:** "Needs you" (1fr) beside "Weekly limit" (2fr).
  - "Needs you" lists every session that is waiting, at 250k or more, stale, unregistered, or registered with no session. Each has its shape, name, an "Open" link when it has one, and a plain reason ("254k context: clear it at the next stop"). When nothing needs the owner, it keeps its frame and says so.
  - The chart shows cumulative weekly % across the 7-day window:
    - a y-scale at 0, 25, 50, 75 and 100% with faint gridlines;
    - the actual line solid cobalt, the projection dashed to the run-out (100%) or to the reset, with its end labelled;
    - a "Now N%" line and the reading as a dot.
- **Workstreams card:** one row per session or registered workstream (orchestrator first, unregistered last). Columns: shape, name, context, stage and PR, a "done of total · ETA" button, and the timeline track.
  - **Shapes, as in the band:**
    - triangle saffron: waiting;
    - square vermilion: 250k or more;
    - circle cobalt: running;
    - half circle pale blue: idle;
    - outlined half circle: stale, unregistered or no session.

    Shapes are 16px. Every shape has an accessible name, and every row also says its reason in words when it is not running or idle.
  - **Track:** one rounded 10px pill per workstream, chosen by the owner from a live preview of three treatments (thin line, pill, beads). It spans the plan from its first task's start to its projected end. The planned span is a cobalt tint; the done part, up to the last finished task, is solid cobalt. There are no per-task blocks; task boundaries live in the opened task list. A 1px ink now-line, labelled `now`.
  - **Opening a row:** the ETA cell is a real disclosure button (`aria-expanded`); a click anywhere else on the row does the same for the mouse. It opens the task list: a dot for each task (filled when done, outlined when current), its title, agent and risk, and the measured time or `est` with the estimate (`?` when uncalibrated). Open rows are remembered in `localStorage`, wrapped in try and catch. Every redraw keeps keyboard focus on the same control.
  - **Names:** a name links to the session's `claude://` link when its file has one; otherwise it is plain text. Only `claude://` links pass.
  - **Last rows:** the queued workstreams (dashed bars), then the rollout row (filled diamonds for merges and releases, hollow for projected merges).
  - **Legend:** a shape key, the bar fills and the diamonds.
- **Calendar window:**
  - It runs from the start of the oldest open workstream, at most 3 days back, to the latest projected end, and is at least one day wide.
  - Under 2 days the axis shows hours every 3 hours, with midnight named ("30 Fri"); otherwise it shows day names.
  - Labels stay inside the track.
- **Phone (below 640px):** the top bar drops `liveview`, the action moves under the finding, and the strip becomes two cells ("All merged by", 5-hour) and the weekly limit full width. "Needs you" and the chart stack. Each workstream becomes a two-line row (name and ETA, then context and stage) with its track below; every other hour label hides. The page never scrolls sideways.

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
- **Band addition:** engine tests: an orchestrator session calls `$.process.run` once with `--detach`; a workstream session never does.
- **Page:** taste-skill's `lint.mjs --app` and `inspect.mjs --app` (0 FAIL), impeccable's detector (no findings), and a Playwright pass:
  - the disclosure opens and closes by click and keyboard, and keeps focus across the 5-second redraws;
  - no row is a `role="button"` around a link;
  - light and dark both read;
  - no sideways scroll at 390;
  - no console errors.
- **Live check (owner step):** the detached start from the band in the desktop app; screenshots of the page, light and dark, with fixture data only, for the README.

## Out of scope

- The decision inbox and answering questions (item 3).
- Files and test counts as ETA weights, until history exists.
- Per-project token breakdowns.
- Any write to sessions, plans or git.
