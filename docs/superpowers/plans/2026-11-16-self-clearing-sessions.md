# Sessions that clear themselves: implementation plan (part 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The maestro and principals clear their own context at a natural stop and pick up again with no one typing: an alarm session wakes them, and the SessionStart hook gives them their role, their resume and what waits on them.

**Architecture:** One code change, in `hooks/pending-asks.mjs`: it also runs on `clear`, works out the role from the folder, and prints a resume for the maestro or for a principal. Everything else is rule text in the skills, commands and templates, plus the docs and the release.

**Tech Stack:** plain Node (ESM, no dependencies), `node:test`; Markdown skills and commands.

**Spec:** `docs/superpowers/specs/2026-11-16-sessions-planning-hygiene-design.md`, "Part 1: sessions and context" (1.1 to 1.6).

## Global Constraints

- Plugin code is plain Node, no dependencies.
- The hook's output stays under `MAX_OUT` (9,500 characters).
- `parseRegistry` in `liveview/snapshot.mjs` is unchanged: the liveview tests pin its rows exactly.
- The always-`ask` list (admin rights, deleting data or branches, credentials, money, production data) is unchanged everywhere.
- The alarm: Haiku at low effort, sharing the opener's folder, wait 20 s; the wait is `node -e "setTimeout(()=>{}, <ms>)"`.
- Thresholds: maestro clears above 200k at a natural stop, at every wave end, and above 150k before an idle stretch over an hour; a principal clears at a wave end above 250k.
- Resume block: at most 20 lines.
- Version `1.14.0` in `plugins/orchestra/.claude-plugin/plugin.json`, with a `## 1.14.0` section at the top of `CHANGELOG.md`, in plain words, claiming nothing unmeasured.
- Commits: `git add <path>` only; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test command: `node --test plugins/orchestra/tests/*.test.mjs plugins/orchestra/codemap/tests/*.test.mjs plugins/orchestra/cost/tests/*.test.mjs plugins/orchestra/lsp/tests/*.test.mjs plugins/orchestra/liveview/tests/*.test.mjs`

## Review Focus

1. A registry that leaves out the test data or port columns (`/orchestra:init` allows it): the hook still finds `Task limit` and `Paused`, because it reads them by header name, not position.
2. After a clear, the folder also holds the alarm's transcript and other sessions' ones: the hook picks the newest earlier transcript that called `clear_session`, never the alarm's.
3. A worktree session in a folder the registry does not list, or a project with no `.orchestra/`: the hook prints nothing.
4. A project that already exists with no "Clear the maestro session" line, or with `ask` on the two old lines: the maestro treats a missing line as `auto` and proposes the change once in `/orchestra:status`; it does not change `CLAUDE.md` itself.
5. A principal opened before this version (no alarm in `.orchestra/alarms.json`): it falls back to reporting to the maestro, and `/orchestra:close-wave` in the maestro still clears it.

---

### Task 1: The hook runs after a clear and resumes either role

**Agent:** implementer
**Risk:** normal

**Files:**
- Modify: `plugins/orchestra/hooks/pending-asks.mjs`
- Modify: `plugins/orchestra/hooks/hooks.json` (SessionStart `"matcher": "compact"` becomes `"compact|clear"`)
- Test: `plugins/orchestra/tests/pending-asks.test.mjs`

