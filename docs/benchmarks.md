# Benchmarks

[README](../README.md) · [Setup](setup.md) · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [The band](band.md) · [The liveview](liveview.md) · **Benchmarks**

Measured on 2026-10-30; the code navigation numbers were rerun on 2026-10-31 (UTC) after the deep import chain fix, and the liveview numbers on the same day after the per-workstream git calls were removed. Every number below comes from a script in `bench/` run on the machine described here, or, for the token table, from the measurement note it cites. Raw results are in `bench/results/`.

## Machine

| | |
| --- | --- |
| CPU | AMD Ryzen 9 5900X 12-Core Processor, 24 logical cores |
| RAM | 32 GB |
| OS | Windows_NT 10.0.26300 (Windows 11) |
| Node | v24.18.0 |
| git | 2.55.0 |
| grep | GNU grep 3.0, the one that ships with Git Bash |
| TypeScript, Pyright | 5.9.3 and 1.1.414, installed by the script into temp folders |

The machine was not idle: other programs ran during the runs. Each script samples how busy the whole CPU was for one second before and after it runs: 10% and 1% around the liveview run, 5% and 9% around the code navigation run.

## Liveview under load

### Method

`bench/liveview.mjs` builds one synthetic orchestra project for each size of 1, 5, 10, 25 and 50 workstreams, in the OS temp folder. Each project is a real git repository with:

- a `CLAUDE.md` naming the integration and production branches, and a handoff note with three queued workstreams;
- one registry row per workstream in `.orchestra/workstreams.md`, each with its own branch and real `git worktree`;
- one plan file per workstream with 8 tasks, of which 0 to 7 are ticked, one commit per tick, 40 to 90 minutes apart;
- one session report per workstream in `.orchestra/sessions/`, one in three of them `waiting` with three options, plus a maestro report.

For each size it measures, as the median of 5 runs after 1 warm-up:

- **First snapshot:** `gather()` then `buildSnapshot()`, called directly, on a fresh copy of `sources.mjs`, so its per-worktree git caches start empty, as on a newly started server.
- **Later snapshots:** the same calls on one module copy that has already run once, so cached git results are reused while a worktree's HEAD does not move, as on every tick after the first.
- **`/api/snapshot` between ticks:** a GET on a started server (in a child process) with its timer off. The route only serializes the snapshot the last tick built.
- **`/api/snapshot` while ticking:** 20 GETs, 500 ms apart, on a server whose own 5 s timer runs, as in real use. A tick is synchronous, so a request that arrives during one waits for it to end.
- **Server memory:** the child process's RSS after the first tick and after 20 more ticks run back to back.

It also checks every snapshot: one row per workstream, every waiting session in the inbox, 8 tasks per plan, no error. All checks passed at every size. The transcript folder given to the server is empty and the ETA history is empty. The temp projects are deleted at the end.

### Results

Times in milliseconds, medians unless marked.

| Workstreams | First snapshot | Later snapshot | Server tick | `/api/snapshot` between ticks | `/api/snapshot` while ticking, median / max | Requests over 1 s (of 20) | RSS after first tick | RSS after 20 ticks | Snapshot size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 719 | 317 | 316 | 9 | 17 / 257 | 0 | 75 MB | 76 MB | 3 KB |
| 5 | 2,884 | 317 | 319 | 15 | 17 / 287 | 0 | 76 MB | 81 MB | 11 KB |
| 10 | 5,453 | 335 | 350 | 10 | 17 / 294 | 0 | 76 MB | 82 MB | 21 KB |
| 25 | 12,801 | 375 | 392 | 15 | 17 / 292 | 0 | 81 MB | 93 MB | 50 KB |
| 50 | 24,926 | 474 | 491 | 15 | 17 / 284 | 0 | 81 MB | 95 MB | 99 KB |

Before plugin 1.2.3, server tick: 389 ms at 1 workstream, 971 at 5, 1,825 at 10, 3,909 at 25 and 7,758 at 50, about 150 ms per workstream. Each tick then started 4 git processes per workstream (2 to read HEAD, 2 to find the plan the branch adds), at about 36 ms each on this machine. Now one `git worktree list` gives every HEAD, the integration branch is read once per tick, and the plan a branch adds is reused until its HEAD or the integration branch moves, so a later tick starts no git process per workstream.

What it shows:

