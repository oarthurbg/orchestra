---
description: Token spend of this project per branch and per session, from Claude Code's own transcripts
argument-hint: "[days]"
---

Show where this project's tokens went. It reads only Claude Code's transcripts on this computer and changes nothing.

1. From the project (main checkout or any worktree), run:
   `node "${CLAUDE_PLUGIN_ROOT}/cost/cost.mjs" --root . --days <n>`
   with `<n>` from `$ARGUMENTS` when it is a positive number, else leave `--days` out for all time. If it exits non-zero, show its one-line error and stop.
2. Show its two tables as they are: per branch, then per session.
3. Then at most 3 lines on what stands out: the maestro's share (its session usually sits on the integration branch), the most expensive workstream, and a session that keeps re-reading a large context (much cache read against little output) and would gain from a clear. The weighted units are relative cost, not dollars.
