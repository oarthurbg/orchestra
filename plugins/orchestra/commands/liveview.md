---
description: Start or stop the liveview, a local page with limits, workstream progress and ETAs (uses no LLM tokens)
argument-hint: "[stop | phone]"
---

Start or stop orchestra's liveview for this project. It needs Node 18 or newer on PATH.

1. Find the main checkout: `git rev-parse --path-format=absolute --git-common-dir` prints `<main checkout>/.git`; the main checkout is its parent folder. If it has no `.orchestra/` folder, say this is not an orchestra project (run `/orchestra:init` first) and stop.
2. If `$ARGUMENTS` is `stop`, run `node "${CLAUDE_PLUGIN_ROOT}/liveview/server.mjs" --root "<main checkout>" --stop` and say it stopped.
3. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/liveview/server.mjs" --root "<main checkout>" --detach`, adding `--tailnet` when `$ARGUMENTS` is `phone`. It prints the URL, and starts a server only when none is running for this project. Give the owner that URL. A second line is the address for their phone and other devices on Tailscale; give it too. If it says there is no phone address, pass that on: Tailscale must be running, and a liveview already running without it has to be stopped and started again with `phone`.
4. If `node` is not found, say the liveview needs Node 18 or newer, and stop.