- A later tick costs about 315 ms of fixed git calls plus about 3.5 ms per workstream. At 50 workstreams it takes 0.5 s of its 5 s interval.
- No request waited more than 0.3 s, at any size, while the server's own timer ran.
- The first tick still reads each worktree's plan history from git, about 500 ms per workstream: 25 s at 50 workstreams, during which the server answers nothing.
- Serving the snapshot itself is cheap. The between-tick times cluster near 1 to 2 ms and near 15 ms in the raw runs, which looks like the step of the Windows timer, so read them as "under 20 ms".
- Memory stays near 75 to 80 MB after the first tick. It rose by 14 MB over 20 ticks at 50 workstreams; 20 ticks are too few to tell growth from garbage not yet collected.

## Code navigation at scale

### Method

`bench/lsp.mjs` generates synthetic projects with a known call graph and runs the plugin's command on them as a user would: `node plugins/orchestra/lsp/lsp.mjs refs <file> target` and `... calls <file> target --depth 2`, each a fresh process, so the language server starts cold every time. Wall time is the median of 3 runs.

- **The call graph:** one function `target`; 12 functions that call it, one call site each, each in its own file; and 2 callers of each of those, 24 functions in their own files. The right answer for `refs` is the 12 call sites (plus 12 imports and the declaration, which the command marks and which are not scored). The right answer for `calls --depth 2` is the 12 direct callers and the 24 second-level ones, by name, file and line.
- **Decoys:** every 20th plain file has a class with a method also named `target`, a call to that method, and a comment with the word. They should not appear in a language-server answer, and they do appear in grep's.
- **Two import shapes:**
  - *layered:* 10 layers; each file imports 3 files from the layer below, the bottom layer imports 3 base files that import nothing, so the longest import chain is 11 files. Closer to real code. The target sits in the bottom layer, its callers in the middle, theirs at the top.
  - *chain:* file i imports files i+1, i+2 and i+3, so one import chain runs through the whole project. A stress case.
- **Sizes:** TypeScript at 100, 500, 2,000 and 5,000 files in both shapes; Python, layered, at 100 and 500 files.
- **Installs:** `typescript@5` goes into one temp folder with `npm install --prefix`, and each TypeScript project gets a `node_modules` junction to it. Pyright goes into another temp folder, and only the benchmark's child processes get its `bin` folder on their PATH. Nothing is installed globally; the temp folders are deleted at the end.
- **Grep:** `grep -rnw --include=*.ts target .` (or `*.py`), median of 3 runs, for time and hit count only.

Recall is the share of the right answers the command returned. Precision is the share of what it returned that is right.

### Results

TypeScript, layered imports:

| Files | `refs` | `calls --depth 2` | `refs` recall / precision | `calls` recall / precision | grep | grep hits |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.72 s | 0.72 s | 12/12, 100% | 36/36, 100% | 0.07 s | 31 |
| 500 | 0.98 s | 1.03 s | 12/12, 100% | 36/36, 100% | 0.24 s | 91 |
| 2,000 | 1.88 s | 2.03 s | 12/12, 100% | 36/36, 100% | 0.82 s | 313 |
| 5,000 | 4.13 s | 4.50 s | 12/12, 100% | 36/36, 100% | 2.07 s | 763 |

TypeScript, one long import chain:

| Files | `refs` | `calls --depth 2` | `refs` recall / precision | `calls` recall / precision | grep | grep hits |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.70 s | 0.69 s | 12/12, 100% | 36/36, 100% | 0.07 s | 34 |
| 500 | 0.93 s | 1.02 s | 12/12, 100% | 36/36, 100% | 0.22 s | 94 |
| 2,000 | 1.93 s | 2.11 s | 12/12, 100% | 36/36, 100% | 0.87 s | 319 |
| 5,000 | 3.91 s | 4.38 s | 12/12, 100% | 36/36, 100% | 2.05 s | 769 |

Python with Pyright, layered imports:

| Files | `refs` | `calls --depth 2` | `refs` recall / precision | `calls` recall / precision | grep | grep hits |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.98 s | 1.06 s | 12/12, 100% | 36/36, 100% | 0.06 s | 31 |
| 500 | 1.36 s | 1.61 s | 12/12, 100% | 36/36, 100% | 0.21 s | 91 |

What it shows:

