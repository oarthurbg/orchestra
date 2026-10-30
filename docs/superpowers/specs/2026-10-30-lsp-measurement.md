# Language server find-references vs grep for explorers: results

2026-10-30. Follow-up to the graphify design (its "Measurements" section), same method. A measurement note, not a design: nothing here is built.

## Recommendation

**Keep language-server navigation on the roadmap, but do not yet tell explorers to use the plugin's LSP tool on its own.** Two trials point different ways:

- With a hand-made wrapper that prints each reference with its source line and call hierarchies with function names, LSP-first Haiku explorers used about 30% fewer work tokens and 44% fewer tool calls than grep-only on 9 questions (networkx, the Python standard library, excalidraw), with equal or better accuracy. Pyright found every caller on Python, where graphify found 1 of 9.
- With the real Claude Code `LSP` tool (plugin) on a 1,960-file public app, LSP-first alone was **not cheaper than grep**: work tokens +2% (noise is ±30%), more tool calls, same accuracy. The tool returns bare positions, so agents spend calls working out the enclosing function. A first, single run of **LSP plus graphify** was the cheapest arm (8% fewer tokens, half the tool calls, 37% lower cost than grep), but one run per cell cannot separate that from noise.

Next: repeat the combined arm with several runs per question, and try a tool output that includes the source line (a wrapper or an `LSP` result format change). Python through the plugin (`pyright-lsp`) is untested.

## Method

