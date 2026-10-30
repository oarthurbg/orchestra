# Language server find-references vs grep for explorers: results

2026-10-30. Follow-up to the graphify design (its "Measurements" section), same method. A measurement note, not a design: nothing here is built.

## Recommendation

**Adopt language-server navigation for explorers and planners, in the form of a command or tool whose output includes the source line of each reference and the function name of each caller.** The plugin's `LSP` tool as it ships is not enough on its own for a small model, and the saving is smaller on a large one.

- With such a wrapper (references printed with their source line, `calls` printed as function names with file and line), Haiku explorers on a public 1,960-file TypeScript app used **65% fewer work tokens, 75% fewer tool calls and 77% lower cost than grep-only**, over 3 runs per question, with the same accuracy. On the earlier three-codebase trial (networkx, the Python standard library, excalidraw) the same kind of wrapper saved about 30% of tokens and 44% of calls, and Pyright found every caller on Python, where graphify found 1 of 9.
- With the real Claude Code `LSP` tool (plugin) on the same app, LSP alone was **not cheaper than grep** (+15% work tokens, within noise, 16% more tool calls, 12% lower cost). It returns bare positions, so agents spend calls working out the enclosing function. LSP plus graphify was in between (7% fewer tokens, 31% lower cost than grep, again within noise).
- graphify added little on top of what the language server gives; on the app it did not beat grep by itself.
- All of the above is Haiku. Repeated on Opus with high effort (same app and questions, grep, plugin LSP and wrapper arms, 3 runs per cell), the token saving shrinks: the wrapper used **16% fewer work tokens, 45% fewer tool calls and 17% lower cost** than grep, and the plugin tool used 7% more tokens but 14% fewer calls and 9% lower cost. What did not shrink is accuracy on the trace question: Opus with grep alone missed 2 of the 8 callers (`init` and `send`, reached through class-method dispatch) in all three runs, while both language-server arms found all 8. So for a stronger model the case for the language server rests more on completeness than on tokens.

What to build: a small `lsp` command (references with source lines, callers as names) that explorer and planner use before grep when a language server is available, or a change to the plugin's tool output. Not measured: Python through the plugin (`pyright-lsp`), an Opus planner task (Opus was tested as an explorer only), Sonnet, and whether subagents get the `LSP` tool. The accuracy comparison favours the wrapper arm slightly by construction: the truth sets come from the same TypeScript engine it calls.

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

Public repo `outline/outline` (shallow clone `def01b0`, tests removed, one root `tsconfig.json`, 1,960 TS/TSX files; only TypeScript 5.9.3 installed, so the language server uses a known tsserver). Four arms, each a headless `claude -p` run on Haiku with the same plugin directory loaded, so the fixed overhead is identical; only the allowed tools differ:

- **grep**: Grep, Glob, Read.
- **LSP (plugin)**: the plugin's `LSP` tool (fixed config, `useSyntaxServer: "never"`) plus Grep, Glob, Read.
- **LSP (wrapper)**: a shell command around the same TypeScript language service. `refs` prints each reference with its source line; `calls` prints incoming callers as function name, file and line, to a chosen depth. Plus Grep, Glob, Read.
- **LSP + graphify**: the plugin's `LSP` tool for direct callers, `graphify affected` (graph built in 2 min, 20 MB, `extract --code-only`) for the multi-hop chain, then confirm.

Three questions: **O1** who-calls `hash` (`server/utils/crypto.ts`, a name that is also a property in many places; 18 call sites), **O2** impact of a signature change to `parseDomain` (22 call sites), **O3** callers up to three levels of `canUserAccessDocument` (8 functions). Truth: the TypeScript language service called directly, filtered for imports and comments. **3 fresh runs per cell**, 36 runs.

Work tokens are the run's total (input, cache and output, summed over turns) minus 72,978 for a no-tool run measured the same way. This sums the context re-read on every turn, so it grows with the number of turns and is **not comparable with the subagent figures above**. Cells show the mean of 3 runs in thousands, with tool calls in brackets.

