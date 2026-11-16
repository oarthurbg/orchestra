# Sessions that clear themselves, an app plan the maestro keeps, and code that stays clean

Date: 2026-11-16. Owner: Arthur. Status: design, waiting for approval.

## Why

On Gcem and gcem core the owner sees four problems:

1. **The maestro gets lost.** All it knows of the app is the "Next workstreams" list in the HANDOFF plus what is spread over the specs. Gcem's list has 12 items that mix ideas, merged work and old PR leftovers; "Waits on:" is almost never filled in; there is no `docs/decisions.md` and no architecture document.
2. **Sessions stall and cost too much context.** Measured on the Gcem main checkout (14,600 requests, 547M weighted units with `/orchestra:cost` weights):
   - 79% of the spend is re-reading cached context. A request above 400k tokens costs 59k units, against 26k between 100k and 200k. Only 65 requests ran below 100k; there were 158 automatic compactions.
   - A clear rewrote about 270k units and pays for itself in about 8 requests.
   - The maestro was woken 1,414 times by the app's automatic turn-end notes ("The session … you started … finished a turn"), at 330k context on average. Principals sent only 5 real messages.
   - Clearing needs the owner's yes (`ask`), so the maestro ran to the compact limit. A principal that asks to be cleared can deadlock with a maestro that just compacted: each waits on the other.
3. **The code gets repetitive.** Gcem has 7 table components and 3 badge components built by different workstreams, because the `ui/` kit has neither; `montagem.ts` and `montagemV1.ts` export the same 8 names; 26 exported names are defined in two files. No `docs/codebase-map.md` exists. `ponytail-audit` never ran.
4. **The code is poorly documented, across projects too.** 790 of 848 Gcem source files start with no comment saying what they do. Three maestros (Gcem, Postflow/Gcem Social, gcem-core) share the SRV-1 server, Authentik, Caddy, a common database and an e-mail sender, and refer to each other by local folder paths and branch names (Postflow's design points at `D:\Coding\srv1-authentik\docs\...` and at a file on Gcem's `login-authentik` branch).

## Goals

- Sessions clear themselves at a natural stop and come back on their own, with what they need to carry on, and no owner approval.
- The maestro plans the app with the owner: a roadmap of milestones, the architecture and the macro decisions, kept short and current.
- Plans and the roadmap get revised when something changes, at defined moments.
- Planners and implementers know what already exists, in this project and in the shared projects, before they build.
- New code says what it is for.

## Non-goals

- Swapping orchestra's agents for superpowers' flow, the scoped re-review and the per-agent model rule. That is a separate design (the "hybrid" change discussed on the same day).
- A timeline of milestones in the liveview. Revisit once the roadmap is in use and the liveview's measured ETAs can be summed.
- Writing gcem-core's actual contracts. orchestra ships the template and the rules; the gcem-core maestro writes them.
- Code-level enforcement (a duplicate-name hook, the band ordering a clear). Approach C below.

## Anti-goals

- More reading per wake. Everything the maestro rereads stays short: the roadmap, the architecture page, the resume block.
- A maestro that designs features. Architecture is planning the app; features stay with principals.
- Waking the maestro more often than today.

## Approaches

- **A. Text only** (skills, templates, checklists). Cheapest, no code. Rejected: Gcem shows written rules get skipped ("clear above 200k" existed, the maestro sat at 330k; `ponytail-audit` "between releases" never ran).
- **B. Text, commands and one hook** (chosen by the owner). The procedures live in commands tied to moments that already happen (status round, merge, release); the only code is the hook and its tests.
- **C. B plus enforcement in code** (liveview milestones, a duplicate-helper hook, the band ordering a clear). Most reliable, much more code, and noisy: `somar` in two files is not always a duplicate.

## What was tested on 2026-11-16 (desktop app)

| Question | Result |
| --- | --- |
| Is `clear_session("self")` instant? | Yes, about 5 s after the turn ends. |
| Does a `CronCreate` job survive the session's own clear? | No. |
| Can a scheduled task (`fireAt`) message a cleared session? | No: `send_message` from an unattended run needs a person's approval. |
| Does a message from another session wake a cleared session? | Yes, with an empty conversation. |
| Does a child's turn-end note wake a parent that cleared itself? | Yes. The parent's new conversation starts with the note and still lists its linked sessions. |
| Can a session start another session on a turn that a message or a note started? | No: the app allows it only on the owner's own words, or in a session's first brief. |
| Does a session the maestro starts inherit bypass permissions? | No, it starts in auto mode; starting it directly in bypass was refused. `set_session_permission_mode` raised it afterwards. |
| Can `clear_session` clear a session with Remote Control on? | No (the tool refuses it). |