- Each question was asked twice by a fresh Haiku subagent: grep-only (Grep, Glob, Read, shell grep) and LSP-first (a one-line `lsp refs|calls|defs <file> <symbol>` command, then grep to confirm). Same wording otherwise, same answer format (`path:line enclosing_function`).
- Work tokens = agent total minus the **77,842** tokens of a no-tool Haiku agent in this environment (matches the spec's 78k).
- Truth: LSP reference lists, filtered for imports, `__all__`, docstrings and comments, then cross-checked against grep for the who-calls and impact questions. Both arms answered independently of the truth.
- Three question types per codebase: **who-calls** (direct call sites), **impact** (every call site if the signature changes), **trace** (callers up to three levels).
- Noise: question N1 was run twice in each arm.
- Public code only. networkx (from graphify's own uv tool env, tests removed): 288 files, 117k lines. CPython 3.11 `Lib` (tests, idlelib, tkinter, lib2to3 removed): 567 files, 287k lines. excalidraw/excalidraw (MIT, shallow clone at `e7b5346`, tests removed): 599 TS/TSX files outside `node_modules`.

## Results

Work tokens in thousands, tool calls in brackets. Accuracy is recall of the truth set (precision was 100% except where noted).

| Codebase | Question | Grep only | LSP first | Accuracy (grep / LSP) |
| --- | --- | --- | --- | --- |
| networkx | N1 who-calls `shortest_path` | 25.8 [7] | 18.4 [4] | 11/11, 11/11 |
| networkx | N2 impact `pairwise` (33 sites) | 43.4 [7] | 25.7 [3] | 33/33, 33/33 |
| networkx | N3 trace `_accumulate_edges` | 29.8 [14] | 23.1 [6] | 3/3, 3/3 |
| **networkx total** | | **99.0 [28]** | **67.2 [13]** | **-32% tokens** |
| stdlib | S1 who-calls `check_output` | 23.5 [3] | 16.3 [4] | 10/10, 10/10 |
| stdlib | S2 impact `os.makedirs` (16 sites) | 19.5 [5] | 17.3 [7] | 16/16, 16/16 |
| stdlib | S3 trace `_rmtree_safe_fd` | 42.9 [14] | 33.4 [6] | 7/8 (missed `onerror`), 8/8 |
| **stdlib total** | | **85.9 [22]** | **67.0 [17]** | **-22% tokens** |
| excalidraw | T1 who-calls `isBindingEnabled` (13 sites) | 54.7 [18] | 34.6 [5] | 13/13 (one function label wrong), 13/13 |
| excalidraw | T2 impact `redrawTextBoundingBox` (19 sites) | 41.6 [6] | 27.6 [12] | 19/19, 19/19 |
| excalidraw | T3 trace `isElementInViewport` | 58.1 [23] | 42.6 [7] | same 15 functions in both |
| **excalidraw total** | | **154.3 [47]** | **104.8 [24]** | **-32% tokens** |
| **All 9 questions** | | **339.2 [97]** | **238.9 [54]** | **-30% tokens, -44% calls** |

Counting the 78k fixed overhead, whole-agent tokens fall about 10% (1.04M to 0.94M). LSP was cheaper in 9 of 9 cells.

**Noise** (N1 repeated): grep-only 25.8k and 45.4k [7, 9 calls]; LSP-first 18.4k and 11.8k [4, 3 calls]. A single cell can swing by about 20k, so only the totals and the direction count: per-cell gaps under 20k (S2, N1) mean nothing alone. LSP runs also varied less.

**Trace truth note:** on T3 and N3 both arms added callers the language server's call hierarchy lacks (calls through a function-valued parameter, calls inside a nested closure). Agents found those by reading code; they were counted as correct extras, and two hierarchy entries that never reach the target (a class listed for its constructor) were dropped by the LSP agent.

## What the runs showed

- **Python:** Pyright's `references` resolved `nx.shortest_path(...)`, `subprocess.check_output(...)`, a from-import of the same function, and ignored the same-named local `shortest_path` in `betweenness_subset.py`. It returned 12 references in 2 to 3 s. This is the case graphify failed (1 of 9, 2 of 6).
- **TypeScript:** the gain matches graphify's (about 25% at 1,263 files; 32% here at 599). It resolved the `isBindingEnabled` function against a state field of the same name: 17 LSP references against about 60 grep hits (before tests were removed).
- **Grep does well on distinctive names.** All grep-only answers were nearly complete; the LSP gain is mostly fewer exploratory calls (97 vs 54), not better recall. Expect a bigger gap on common names and re-exported symbols than these questions had.
- **Where LSP did not help:** S2 (stdlib impact, 19.5k vs 17.3k) and T2 (LSP used more calls, 12 vs 6, though fewer tokens).
- **Reliability:** one of 11 LSP-first runs hung for over 4 minutes and was killed and rerun (cause not found; the rerun finished in 43 s). Not counted in the tables.

## What it takes (setup problems met)

No CLI offers find-references: `pyright` CLI has none, and no Claude Code LSP plugin is installed here. The runs used a ~100-line Node JSON-RPC client around `pyright-langserver` and a ~50-line script calling the TypeScript language service API (same engine as tsserver). The scripts are not part of this repository.

- **typescript-language-server over stdio failed in a monorepo:** with per-package `tsconfig.json` files it returned only same-file references (2 of 70 for `getCommonBounds`), even after setting those tsconfigs aside and opening a file from the root project. Calling the language service directly worked (70 of 70). A real LSP plugin would need the right project loaded.
- **Pyright on the stdlib:** the stdlib's own `subprocess.py` loses to Pyright's bundled typeshed stub, so only 2 of 12 references showed. A `typeshedPath` override fixed it. Real projects do not have this problem.
- **Per call cost:** 2 to 4 s for a cold server on 300 to 600 files; larger repos will cost more unless a server stays resident.
- **Fresh by construction:** the server reads the working tree, so unlike graphify's graph it needs no build, no update after merges, and it sees the worktree's own branch.

## Trial with an installed plugin (2026-10-30)

The open check from the roadmap, rerun with a real Claude Code LSP plugin instead of the hand-made wrapper. First attempt: blocked by a setup problem, now understood and fixed. The token and accuracy comparison has not been rerun yet.

- **Setup:** Anthropic's own `typescript-lsp` plugin (claude-plugins-official, 1.0.0) with `typescript-language-server` 6.0.2, on a private Next.js app (1,282 TS/TSX files, one root `tsconfig.json`). Headless `claude -p` runs on Haiku.
- **What the plugin exposes:** a deferred `LSP` tool, found with ToolSearch, with nine operations: `goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`. So find-references and call hierarchy are available. Whether a subagent (the Agent tool) gets the tool was not checked; the probes ran in the top-level session.
- **The failure:** `findReferences` on a function with 33 references (the TypeScript language service called directly finds all 33) returned 1, in the same file. The same happened on excalidraw (2 of 70) and on a 3-file project, so size is not the cause.
- **The cause:** `typescript-language-server` starts two tsserver processes, a syntax-only one (`--serverMode partialSemantic`) and a full one. In its default `tsserver.useSyntaxServer: "auto"` mode it answers the first requests from the syntax-only process, which never loads the `tsconfig` project (its log shows `/dev/null/inferredProject1*` with the opened file alone). Find-references asked in that window sees one file. Waiting long enough (5 s on 3 files, 20 s on 1,200) lets the full server take over, which is why the answer depends on timing.
- **The fix:** set `initializationOptions: {"tsserver": {"useSyntaxServer": "never"}}` for the language server. Checked through the real plugin mechanism, in a headless Claude Code run on a generated 1,200-file project (each file imports three others, five true references to the target): a plugin entry identical to the official one returned 1 reference; the same entry with that option returned all 6 (the declaration and the 5 uses), in 4 turns. Checked directly too: with the option, 5 of 5 references at once; without it, 0 to 1 until the wait ends.
- **What a user does today:** the official plugin's entry has no `initializationOptions`, so a user needs their own plugin or LSP config that adds the option above; the official plugin as shipped gives wrong answers at session start.
- **Cleanup:** the plugin and the global npm packages were uninstalled afterwards; the app copy was deleted.

Next: rerun the paired trial with the fixed config on a public TypeScript repo of 1,000+ files (candidates by count of non-test `.ts`/`.tsx` files: outline/outline about 1,900, tldraw/tldraw about 2,100), which needs the owner's yes to download. Also check whether subagents get the `LSP` tool, and the same early-request problem for Pyright (`pyright-lsp`), which was not tested through the plugin.

## Paired trial with the fixed plugin on a public app (Outline, 1,960 files)

Public repo `outline/outline` (shallow clone `def01b0`, tests removed, one root `tsconfig.json`, 1,960 TS/TSX files, no `node_modules` installed except TypeScript 5.9.3 so the language server uses a known tsserver). Four arms, each a headless `claude -p` run on Haiku with the same plugin directory loaded, so the fixed overhead is identical; only the allowed tools differ:

- **grep**: Grep, Glob, Read.
- **LSP**: the plugin's `LSP` tool (fixed config, `useSyntaxServer: "never"`) plus Grep, Glob, Read.
- **graphify**: `graphify affected` / `explain` (graph built in 2 min 6 s, 20 MB, `extract --code-only`) plus Grep, Glob, Read.
- **LSP + graphify**: the language server for direct callers, graphify for the multi-hop chain, then confirm.

Three questions: **O1** who-calls `hash` (`server/utils/crypto.ts`, a name that is also a property in many places; 18 call sites), **O2** impact of a signature change to `parseDomain` (22 call sites), **O3** callers up to three levels of `canUserAccessDocument` (8 functions). Truth: the TypeScript language service called directly, filtered for imports and comments.

Work tokens are the run's total (input, cache and output, summed over turns) minus 72,978 for a no-tool run measured the same way. This sums the context re-read on every turn, so it grows with the number of turns and is **not comparable with the subagent figures above**. In thousands; tool calls in brackets; cost in USD in the last column.

| Question | Grep | LSP | graphify | LSP + graphify |
| --- | --- | --- | --- | --- |
| O1 first run | 326.8 [7] | 425.6 [22] | 372.3 [16] | 245.7 [7] |
| O1 repeat | 540.6 [26] | 529.3 [15] | | |
| O2 first run | 289.1 [28] | 389.7 [22] | 403.7 [25] | 442.6 [11] |
| O2 repeat | 375.9 [33] | 390.7 [23] | 492.3 [27] | |
| O3 first run | 834.0 [21] | 833.5 [30] | 778.6 [21] | 650.2 [10] |
| O3 repeat | 981.5 [15] | 865.9 [27] | 1,566.3 [25] | |
| **Sum, first runs** | **1,450 [56]** | **1,649 [74]** | **1,555 [62]** | **1,339 [28]** |
| Sum, mean of runs | 1,674 | 1,717 | 1,993 | 1,339 (one run) |
| Cost, first runs | $0.140 | $0.152 | $0.178 | $0.088 |

Accuracy: every arm found 18/18 (O1) and 22/22 (O2); on O3 grep, LSP and graphify found all 8 functions except that LSP and LSP + graphify each missed the `init` entry once. One false positive (graphify, O2). Repeating a question moved a cell by up to 2x (graphify O3: 779k and 1,566k; grep O1: 327k and 541k), so only the sums and large gaps mean anything.

What this says:
- **LSP alone gave no saving** here (+2% to +14%), unlike the wrapper trial. The `LSP` tool's `findReferences` returns locations without the source line, so agents either read files (17 reads in one O1 run) or issue one more LSP call per location (19 calls on O2) to learn the enclosing function; the wrapper printed the line text.
- **graphify alone was worse than grep on average** at this size, mostly from one costly O3 repeat.
- **LSP + graphify** had the lowest tokens, tool calls and cost, but it is one run per question; treat it as a lead.
- Tool-call counts and token totals both varied a lot between repeats of the same question (grep O1: 7 and 26 calls).

## Not measured

Opus planner tasks; more than one run per cell; apps over 600 files (the 500 to 1,500 target was only partly reached); an installed Claude Code LSP plugin instead of a hand-made wrapper; a language server for code that is not strongly typed.
