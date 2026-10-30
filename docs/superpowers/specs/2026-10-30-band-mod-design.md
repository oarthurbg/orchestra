# Band mod: design

Phase 2, item 1 of `docs/ROADMAP.md`. Approved with the owner on 2026-10-30.

## Goal

A band above the prompt, in every session where orchestra is installed, that shows plan limits, burn pace, the context of each workstream session and which workstreams need the owner. The same mod keeps a session's prompt cache warm while its subagents run. It costs no LLM tokens to stay live, except the keep-warm pings it counts and shows.

## Packaging

The mod ships inside the orchestra plugin: a hooks module in `plugins/orchestra/hooks/`, registered from `plugin.json`. Version goes to 0.2.0.

Risk to check in the first build step: an older Claude Code, or a `claude -p` run, must still load orchestra and skip the module. If it does not, the mod moves to its own plugin, `orchestra-band`, in the same marketplace.

## What a mod can read (checked in the mod API types)

- Its own session, for free: `$.session.usage()` returns the context fill, the rate-limit windows (`five_hour`, `seven_day`, each with `percentUsed` and `resetsAt`) and the cost. The `session.measure` event fires after each main-thread turn and when a window moves a whole point.
- Other sessions: no API. Every session that has orchestra loads its own copy of the mod, and `$.fs` reads and writes files, so each session reports itself through a file.
- Timers: `$.clock.after`. Running subagents: `$.agent.list()`. A forked request over the session's transcript, which reads the main thread's prompt cache: `$.model.fork({ prompt })`.

## Parts

One hooks module with four parts. The logic lives in pure functions in a separate file so it can be tested without the engine.

### 1. Report

On every `session.measure`, the mod writes `.orchestra/sessions/<session-id>.json` in the main checkout. Each session writes only its own file, so two sessions never write the same file.

- **Main checkout:** in the main checkout, `.git` is a folder and the session's root is the main checkout. In a worktree, `.git` is a file that reads `gitdir: <main>/.git/worktrees/<name>`, and the main checkout is the folder that holds that `.git`. No shell call is needed.
- **Role and workstream:** a session whose root is the main checkout is the maestro. Otherwise its root is matched against the worktree paths in `.orchestra/workstreams.md`; no match makes it `unregistered`, shown with its branch. A relative worktree path in the registry is resolved against the main checkout, `.` and `..` segments included; `/orchestra:start-workstream` writes it absolute.
- Outside an orchestra project (not a git repository, or no `.orchestra/` folder in the main checkout) the mod writes nothing.

File format:

```json
{ "v": 1, "session": "<id>", "role": "maestro | workstream | unregistered",
  "workstream": "<name or null>", "branch": "<branch>",
  "title": "<sidebar title or empty>", "link": "<claude:// link or empty>",
  "state": "running | idle | waiting", "detail": "<text or empty>",
  "stage": "<from the Status line or empty>", "pr": "<from the Status line or empty>",
  "context": { "tokens": 182000, "window": 1000000 },
  "limits": [{ "kind": "five_hour", "percentUsed": 42, "resetsAt": "<iso>" },
             { "kind": "seven_day", "percentUsed": 61, "resetsAt": "<iso>" }],
  "warm": { "pings": 2, "last": "<iso or null>", "misses": 0 },
  "updatedAt": "<iso>" }
```

States, from the most precise source available:

- **waiting:** live while an `AskUserQuestion` from that session is open, with its question as `detail`; otherwise when the handoff note's `Status:` line says `waiting on owner`, with its `waiting on:` text as `detail`.
- **running:** between a turn's start and its end.
- **idle:** everything else.

`title` and `link` come from the desktop app once per session start: the mod calls the app's `get_session` tool (`$.mcp.call` on the app's session server, `session_id: "self"`), which returns the sidebar title and a `claude://claude.ai/epitaxy/<session id>` link. Outside the desktop app, or if the call fails, both stay empty.

`stage` and `pr` come from the handoff note's `Status:` line (`docs/workstreams/<name>.md` in the worktree), which workstreams already update each wave. The mod reads it again on each write; an unreadable or missing note leaves both empty.

The file is also written when the state changes (a question opens or closes, a turn starts or ends), not only on `session.measure`.

### 2. Pace

The run-out time comes from the `seven_day` reading alone: the window started at `resetsAt` minus 7 days, the average rate is `percentUsed` divided by the time elapsed since then, and the run-out time is when that rate reaches 100%. If that time falls after `resetsAt`, the band shows no run-out time. No history is stored.

`shortcut: uses the week's average burn rate, not the last few hours; switch to recent samples kept in the session files if the projection proves misleading.`

The band uses the freshest limit reading among all session files, since limits are per account.

### 3. Band

A `ui.render` hook on `AbovePrompt`.