| Question | Grep | LSP (plugin) | LSP (wrapper) | LSP + graphify |
| --- | --- | --- | --- | --- |
| O1 who-calls | 328 [15] | 423 [11] | **164 [2]** | 323 [11] |
| O2 impact | 333 [24] | 497 [30] | **354 [11]** | 487 [31] |
| O3 trace | 1,208 [23] | 1,226 [31] | **139 [2]** | 928 [27] |
| **Sum of cell means** | **1,870 [62]** | **2,146 [72]** | **657 [15]** | **1,737 [68]** |
| Cost, sum of cell means | $0.201 | $0.176 | $0.046 | $0.139 |
| Per-run spread (std dev) | 449 | 441 | 114 | 266 |

Accuracy: all four arms found 18/18 (O1) and 22/22 (O2) in every run. On O3 every run found all 8 functions except one grep run that missed `init` (and listed five task entry points that call it indirectly). Grep and plugin-LSP runs also added a ninth, `start`, an indirect caller, which is not counted against them.

Earlier pilot (1 to 2 runs per cell, same questions, plus a graphify-only arm): the same ordering for the first three arms; graphify alone was 7% worse than grep in the first runs and 19% worse over the repeats (one run cost 2x another). It was dropped from the repeat.

What this says:
- **Output shape decides.** The wrapper answered the trace question in 1 to 3 calls because `calls` returns function names; grep and the plugin tool needed 20 to 30. For who-calls and impact the token saving is smaller or absent (O1: half the tokens of grep; O2: 6% more, with 11 calls instead of 24) because the agent still has to name the enclosing function of each of 22 sites.
- **The plugin's `LSP` tool alone gave no saving.** `findReferences` returns locations without the source line, so agents read files (17 reads in one O1 run) or issue another LSP call per location (19 calls on O2).
- **LSP + graphify** helped on the trace question (23% fewer tokens than grep) and hurt on O2; neither gap is clearly outside the noise.
- **Noise is large.** The same question on the same arm varied up to 2.7x (plugin LSP, O1: 232k to 624k), so single runs say little; the wrapper's gap to grep is the only one that clearly exceeds it.

## The same trial on Opus (high effort)

Same Outline checkout (`def01b0`), questions, truth, plugin directory and accounting as above, but explorers run as `claude-opus-5-5` with `--effort high`; the no-tool baseline for that model is 72,820 tokens. Three arms (grep, plugin LSP, wrapper), 3 runs per cell, 27 runs. LSP + graphify and graphify alone were not repeated. Cells show the mean work tokens in thousands, with the mean tool calls in brackets.

| Question | Grep | LSP (plugin) | LSP (wrapper) |
| --- | --- | --- | --- |
| O1 who-calls | 503 [15] | **211 [5]** | 236 [3] |
| O2 impact | 546 [20] | 536 [12] | **501 [12]** |
| O3 trace | **550 [12]**, 6/8 found | 959 [24], 8/8 | 613 [11], 8/8 |
| **Sum of cell means** | **1,599 [47]** | **1,707 [40]** | **1,351 [26]** |
| Cost, sum of cell means | $2.18 | $1.98 | $1.82 |

Haiku, for comparison (sum of cell means): grep 1,870, plugin LSP 2,146, wrapper 657. The per-run spread is again large (for example plugin LSP on O3: 737k to 1,323k).

- **Opus with grep was not worse in tokens on the trace question** (550k against 613k for the wrapper), but it was **less complete**: in all three runs it missed `init` and `send`, callers that only show up through class-method dispatch. Both language-server arms found them every time.
- **Who-calls and impact:** all arms found 18/18 and 22/22 in every run. The plugin tool did best on who-calls (211k against 503k) and the wrapper on impact, but gaps of this size are inside the noise except the first.
- **Cost per run is high on Opus** ($0.43 to $0.98), mostly from the cached context re-read on each turn, so fewer turns matter more there than on Haiku.
- **Why the gap narrowed:** Opus needs fewer exploratory calls with grep (47 against 62 for Haiku, over the same questions), so there is less for the language server to remove.

## Not measured

Opus planner tasks (Opus was tested as an explorer only); Sonnet; LSP + graphify on Opus; Python through the installed plugin (`pyright-lsp`); whether subagents get the `LSP` tool; a language server for code that is not strongly typed.
