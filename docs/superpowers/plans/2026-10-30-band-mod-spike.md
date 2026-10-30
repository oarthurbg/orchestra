# Band mod: live check results

Run on 2026-10-30 with a throwaway mod in the desktop app (engine 2.1.309) and under `claude -p` (Claude Code 2.1.312).

| Check | Result | Evidence |
| --- | --- | --- |
| Timer fires while the session is idle | yes | `$.clock.every(30_000)` logged ticks 4 to 9 after the last turn ended, 30 seconds apart, with no turn running. |
| App session server reachable | yes, `ccd_session_mgmt` | `$.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })` returned the session's id, title and the rest of the `get_session` result (which carries `link`). Under `claude -p` the server does not exist and the call rejects, as the fallback expects. |
| Fork outside a turn reads the main cache | yes | `$.model.fork({ prompt: 'Reply with: ok' })` from an idle tick answered `ok` with `cache_read_input_tokens` 298,670 of a 298,672-token context, `cache_creation_input_tokens` 45, `output_tokens` 70. |
| Opening a `claude://` link moves the app | yes | Opening `claude://claude.ai/epitaxy/<session id>` through the Windows opener switched the main pane to that session (checked with the app's window layout). |
| `claude -p` loads orchestra with a hooks module | yes | `claude -p` with `--plugin-dir` on a copy of `plugins/orchestra` plus a hooks module exited 0; the module's `session.start`, `turn.start`, `session.measure` and `turn.complete` hooks all ran. |
| Older Claude Code loads it | not checked | No older release was installed. |

Also seen: `session.measure` carries real `five_hour` and `seven_day` readings with `resetsAt`, and it fires during a turn as well as at its end.

Decision: every check the plan gates on passed, so Tasks 2 to 6 run as written with `APP_SESSION_SERVER = 'ccd_session_mgmt'`. Risk left open: an older Claude Code that does not know hooks modules.

## Second check (after the final review)

| Check | Result | Evidence |
| --- | --- | --- |
| A fork works while a main-thread tool call is open | yes | A fork from a timer tick while a shell call was running answered `ok` with `cache_read_input_tokens` 396,169 of a 396,564-token context. So keep-warm also covers foreground subagents and long tool calls, and needs no "not during a turn" guard. |
| Main-thread requests can be told apart | yes, from the types | `turn.step` fires per model request and carries `agentId` only for a subagent's requests ("absent on main"). |