- Wherever the command answered, it answered exactly: every call site and every caller, nothing else, at every size.
- On TypeScript the time grows from 0.7 s at 100 files to 3.9 to 4.1 s (`refs`) and 4.4 to 4.5 s (`calls`) at 5,000 files, in both import shapes, far inside the command's 60 s limit.
- Fixed: the first run of this benchmark failed on the chain projects of 2,000 and 5,000 files, both commands exiting with code 4 and `language server failed: Maximum call stack size exceeded` after about 1.0 s. TypeScript's program builder follows imports depth-first and recursively (`processImportedModules` calling `findSourceFile`), a few stack frames per level, and node's default stack of about 1 MB ran out near 1,300 levels. The command now runs the language service in a worker thread with a 64 MB stack, and the same chains answer in 1.9 to 4.4 s with full recall and precision. If a chain is ever deeper than that stack holds, the command still exits 4, but says it ran out of stack and to use grep.
- Against the run before the fix, the rows that worked then changed by between 0.13 s faster and 0.45 s slower, the most on layered 5,000 files (3.68 to 4.13 s for `refs`). Starting the worker thread costs a little, but two single runs on a machine that was not idle cannot separate that cost from noise.
- Grep is faster up to 2,000 files and about half the command's time at 5,000. Its hit count is not an answer: 31 to 769 lines against 12 call sites, because it also returns imports, the declaration and every decoy line. How many extra hits a real codebase gives depends on how common the name is; the decoy rate here was chosen, not measured.

## Code navigation tokens (published earlier, not rerun)

### Method

`bench/codenav-tokens.mjs` runs nothing. It copies the token figures already published in `docs/superpowers/specs/2026-10-30-lsp-measurement.md` into `bench/results/codenav-tokens.json`, per question and arm: work tokens, tool calls, and recall where the note gives it. See that note for how they were measured. In short: an agent answered who-calls, impact and trace questions about real public code, once with grep tools only and once with a language server, and work tokens are the agent's tokens minus those of a no-tool run.

### Results

Sums over each table's questions. Work tokens in thousands, tool calls in brackets.

| Table | Grep | Plugin LSP tool | `lsp` wrapper command | LSP plus graphify |
| --- | --- | --- | --- | --- |
| Haiku, 3 codebases, 9 questions, 1 run each | 339.2 [97] | | 238.9 [54] | |
| Haiku, 1,960-file TypeScript app, 3 questions, mean of 3 runs | 1,870 [62] | 2,146 [72] | 657 [15] | 1,737 [68] |
| Opus (high effort), same app and questions, mean of 3 runs | 1,599 [47] | 1,707 [40] | 1,351 [26] | |

Recall on the trace question of the 1,960-file app: Haiku with grep found all 8 callers in 2 of 3 runs and 7 in the third; Opus with grep found 6 of 8 in every run; every language-server arm found 8 of 8 in every run. The first table and the other two count tokens differently and cannot be compared with each other.

## What this does not show

- **Real projects.** All projects are generated. Real repositories have bigger files, uneven import graphs, more branches and more history.
- **Liveview transcripts.** The server was given an empty transcript folder, so the cost of reading session transcripts for the limit meters is not in these numbers. On a machine with a lot of recent transcripts the first tick will be slower.
- **Liveview in steady use.** The 20 ticks ran back to back over seconds, not every 5 s over hours, so memory growth over a long session is not measured. Plans have 8 tasks and at most 8 commits each.
- **Other machines.** One Windows machine only. The cost of starting a process differs between systems, and the liveview starts a few git processes on every tick and several per workstream on its first, so its numbers may be quite different elsewhere.
- **Warm language servers.** Every code navigation run started its language server from nothing. A server kept running would answer later questions faster.
- **Grep's real hit rate.** The decoy rate is a choice of the generator; grep's hit counts show that it returns lines to sort through, not how many a real codebase gives.
- **Python at 2,000 files and more,** and Python with a deep import chain: not run.
- **Import chains deeper than 5,000 files:** not run, so how deep a chain the 64 MB stack holds was not measured.
- **Tokens.** No language model ran for this page. The token table is copied from an earlier note, and its own limits (few runs, large spread between runs) apply.

## Rerun

From the repository root, with Node (measured on v24.18.0), git, grep and npm on the PATH and network access for the npm installs:

```
node bench/liveview.mjs           # about 11 minutes here
node bench/lsp.mjs                # about 3 minutes here, including the npm installs
node bench/lsp.mjs --no-python    # TypeScript only
node bench/codenav-tokens.mjs     # under 1 second, no runs
```

Each prints a table and overwrites its file in `bench/results/`.