- **In an orchestra project, layout A:** one summary line (the brand mark, `5h` %, `week` % with the run-out time, counts of running and waiting workstreams, and the session's own keep-warm pings as `warm 2x` when there are any), then one row per workstream that needs attention: shape, name, reason, context, detail.
- **A row appears when a workstream:** is waiting (yellow triangle); is at 250k context or more (red square); is stale, meaning open in the registry but its file is more than 30 minutes old (half circle, `stale · <age>`); or is an `unregistered` worktree session (half circle, `unregistered <branch>`), so a forgotten worktree gets noticed.
- **Opening a session:** a workstream's name is a button when its file has a `link`; pressing it opens the link with the system opener (`cmd /c start "" <link>` on Windows, `open` on macOS, `xdg-open` on Linux), and the app shows that session. The name shown is the sidebar `title` when there is one, else the workstream name. Without a link the name is plain text.
- **Liveview button:** in any session of the project, when `.orchestra/liveview.json` exists with a `url` on `localhost` or `127.0.0.1`, the summary line shows a `Liveview` button that opens that URL the same way. The dashboard (Phase 2, item 2) writes this file while it runs and deletes it when it stops; until then the button never shows.
- **In a workstream session:** the summary line plus its own row (stage, context), always shown.
- **Outside an orchestra project:** the limits line only, with the ping count when there is one.
- **Sharing the slot:** other mods draw above the prompt too (ponytail's band does). The hook draws `next(e)` beneath its own band, as ponytail's does, so every band shows and none replaces another. It shows no ponytail controls; ponytail's band has the level switch.
- **Refresh:** a 20-second timer lists `.orchestra/sessions/`, re-reads only the files whose timestamp changed, forgets the files that disappeared, and rebuilds the view on every tick, since staleness depends on the clock. The session's own figures redraw on `session.measure`.
- **No limit readings yet** (API key, or before the first response): the limits part is hidden and the context part still shows. A reading whose `resetsAt` has passed is dropped.
- **A file that fails to read or parse** (read mid-write) keeps the last good reading for that session; it is tried again on the next tick. A file must have a `limits` list of objects with a string `kind` and a number `percentUsed`, and a `context.tokens` that is a number or null.
- Session files for workstreams no longer in the registry are ignored.

### 4. Keep-warm

While one of the session's own subagents is running (`$.agent.list()`, background and foreground ones), the mod sends `$.model.fork({ prompt: "Reply with: ok" })` shortly before the cache lifetime ends, counted from the main thread's last model request or the last ping. A cache hit refreshes the lifetime. It runs in every project, not only orchestra ones.

The main thread's last request is the last `turn.step` without an `agentId` (set at `session.start` until the first one). `session.measure` does not move it, because a subagent's requests move the rate-limit windows and fire it too.

Guards:

- **`cacheMinutes`** (plugin setting, default 60): the cache lifetime, which a mod cannot read. Use 5 for API keys and overage. The ping goes out one minute before it ends (30 seconds when it is 5).
- **`warmMaxHours`** (plugin setting, default 2): after a subagent has run this long, the mod stops pinging for it. Pings stop once every running subagent is older than the limit.
- No subagent running means no pings. An idle maestro is never pinged.
- No turn guard: the second live check showed that a fork during an open main-thread tool call reads the cache, so a long foreground subagent or tool call is kept warm too. While the main thread is making requests, each `turn.step` pushes the schedule back, so no ping is due.
- **Cache miss:** after an answered fork, when the session's context tokens are known and `usage.cache_read_input_tokens` is below half of them, the fork missed the cache. It is counted as `warm.misses`, not as a ping; pings stop until the next main-thread `turn.step`; and the mod toasts once per session: `orchestra band: keep-warm missed the cache; set cacheMinutes lower (5 for API keys and overage)`.
- Every ping is counted in the session file and shown on the summary line (`warm 2x`) in every role and outside orchestra projects.
- **Trade-off, stated in the README:** a ping reads the whole context from the cache, about 0.1x the input price. Rewriting an expired cache costs 1.25x (5 minutes) or 2x (1 hour). How cache reads count against plan limits is not published.

The same timer as the band's drives it.

## Changes elsewhere in orchestra

- `plugin.json`: the hooks module, the two settings, version 0.2.0.
- `/orchestra:status`: reads `.orchestra/sessions/` first for each session's context and state, and falls back to `get_usage` and `list_events` when a file is missing or stale.
- Merge checklist (`skills/maestro/checklists.md`): after merging, delete the workstream's session file.
- README: a band section with screenshots, the two settings and the keep-warm trade-off, and a note that ponytail's level is one flag for every session (`~/.claude/.ponytail-active`): switching it in one session switches all of them, while each agent's per-stage mode stays in its own prompt.
- ROADMAP: item 1 links to this spec and notes keep-warm as part of it.

## Testing

- **Unit tests** (`claude plugin test`) for the pure functions:
  - main checkout from a `.git` file;
  - matching a root to its registry row;
  - parsing the `Status:` line;
  - the run-out time, including no run-out time before the reset;
  - the attention and stale rules;
  - the ping schedule and the `warmMaxHours` stop.
- **Render test:** seeded session files (one waiting, one at 254k, one stale, one healthy) produce the summary line and exactly three rows; a project with no `.orchestra/` produces the limits line only; a band another mod returns from `next(e)` is drawn beneath ours; a row whose file has a `link` draws its name as a button; the `Liveview` button shows only with a valid `.orchestra/liveview.json` and never for a non-local URL.
- **Static checks:** `claude plugin validate` and `tsc -p` pass.
- **Live check in the desktop app, first build step, before the rest:**
  - the timer fires while the session is idle;
  - `$.model.fork` runs outside a turn;
  - its `usage.cache_read_input_tokens` shows it read the main cache;
  - an older Claude Code or `claude -p` loads orchestra without the module failing it;
  - `$.mcp.call` reaches the app's session server and `get_session` returns `link` and `title`;
  - opening a `claude://` link from the mod moves the app to that session.

  If the session server is out of reach or the link does not move the app, names stay plain text. If the timer does not fire while idle, the band refreshes on the next prompt instead and the README says so. If the fork does not read the main cache, keep-warm is dropped from this spec.
- **Screenshots** of the band in a maestro session and a workstream session, for the README.

## Out of scope

- Answering questions from the band (the decision inbox, item 3).
- Charts and history (the dashboard, item 2).
