# Language server find-references vs grep for explorers: results

2026-10-30. Follow-up to the graphify design (its "Measurements" section), same method. A measurement note, not a design: nothing here is built.

## Recommendation

**Adopt LSP for Python, and for TypeScript too, as an optional explorer/planner tool, in place of graphify for Python and next to it for TS.** Over 9 paired questions on three codebases, LSP-first Haiku explorers used about 30% fewer work tokens and 44% fewer tool calls (97 to 54) than grep-only ones, with equal or better accuracy. Pyright found 100% of the callers on Python, where graphify found 1 of 9. Weak points: the sample is small (one run per cell, Haiku only), and orchestra has no ready-made way to call a language server (see "What it takes").

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

## Not measured

Opus planner tasks; more than one run per cell; apps over 600 files (the 500 to 1,500 target was only partly reached); an installed Claude Code LSP plugin instead of a hand-made wrapper; a language server for code that is not strongly typed.