## The design

### Part 1: sessions and context

**1.1 Owner authorizations.** In `templates/CLAUDE.md`, "Start a new principal session" and "Clear a principal session at a natural stop" default to `auto`, and a new line "Clear the maestro session at a natural stop" defaults to `auto`. `auto` now means: do it, and it shows only in the next status table, with no separate report. The always-`ask` list is unchanged. The maestro skill's text that says clearing needs the owner changes to match.
- **Projects that already exist:** a line missing from "Owner authorizations" counts as `auto` for these three lines only (every other missing line stays `ask`). `/orchestra:status` lists missing or `ask` values of these three lines once, as a proposal to the owner. For Gcem and gcem core the owner already decided (2026-11-16, in the orchestra session): open and clear without asking or reporting. Their maestros write the new levels into their `CLAUDE.md`, dated, through their next docs PR.
- Opening an alarm (1.2) is not "Start a new principal session" and needs no level.

**1.2 The alarm.** Every maestro and every principal keeps one alarm: a child session, Haiku at low effort, sharing the folder, that sits idle.
- It is opened when the app allows it: the maestro's in `/orchestra:init` or on the first turn the owner types to the maestro; a principal's on its first turn, from its briefing (`/orchestra:start-workstream` adds the step to the briefing).
- Its brief: when messaged, wait the number of seconds the message says (a `node -e "setTimeout(...)"` wait), then end the turn with one line. Edit nothing.
- Right after opening it, the opener raises it to its own permission mode with `set_session_permission_mode`. A session may raise one it started to its own mode with no approval card. An alarm left in auto mode could have its wait held, and the cleared session would never wake.
- Its session id is written where the hook finds it: `.orchestra/alarms.json` in the main checkout, keyed by the owner's role (`maestro`, or the workstream's name), which stays the same across a clear as the transcript does not, with the owner's app session id (`local_…` from `get_session("self")`) beside the alarm's. The hook gets no app session id, so it finds the entry by role.

**1.3 Clearing yourself.** Same steps for both roles, at a natural stop (no agent or command running, wave done, PR merged or checkpoint):
1. Write the resume: the principal updates its handoff note (skill `orchestra:handoff-note`) and commits it; the maestro rewrites the resume block in `.orchestra/status.md` (at most 20 lines: what runs, who waits on whom, what it does next). The maestro rewrites this block in every status round too, so it is never stale.
2. Turn its own Remote Control off (`set_remote_control` on itself), since a session serving Remote Control cannot be cleared.
3. Message its alarm: "wait 20 s, then end your turn".
4. `clear_session("self")` and end the turn.

When the maestro clears: at a natural stop above 200k tokens, at the end of a wave above 100k, and before an idle stretch longer than the cache lifetime (an hour) above 150k. A principal: at the end of a wave above 250k (the current threshold). The principal no longer asks the maestro to clear it; it reports the clear in its wave-end line. The maestro's `/orchestra:close-wave` part for principals becomes the fallback for a principal that has no alarm (opened before this version) or a failed clear.