**Interfaces:**
- Consumes: `parseRegistry`, `DAY` (`liveview/snapshot.mjs`); `git`, `readText` (`liveview/sources.mjs`); the existing `unansweredMessages`, `waitingSessions`, `noteWaits`.
- Produces (all exported from `pending-asks.mjs`):
  - `roleOf({ top, main, registry }) -> { role: 'maestro' } | { role: 'principal', workstream: string, worktree: string } | null`: maestro when `top` is `main`; principal when a registry row's worktree, resolved against `main`, is `top`; else `null`. Paths compare with the existing `same()`.
  - `registryExtras(md, name) -> { taskLimit: string, paused: boolean }`: reads the row whose first cell is `name`, taking the cells under the header cells `Task limit` and `Paused` by position in the header row. `paused` is true only for `yes` (any case). Missing column or row: `{ taskLimit: '', paused: false }`.
  - `resumeBlock(statusMd) -> string`: the lines under the `## Resume` heading of `.orchestra/status.md`, up to the next `## ` heading, at most 20 lines, trimmed; `''` when absent.
  - `calledClear(lines) -> boolean`: true when an assistant line has a `tool_use` whose `name` ends with `clear_session`.
  - `previousTranscript(dir, current, now) -> string | null`: among `.jsonl` files directly in `dir`, other than `current`, modified in the last `DAY`, newest first, the first for which `calledClear` is true.
  - `render({ source, resume, alarm, messages, waiting, notes }) -> string` (maestro; replaces today's `render`, which tests call with only `messages, waiting, notes`, so `source` defaults to `'compact'`).
  - `renderPrincipal({ source, workstream, notePath, status, alarm, taskLimit, paused }) -> string`.
  - `.orchestra/alarms.json` format, written by the skills in Tasks 3 and 4: `{ "maestro": { "session": "local_…", "alarm": "local_…" }, "<workstream>": { "session": "local_…", "alarm": "local_…" } }`, keyed by role (`maestro` or the workstream's registry name), which stays the same across a clear, like the app's session id.

- [ ] **Step 1: Write the failing tests** in `tests/pending-asks.test.mjs`, keeping the four existing tests as they are:

```js
test('roleOf: main checkout is the maestro, a registered worktree its principal, anything else nothing', () => {
  const registry = [{ name: 'auth', worktree: '../repo-auth' }]
  assert.deepEqual(roleOf({ top: '/w/repo', main: '/w/repo', registry }), { role: 'maestro' })
  assert.deepEqual(roleOf({ top: '/w/repo-auth', main: '/w/repo', registry }), { role: 'principal', workstream: 'auth', worktree: resolve('/w/repo', '../repo-auth') })
  assert.equal(roleOf({ top: '/w/other', main: '/w/repo', registry }), null)
})

test('registryExtras reads task limit and pause by header, with or without the optional columns', () => {
  const full = '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage | Task limit | Paused |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| auth | s1 | `auth` at `/w/a` | db_auth | 3001 | no | build | 2 | yes |'
  const lean = '| Workstream | Session | Branch and worktree | Schema change | Stage | Task limit | Paused |\n| --- | --- | --- | --- | --- | --- | --- |\n| auth | s1 | `auth` at `/w/a` | no | build | 3 | no |'
  assert.deepEqual(registryExtras(full, 'auth'), { taskLimit: '2', paused: true })
  assert.deepEqual(registryExtras(lean, 'auth'), { taskLimit: '3', paused: false })
  assert.deepEqual(registryExtras(lean, 'gone'), { taskLimit: '', paused: false })
  assert.deepEqual(registryExtras('', 'auth'), { taskLimit: '', paused: false })
})

test('resumeBlock takes the Resume section, capped at 20 lines', () => {
  const md = `# Status\n\n| table |\n\n## Resume\n${Array.from({ length: 25 }, (_, i) => `- line ${i}`).join('\n')}\n\n## Other\nx`
  const block = resumeBlock(md)
  assert.equal(block.split('\n').length, 20)
  assert.match(block, /^- line 0/)
  assert.equal(resumeBlock('# Status\nno block'), '')
})

test('previousTranscript picks the newest earlier transcript that cleared itself, never the alarm', () => {
  // A temp folder with: current.jsonl, alarm.jsonl (newest, no clear), maestro.jsonl (has a clear_session tool_use), old.jsonl (has one, 2 days old; set with utimesSync).
  assert.equal(previousTranscript(dir, join(dir, 'current.jsonl'), Date.now()), join(dir, 'maestro.jsonl'))
})

test('render after a clear starts with the maestro first steps, the resume and the alarm', () => {
  const out = render({ source: 'clear', resume: '- auth builds task 3', alarm: 'local_al', messages: [], waiting: [], notes: [] })
  assert.match(out, /orchestra:maestro/)
  assert.match(out, /set_remote_control/)
  assert.match(out, /- auth builds task 3/)
  assert.match(out, /local_al/)
  assert.match(out, /\/orchestra:status/)
  assert.match(render({ source: 'clear', messages: [], waiting: [], notes: [] }), /No alarm recorded/)
})

