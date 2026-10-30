---
description: Start or stop the liveview, a local page with limits, workstream progress and ETAs (uses no LLM tokens)
argument-hint: "[stop]"
---

Start or stop orchestra's liveview for this project. It needs Node 18 or newer on PATH.

1. Find the main checkout: `git rev-parse --path-format=absolute --git-common-dir` prints `<main checkout>/.git`; the main checkout is its parent folder. If it has no `.orchestra/` folder, say this is not an orchestra project (run `/orchestra:init` first) and stop.
2. If `$ARGUMENTS` is `stop`, run `node "${CLAUDE_PLUGIN_ROOT}/liveview/server.mjs" --root "<main checkout>" --stop` and say it stopped.
3. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/liveview/server.mjs" --root "<main checkout>" --detach`. It prints the URL, and starts a server only when none is running for this project. Give the owner that URL.
4. If `node` is not found, say the liveview needs Node 18 or newer, and stop.