**1.4 Coming back.** The SessionStart hook (`hooks/pending-asks.mjs`, today matcher `compact`) also runs on `clear`. It works out the role from the session's folder: the main checkout is the maestro, a folder registered in `.orchestra/workstreams.md` is that workstream's principal. It injects:
- the first steps: load the role's skill (`orchestra:maestro` or `orchestra:principal`) and turn Remote Control back on;
- the resume: the maestro's resume block, or the principal's handoff note path and its status line;
- for the maestro, what may still wait on it (today's list: unanswered messages, waiting band reports, handoff notes waiting on someone). A clear starts a new transcript, so after a clear the hook reads unanswered messages from the session's previous transcript in the same project folder (the newest one before the current), not only the one it is given. The resume block also lists the open asks the maestro knew of when it wrote it;
- for a principal, a pause or a new task limit: the registry row in `.orchestra/workstreams.md` gains `Task limit` and `Paused` columns that the maestro keeps, and a principal that wakes paused only updates its status line and waits;
- for both: "if no session is working and nothing below needs you, run `/orchestra:status` now" (maestro) or "continue from the next unticked task of your plan" (principal). This also covers the stall after a compaction.

The output stays under the hook's current 9,500-character cap.

**1.5 Notes that only report progress.** The maestro answers an automatic turn-end note that carries no decision, question, PR or pause with an empty turn: no tool calls, no text. Today the rule allows "a one-line answer".

**1.6 Permission mode of a new principal.** `/orchestra:start-workstream` raises a new principal to the maestro's own permission mode with `set_session_permission_mode` right after `start_session`, as it already raises effort. Without it the principal starts in auto mode and its alarm, clear and Remote Control calls get refused.
- **The plugin in the new folder.** The owner keeps orchestra off in the user settings and turns it on per project folder (`enabledPlugins` with `"orchestra@<marketplace>": true` in that folder's `.claude/settings.local.json`, which git does not copy into a new worktree). Before `start_session`, `/orchestra:start-workstream` writes the same entry, copied from the main checkout's settings, into the worktree's `.claude/settings.local.json`, merging into a file that exists. Without it the principal has no `orchestra:principal` skill, no agents and no resume hook after a clear. The alarm shares the folder, so it gets the plugin too. (Owner, 2026-11-16.)

### Part 2: planning the app

**2.1 Roadmap.** New template `templates/ROADMAP.md`; `/orchestra:init` creates `docs/ROADMAP.md`. The maestro owns it.

```
## Milestone 2: payments live          deadline: 2026-12-15 (client launch)
Done when: a boleto approved and matched to its top-up, in production.
- [workstream] fluxo-de-boletos: spec <link>, waits on: nothing
- [spec]       alertas-de-saldo: spec <link>, waits on: fluxo-de-boletos (the boletos table)
- [idea]       caixa-verbas: no spec, waits on: brainstorming with the owner
- [external]   banco-comum: gcem-core milestone 2 (contract <link>)
```

- Milestones in order, each with a "Done when" line. Item statuses: `idea`, `spec`, `workstream`, `merged`, `external`. An item that waits on another project names it and links its contract.
- A `deadline:` appears only when the owner gives one with a reason from outside the project. The maestro never writes a date of its own. In each status round, for a milestone with a deadline, it compares the liveview's ETA of the open workstreams with the date and tells the owner only when the ETA passes it.
- The HANDOFF's "Next workstreams" becomes the next 3 to 5 items with a link to the roadmap. The labels stay in English in every language, like the other names orchestra's tools read.
- Short: one line per item. Merged items leave the roadmap at the next release (they are in "Where we are" and git).

**2.2 Architecture and decisions.** A new exception in the maestro skill's "What you never do": the maestro runs the architecture step with the owner, using `superpowers:brainstorming` for that only. Features stay with principals.
- New command `/orchestra:architecture`: run at the start of a project (a step in "First session in a project", before the roadmap), before opening a milestone's workstreams, and when a principal reports a decision that affects other workstreams. It reads `docs/codebase-map.md` and the contracts through the `explorer`, never whole files itself; changes go in a docs PR the `mechanic` applies.
- It writes `docs/architecture.md` (new template, one page at most): modules and where things live, the data model in outline, integrations, auth and permissions, shared pieces with their owner workstream (for example "`ui/Tabela`: owned by X, lands before Y and Z"), and an "External pieces" section linking each contract another project owns.
- And `docs/decisions.md` in a fixed format (new template): one heading per decision with the date, what was decided, why, the alternatives dropped and what it affects. Decisions that touch only one workstream stay in its spec.
- The `planner`, the principal and `/orchestra:start-workstream`'s briefing read `docs/architecture.md`. The briefing lists the shared pieces the workstream will use.

**2.3 Contracts between projects.** New template `templates/contract.md`. The project that provides a shared piece keeps `docs/contracts/<piece>.md`: owner project, status (exists, or the milestone it lands in), interface (names, environment variables, schemas, ports, routes), consumers, and how to get access. For the Gcem projects the provider is gcem-core (`Gcem-A-Agencia/gcem-core`).
- Consumers link a contract by its GitHub URL at a commit, never by a local folder or a branch.
- `docs/architecture.md`'s "External pieces" lists them, and a roadmap item that waits on one says so.
- Consumers pull, nobody pushes. Each link names the commit it was read at; in every status round, a consumer's maestro checks each linked contract on GitHub (`gh api` for the file's last commit) and, when it changed since that commit, reads the change, updates the link and tells the owner if it affects open work. No message crosses between maestros, so no session ids of other projects are stored and nobody is woken.
- "Project settings" in `templates/CLAUDE.md` gains "Shared projects: `none` | <repository, contracts path>" so agents know where to look.

**2.4 Revision triggers.**
- **Workstream plan:** the principal re-dispatches the `planner` on the unticked tasks only, with what changed, when the spec changes, when a review or the fix-loop breaker finds a plan defect, or when a dependency merged with a different interface. Ticked tasks stay as they are. The planner keeps task numbering so the liveview reads one plan.
- **Roadmap:** new command `/orchestra:roadmap`. At a merge it runs without the owner: the maestro updates item statuses and marks waiting items ready, in the next docs PR. It brings to the owner, in the status round, only what needs a decision: a reorder, a new blocker, a closed milestone, a deadline at risk. At a release, and when a principal reports a cross-workstream decision, it reviews the roadmap with the owner.
- `/orchestra:status` checks the roadmap: an open workstream missing from it, an item marked `workstream` with no open workstream, an item whose waited-on item merged.

### Part 3: code that stays clean

**3.1 A live code map.** `/orchestra:codemap` runs in the release checklist and when a merged PR adds more than 20 source files (the merge checklist checks the count), not only "when the owner asks". The map gains a "Shared pieces" section: the UI kit, helpers, validations and constants that more than one module uses, one line each with its path. The planner names the piece to use in each task ("use `ui/Tabela`") and stops and reports when a task creates something the map or a contract already lists.

**3.2 Duplication check per PR.** The whole-branch close-out review (the one `superpowers:requesting-code-review` dispatches) gets one more check, since it already reads beyond the diff: "does this PR add a helper, component or constant the codebase map's Shared pieces, or a contract, already provide?" Findings go in the PR like the other close-out findings.

**3.3 Minimum documentation.** In both implementer agents and the planner's task text:
- every new source file starts with one line saying what it does and who uses it;
- each module folder the project names in `docs/architecture.md` has a short `README.md` (what it does, its entry points, what it must not do), and the `mechanic` updates it in the workstream's last docs task when the workstream changed that module.
- Comments in code still say only the why, as ponytail asks.

**3.4 `ponytail-audit` at every release.** A step in the release checklist, not a "between releases" note: run `ponytail:ponytail-audit` on the integration branch; each finding becomes a backlog item in the roadmap or a cleanup workstream. `claude-security` stays optional, as `docs/setup.md` describes it.

## What changes, by file

- `plugins/orchestra/hooks/hooks.json`, `hooks/pending-asks.mjs` and its tests: matcher `compact|clear`, the role detection, the alarm and resume lines.
- `skills/maestro/SKILL.md`, `skills/maestro/stages.md`, `skills/maestro/checklists.md`, `skills/principal/SKILL.md`, `skills/handoff-note/SKILL.md` where clearing is described.
- `commands/close-wave.md`, `commands/start-workstream.md`, `commands/status.md`, `commands/init.md`, `commands/codemap.md`; new `commands/architecture.md`, `commands/roadmap.md`.
- `agents/planner.md`, `agents/implementer.md`, `agents/implementer-advanced.md`, `agents/mechanic.md`.
- `templates/CLAUDE.md`, `templates/HANDOFF.md`; new `templates/ROADMAP.md`, `templates/architecture.md`, `templates/decisions.md`, `templates/contract.md`.
- Docs: `docs/stages.md`, `docs/agents.md`, `docs/memory.md`, `docs/commands.md`, `docs/setup.md`, and the stage cards in `docs/index.html` where they describe these rules.
- Each part bumps `version` in `plugin.json` and adds its `CHANGELOG.md` section, in its own PR.

## Order

Part 1 first (it unblocks the stalls and the deadlock), then part 2, then part 3, each its own plan and PR. Part 3's duplication check and code map lean on part 2's architecture page, so they come after it.

## Left to the builder

- The wording of the new rules and commands, within the rules above.
- How the hook tells the roles apart when the registry is missing (fall back to: main checkout is the maestro).
- The alarm's exact wait (20 s is a starting point; it must be long enough for the clear to land, which took about 5 s).
- The format of `.orchestra/alarms.json`.

## Calls made in this conversation that are the author's, not the owner's

- The 20-file threshold for rerunning the code map.
- Merged items leave the roadmap at the next release.
- The maestro's 150k idle threshold before a long pause.
- The fallback role of `/orchestra:close-wave` for principals with no alarm.
- Settled after the builder check: a missing authorization line counts as `auto` for the three clearing and opening lines; opening an alarm needs no level; the opener raises the alarm's permission mode; alarms are keyed by the app's stable session id; the hook reads the previous transcript after a clear; the registry gains task limit and pause columns; contracts are pulled in the status round instead of pushed by message; the roadmap updates statuses at a merge without the owner.
