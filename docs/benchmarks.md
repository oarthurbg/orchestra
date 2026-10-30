# Benchmarks

Measured on 2026-10-30. Every number below comes from a script in `bench/` run on the machine described here, or, for the token table, from the measurement note it cites. Raw results are in `bench/results/`.

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

The machine was not idle: other programs ran during the runs. Each script samples how busy the whole CPU was for one second before and after it runs: 5% and 9% around the liveview run, 9% and 11% around the code navigation run.

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
| 1 | 669 | 396 | 389 | 9 | 16 / 305 | 0 | 75 MB | 76 MB | 3 KB |
| 5 | 2,998 | 1,012 | 971 | 15 | 17 / 994 | 0 | 76 MB | 81 MB | 11 KB |
| 10 | 5,894 | 1,854 | 1,825 | 11 | 18 / 4,130 | 6 | 76 MB | 82 MB | 21 KB |
| 25 | 14,583 | 3,905 | 3,909 | 5 | 17 / 3,672 | 4 | 80 MB | 92 MB | 50 KB |
| 50 | 28,799 | 7,612 | 7,758 | 15 | 7,217 / 7,984 | 11 | 81 MB | 112 MB | 99 KB |

What it shows:

- Snapshot time grows in a straight line with the number of workstreams: about 150 ms per workstream on later ticks and about 575 ms per workstream on the first.
- At 25 workstreams a tick takes 3.9 s of its 5 s interval. At 50 it takes 7.8 s, longer than the interval, so the server is busy almost all the time and a page refresh waited 7.2 s at the median.
- From 10 workstreams up, some requests that landed during a tick waited several seconds (6 of 20 at 10 workstreams).
- Serving the snapshot itself is cheap. The between-tick times cluster near 1 to 2 ms and near 15 ms in the raw runs, which looks like the step of the Windows timer, so read them as "under 20 ms".
- Memory stays near 75 to 80 MB after the first tick. It rose by 31 MB over 20 ticks at 50 workstreams; 20 ticks are too few to tell growth from garbage not yet collected.

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
| 100 | 0.70 s | 0.70 s | 12/12, 100% | 36/36, 100% | 0.07 s | 31 |
| 500 | 0.95 s | 1.01 s | 12/12, 100% | 36/36, 100% | 0.22 s | 91 |
| 2,000 | 1.88 s | 1.97 s | 12/12, 100% | 36/36, 100% | 0.79 s | 313 |
| 5,000 | 3.68 s | 4.21 s | 12/12, 100% | 36/36, 100% | 1.97 s | 763 |

TypeScript, one long import chain:

| Files | `refs` | `calls --depth 2` | `refs` recall / precision | `calls` recall / precision | grep | grep hits |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.65 s | 0.67 s | 12/12, 100% | 36/36, 100% | 0.08 s | 34 |
| 500 | 0.91 s | 1.06 s | 12/12, 100% | 36/36, 100% | 0.22 s | 94 |
| 2,000 | failed after 1.0 s | failed after 1.0 s | 0/12 | 0/36 | 0.78 s | 319 |
| 5,000 | failed after 1.0 s | failed after 1.0 s | 0/12 | 0/36 | 2.14 s | 769 |

Python with Pyright, layered imports:

| Files | `refs` | `calls --depth 2` | `refs` recall / precision | `calls` recall / precision | grep | grep hits |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.93 s | 1.11 s | 12/12, 100% | 36/36, 100% | 0.07 s | 31 |
| 500 | 1.49 s | 1.71 s | 12/12, 100% | 36/36, 100% | 0.24 s | 91 |

What it shows:

- Wherever the command answered, it answered exactly: every call site and every caller, nothing else, at every size.
- On layered TypeScript the time grows from 0.7 s at 100 files to 3.7 s (`refs`) and 4.2 s (`calls`) at 5,000 files, far inside the command's 60 s limit.
- The failure: with an import chain 2,000 or more files deep, the command exits with code 4 and `language server failed: Maximum call stack size exceeded`. The stack trace shows TypeScript's program builder following imports depth-first and recursively (`processImportedModules` calling `findSourceFile`, about 1,270 levels deep when the stack ran out). The limit comes from the depth of the import chain, not from the number of files: the layered projects of the same sizes worked. Whether real projects have chains that deep was not measured.
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
- **Other machines.** One Windows machine only. The cost of starting a process differs between systems, and by its code the liveview starts several git processes per workstream on every tick, so its numbers may be quite different elsewhere.
- **Warm language servers.** Every code navigation run started its language server from nothing. A server kept running would answer later questions faster.
- **Grep's real hit rate.** The decoy rate is a choice of the generator; grep's hit counts show that it returns lines to sort through, not how many a real codebase gives.
- **Python at 2,000 files and more,** and Python with a deep import chain: not run.
- **Tokens.** No language model ran for this page. The token table is copied from an earlier note, and its own limits (few runs, large spread between runs) apply.

## Rerun

From the repository root, with Node (measured on v24.18.0), git, grep and npm on the PATH and network access for the npm installs:

```
node bench/liveview.mjs           # about 20 minutes here
node bench/lsp.mjs                # about 2.5 minutes here, including the npm installs
node bench/lsp.mjs --no-python    # TypeScript only
node bench/codenav-tokens.mjs     # under 1 second, no runs
```

Each prints a table and overwrites its file in `bench/results/`.