test('renderPrincipal: note, status line, limit and pause', () => {
  const out = renderPrincipal({ source: 'clear', workstream: 'auth', notePath: 'docs/workstreams/auth.md', status: 'Status: idle · context 40k', alarm: 'local_al', taskLimit: '2', paused: false })
  assert.match(out, /orchestra:principal/)
  assert.match(out, /docs\/workstreams\/auth\.md/)
  assert.match(out, /Task limit: 2/)
  assert.match(out, /next unticked task/)
  assert.match(renderPrincipal({ source: 'clear', workstream: 'auth', notePath: 'x', status: '', alarm: '', taskLimit: '', paused: true }), /paused/i)
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test plugins/orchestra/tests/pending-asks.test.mjs`
Expected: FAIL, `roleOf` (and the others) not exported.

- [ ] **Step 3: Implement the functions in `hooks/pending-asks.mjs`** with the Interfaces above. Fixed copy:
  - `render`, `source: 'clear'`, first line: `orchestra: you cleared your context. First: load the orchestra:maestro skill, turn your Remote Control back on (set_remote_control on yourself), then read the resume below. Your alarm for the next clear: <alarm>.` With no alarm, the last sentence becomes `No alarm recorded in .orchestra/alarms.json: open one, as "The alarm" in the maestro skill says.` Then `Resume (from .orchestra/status.md):` and the block, or `No resume block in .orchestra/status.md.` Then today's three lists. Last line: `If no session is working and nothing above needs you, run /orchestra:status now.`
  - `render`, `source: 'compact'`: today's text unchanged, plus the resume block when there is one, and the same last line.
  - `renderPrincipal`: `orchestra: you <cleared|compacted> your context. You are the principal for <workstream>. First: load the orchestra:principal skill, turn your Remote Control back on (set_remote_control on yourself), then read <notePath> and follow its clean-session checklist.` Then the status line, `Task limit: <n> at once.` (1 when empty), the alarm sentence as for the maestro but pointing at "Context" in the principal skill. Last line: when paused, `You are paused: update your status line and wait for the maestro.`; otherwise `Continue from the next unticked task of your plan.`
  - Both go through `clip(..., MAX_OUT)`.

- [ ] **Step 4: Rewire `main()`.** Read `input.source` (default `'compact'`). Keep the early return when there is no `main` or no `.orchestra/`. Get `role` from `roleOf`; return when `null`. Read `.orchestra/alarms.json` (a parse error counts as empty). Maestro: as today, and when `source === 'clear'`, prepend the lines of `previousTranscript(dirname(input.transcript_path), input.transcript_path, now)` to the current lines before `unansweredMessages`; add `resumeBlock` of `.orchestra/status.md` and `alarms.maestro?.alarm`. Principal: `notePath` is `docs/workstreams/<name>.md`, the status line is the note's first line starting `Status:`, plus `registryExtras` and `alarms[<name>]?.alarm`. Update the file's first comment line to say it runs after a compact or a clear, for either role.

- [ ] **Step 5: Change the matcher** in `hooks/hooks.json` to `"compact|clear"`.

- [ ] **Step 6: Run the hook tests and the whole suite**

Run: `node --test plugins/orchestra/tests/pending-asks.test.mjs`, then the Global Constraints test command.
Expected: all PASS, the liveview tests included.

- [ ] **Step 7: Smoke-run the hook by hand** from the repository root: `echo '{"cwd":"'"$PWD"'","source":"clear"}' | node plugins/orchestra/hooks/pending-asks.mjs`
Expected: no output and exit 0 (this repository has no `.orchestra/`).

- [ ] **Step 8: Commit**

```bash
git add plugins/orchestra/hooks/pending-asks.mjs plugins/orchestra/hooks/hooks.json plugins/orchestra/tests/pending-asks.test.mjs
git commit -m "Hook: resume the maestro or a principal after a clear"
```

### Task 2: Owner authorizations for opening and clearing

**Agent:** mechanic
**Risk:** mechanical

**Files:**
- Modify: `plugins/orchestra/templates/CLAUDE.md` ("Owner authorizations")
- Modify: `plugins/orchestra/skills/maestro/SKILL.md` ("Owner authorizations")
- Modify: `plugins/orchestra/commands/status.md` ("Report" and "Act")

**Interfaces:**
- Produces: the line name `Clear the maestro session at a natural stop`, used by Task 3.

- [ ] **Step 1: Template.** Set `Clear a principal session at a natural stop: \`auto\`` and `Start a new principal session: \`auto\``, and add `Clear the maestro session at a natural stop: \`auto\`` right after the principal clear line. In the paragraph above the list, `auto` becomes: "(do it; it shows only in the next status table, with no separate report)".
- [ ] **Step 2: Maestro skill.** Same meaning of `auto`. Add one bullet after the three levels: "A missing line counts as `auto` for the three opening and clearing lines (start a principal, clear a principal, clear the maestro) and as `ask` for every other. Opening an alarm (\"The alarm\" below) needs no level."
- [ ] **Step 3: Status round.** In "I'll do next", `auto` items appear only in the table's Next column, not in the list. Add to "Act": "**Authorizations:** if any of the three opening and clearing lines in \"Owner authorizations\" is missing or `ask`, propose `auto` for it once, in \"Needs you\", and never again after the owner answers. Change `CLAUDE.md` only on the owner's word, through a docs PR, dated in `docs/HANDOFF.md`." Replace the "250k or more at a natural stop: propose the clear" bullet with: "**A principal at 250k or more at a natural stop** that has no alarm (no entry in `.orchestra/alarms.json`): clear it with `/orchestra:close-wave <name>`. One with an alarm clears itself."
- [ ] **Step 4: Check** `grep -n "auto" plugins/orchestra/templates/CLAUDE.md plugins/orchestra/skills/maestro/SKILL.md plugins/orchestra/commands/status.md` shows the three lines and the new meaning, and no text still says clearing or opening needs the owner.
- [ ] **Step 5: Commit** the three files.

### Task 3: The maestro's alarm, self-clear and resume

**Agent:** mechanic
**Risk:** normal

**Files:**
- Modify: `plugins/orchestra/skills/maestro/SKILL.md` ("Context and clearing", "After a compact", "Without the desktop app")
- Modify: `plugins/orchestra/commands/init.md` (new step, and step 9)
- Modify: `plugins/orchestra/commands/status.md` (the closing paragraph)

**Interfaces:**
- Consumes: the hook copy from Task 1 (`## Resume` heading in `.orchestra/status.md`, `.orchestra/alarms.json` format); the authorization line from Task 2.
- Produces: the alarm brief text and the four clear steps, which Task 4 points principals to.

- [ ] **Step 1: New subsection "The alarm"** under "Context and clearing":
  - What it is: a child session that sits idle and wakes you after you clear, since a cleared session waits for a message and its own turn-end note reaches its parent.
  - When: open it on the first turn the owner types to you, or in `/orchestra:init` (the app refuses `start_session` on a turn that a message or a note started). Check `.orchestra/alarms.json` first: if `maestro.alarm` is set and `get_session` finds it unarchived, keep it.
  - How: `start_session` with `use_worktree: false`, model `claude-haiku-5-5`, effort `low`, title "orchestra alarm", `context: "fresh"`, and this brief, exactly: "orchestra alarm for session <your local_ id>. Edit nothing, read nothing, load no skill. When a message asks you to wait N seconds, run `node -e \"setTimeout(()=>{}, N*1000)\"` and end your turn with the one word `done`. Any other message: end your turn with `idle`." Then `set_session_permission_mode` on it to your own mode (no approval card for a session you started), then write `{ "maestro": { "session": "<your local_ id from get_session(\"self\")>", "alarm": "<its id>" } }` into `.orchestra/alarms.json`, keeping the other keys.
- [ ] **Step 2: Rewrite the own-context bullets** as "Clearing yourself", in four numbered steps: write the resume block under `## Resume` in `.orchestra/status.md` (at most 20 lines: what runs, who waits on whom, the open asks you know of, what you do next); `set_remote_control` off on yourself; `SendMessage` to your alarm "wait 20 s, then end your turn"; `clear_session("self")` and end the turn. When: a natural stop above 200k, every wave end, and above 150k before an idle stretch over an hour. At the level of "Clear the maestro session at a natural stop". The HANDOFF size text stays where it is, as its own bullet.
- [ ] **Step 3: Principal bullets.** Replace "Above 250k tokens it ... asks you to clear it" and the "ask the session to update its handoff note, clear it..." bullet with: principals clear themselves the same way and report it in their wave-end line; you clear a principal only with `/orchestra:close-wave` when it has no alarm or its clear failed. Keep "Never clear a session in the middle of a task" and the Remote Control bullet.
- [ ] **Step 4: Progress-only notes.** In the bullet at `skills/maestro/SKILL.md:88` ("A note that only reports progress ... gets a one-line answer"), replace the one-line answer with: "A note that carries no decision, question, PR or pause gets an empty turn: no tool calls, no text."
- [ ] **Step 5: Rename "After a compact" to "After a compact or a clear"**: the hook's list now also starts with the first steps (load the skill, Remote Control on, the resume block, your alarm) after a clear; the three numbered steps stay. Keep the phrase "After a compact" in the heading text so the hook's compact copy still points to it.
- [ ] **Step 6: Without the desktop app.** Add a row: "The alarm and clearing yourself | The owner types `/clear` and the hook's resume carries you on".
- [ ] **Step 7: `/orchestra:init`.** Add a step before "Show the list of files": in the desktop app, open the maestro's alarm as "The alarm" in the maestro skill says. In step 9, after "orchestra itself installed at user scope ...", add: "or, when the owner keeps orchestra off by default, on in this folder's `.claude/settings.local.json` (`enabledPlugins`); `/orchestra:start-workstream` copies that entry into each new worktree."
- [ ] **Step 8: `/orchestra:status`.** In the closing paragraph: the round rewrites the table and the `## Resume` block under it, never appending.
- [ ] **Step 9: Check** `grep -n "ask you to clear\|asks you to clear\|ask the owner to clear you" plugins/orchestra/skills plugins/orchestra/commands -r` finds nothing.
- [ ] **Step 10: Commit** the three files.

### Task 4: Principals clear themselves; new workstreams get the plugin, the mode and an alarm

**Agent:** mechanic
**Risk:** normal

**Files:**
- Modify: `plugins/orchestra/commands/start-workstream.md` (steps 6 and 7)
- Modify: `plugins/orchestra/skills/principal/SKILL.md` ("Reporting to the maestro", "Context")
- Modify: `plugins/orchestra/commands/close-wave.md`
- Modify: `plugins/orchestra/skills/handoff-note/SKILL.md` (description and checklist intro)
- Modify: `plugins/orchestra/templates/HANDOFF.md` ("Context" bullet in "How we work")

**Interfaces:**
- Consumes: the alarm brief and the four clear steps from Task 3 (point to the maestro skill's "The alarm"; do not copy the brief); the registry columns `Task limit` and `Paused` that the hook reads by header (Task 1).

- [ ] **Step 1: Registry header** in start-workstream step 6 gains two columns at the end: `| Task limit | Paused |`, written as the number and `no` at registration. Add: "Change Task limit or Paused in the row when you resize or pause a workstream; the principal reads them after its next clear. Also tell a running principal in one line."
- [ ] **Step 2: Before the session** (new first part of step 7): "Turn orchestra on in the worktree. Find the `orchestra@…` entry set to `true` under `enabledPlugins` in the main checkout's `.claude/settings.local.json` (or `.claude/settings.json`). If there is one, write the same entry into `<worktree>/.claude/settings.local.json`, merging into the file when it exists and changing nothing else. A worktree does not get the main checkout's local settings, and without the entry the principal starts with no orchestra skills, agents or resume hook." Replace "check the level of ... and act on it" with the level, which now defaults to `auto`.
- [ ] **Step 3: After the session starts:** "raise it to your own permission mode with `set_session_permission_mode` (it starts in auto mode, where its alarm, clear and Remote Control calls are refused), as you raise its effort."
- [ ] **Step 4: Briefing.** Add to the quoted briefing, after the task limit: "First, open your alarm, as \"The alarm\" in the maestro skill says, keyed `<name>` in `.orchestra/alarms.json` of the main checkout `<main checkout path>`." Change "wave ends (with your context size)" to "wave ends (with your context size, and whether you cleared)".
- [ ] **Step 5: Principal skill.** "Context": at a wave end above 250k, at a natural stop, clear yourself with the four steps of "Clearing yourself" in the maestro skill, writing your handoff note (committed) as the resume. Never mid-task. A paused principal (the hook says so) only updates its status line and waits. With no alarm in `.orchestra/alarms.json`, report and wait for the maestro, as before. "Reporting": the wave-end line says the context size and whether you cleared.
- [ ] **Step 6: `/orchestra:close-wave`.** Principal part, step 4: report "cleared myself" or "need a clear (no alarm)". Step 5: above 250k with an alarm, clear yourself as the principal skill says; without one, stop and wait. Maestro part, intro line: "the fallback for a principal with no alarm, or whose own clear failed". Update the `description` frontmatter to match.
- [ ] **Step 7: Handoff note and HANDOFF.** handoff-note: the note is also the resume a principal reads after clearing itself. HANDOFF template "Context" bullet: principals and the maestro clear themselves at a natural stop through an alarm session; the hook resumes them; replace "asks the maestro to clear it" and "after writing its state to `.orchestra/status.md`" with that, keeping the thresholds.
- [ ] **Step 8: Check** `grep -rn "asks the maestro to clear\|ask the maestro to clear\|wait for the maestro" plugins/orchestra` shows only the no-alarm fallback.
- [ ] **Step 9: Commit** the five files.

### Task 5: Docs and release 1.14.0

**Agent:** mechanic
**Risk:** mechanical

**Files:**
- Modify: `docs/memory.md` ("Resuming after a clear")
- Modify: `docs/commands.md` (`/orchestra:close-wave`, `/orchestra:start-workstream`, `/orchestra:status`, `/orchestra:init` entries)
- Modify: `docs/setup.md` (Owner authorizations bullet, the hook paragraph, plugin per folder)
- Modify: `docs/index.html` (the 250k rule card, line 151)
- Modify: `plugins/orchestra/.claude-plugin/plugin.json` (`"version": "1.14.0"`)
- Modify: `CHANGELOG.md` (new top section)

- [ ] **Step 1: docs/memory.md.** "Resuming after a clear": sessions clear themselves through an alarm; after a compact or a clear the hook tells the session its role, the resume (the maestro's `## Resume` block, the principal's note and status line, task limit and pause) and, for the maestro, what waits.
- [ ] **Step 2: docs/commands.md.** close-wave: principal clears itself when it has an alarm; the maestro form is the fallback. start-workstream: turns orchestra on in the worktree, raises the permission mode, the briefing opens an alarm, registry Task limit and Paused. status: proposes the three authorization levels once, rewrites the resume block. init: opens the maestro's alarm.
- [ ] **Step 3: docs/setup.md.** Owner authorizations: opening and clearing start at `auto`; a missing line counts as `auto` for those three. The hook paragraph: it also runs after a clear, for both roles. Next to the plugin install advice: keeping orchestra off by default and on per folder works, since start-workstream copies the entry.
- [ ] **Step 4: docs/index.html** line 151: "When a wave of tasks closes above this, the principal writes its handoff note and clears itself; the hook resumes it." Keep the markup.
- [ ] **Step 5: Version and changelog.** `plugin.json` to `1.14.0`. `CHANGELOG.md`, new top section `## 1.14.0`, in plain words: the maestro and principals now clear themselves at a natural stop and come back on their own (an alarm session wakes them, the hook gives them their role and resume); opening and clearing principals and clearing the maestro default to `auto`, so the maestro no longer asks; new worktrees get orchestra turned on and the maestro's permission mode; the registry gains Task limit and Paused; progress-only notes get an empty turn. Say why: sessions stalled after a compaction, and the maestro sat at high context re-reading it on every wake. No measured savings claimed.
- [ ] **Step 6: Run the full test command** (Global Constraints). Expected: all PASS.
- [ ] **Step 7: Commit** the six files.
