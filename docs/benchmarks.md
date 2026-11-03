# Benchmarks

[README](../README.md) · [Setup](setup.md) · [Commands](commands.md) · [Agents](agents.md) · [Stages, modes and skills](stages.md) · [Memory and handoff](memory.md) · [The band](band.md) · [The liveview](liveview.md) · **Benchmarks**

Every number below comes from a script in `bench/`, run on 2026-10-31 (UTC) on the machine described here. The token table is copied from an earlier measurement note. Raw results are in `bench/results/`.

| Machine | |
| --- | --- |
| CPU | AMD Ryzen 9 5900X, 12 cores, 24 logical |
| RAM | 32 GB |
| OS | Windows 11 (Windows_NT 10.0.26300) |
| Tools | Node v24.18.0, git 2.55.0, GNU grep 3.0 (from Git Bash), TypeScript 5.9.3, Pyright 1.1.414 |

## Liveview under load

**Result.** At 50 workstreams a refresh (server tick) takes 0.5 s of its 5 s interval. No request waited more than 0.3 s while the server refreshed.

Times in milliseconds, medians unless marked.

| Workstreams | Server tick | First snapshot | Later snapshot | `/api/snapshot` between ticks | `/api/snapshot` while ticking, median / max | Requests over 1 s (of 20) | RSS after first tick / after 20 ticks | Snapshot size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 285 | 648 | 284 | 15 | 17 / 291 | 0 | 75 / 76 MB | 3 KB |
| 5 | 301 | 2,114 | 309 | 15 | 17 / 291 | 0 | 76 / 81 MB | 11 KB |
| 10 | 324 | 3,996 | 324 | 15 | 17 / 270 | 0 | 76 / 82 MB | 21 KB |
| 25 | 382 | 9,577 | 377 | 2 | 17 / 280 | 0 | 81 / 92 MB | 50 KB |
| 50 | 478 | 18,898 | 472 | 10 | 18 / 324 | 0 | 82 / 96 MB | 99 KB |

- A later tick costs about 280 ms of fixed git calls plus about 4 ms per workstream.
- The first tick still reads each plan's history from git, about 380 ms per workstream: 19 s at 50 workstreams, during which the server answers nothing.
- Serving the snapshot is cheap: read the between-tick times as "under 20 ms" (they cluster near 1 to 2 ms and 15 ms, the step of the Windows timer).

**Method.** [`bench/liveview.mjs`](../bench/liveview.mjs) builds a synthetic orchestra project for 1, 5, 10, 25 and 50 workstreams: a real git repository with one branch, worktree, registry row, plan (8 tasks, 0 to 7 ticked, one commit per tick) and session report per workstream, one session in three waiting. Each measure is the median of 5 runs after 1 warm-up. The first snapshot uses empty git caches, as on a newly started server; later snapshots reuse them. The `/api/snapshot` times come from a real server in a child process, the "while ticking" ones from 20 requests 500 ms apart while its own 5 s timer runs. Every snapshot is checked (one row per workstream, every waiting session in the inbox, no error); all checks passed.

**Limits.**

- Projects are synthetic, with small plans (8 tasks, at most 8 commits).
- The transcript folder was empty, so reading transcripts for the limit meters is not measured. The first tick will be slower on a machine with many recent transcripts.
- The 20 ticks ran back to back, not every 5 s for hours: memory rose 14 MB at 50 workstreams, too few ticks to tell growth from uncollected garbage.
- One Windows machine, not idle during the run. Starting a process costs differently elsewhere, and the liveview starts git processes on every tick.

## Code navigation at scale

**Result.** The `lsp` command found every call site and every caller, and nothing else, at every size. On 5,000 TypeScript files it answers in about 4 s, far inside its 60 s limit. Grep is faster, but returns 31 to 769 lines against 12 call sites, because it also matches imports, the declaration and decoys.

`refs` must find 12 call sites; `calls --depth 2` must find 36 callers. Every row scored 12/12 and 36/36 at 100% precision. Times are the median of 3 runs.

| Project | Files | `refs` | `calls --depth 2` | grep | grep hits |
| --- | --- | --- | --- | --- | --- |
| TypeScript, layered | 100 | 0.72 s | 0.72 s | 0.07 s | 31 |
| TypeScript, layered | 500 | 0.98 s | 1.03 s | 0.24 s | 91 |
| TypeScript, layered | 2,000 | 1.88 s | 2.03 s | 0.82 s | 313 |
| TypeScript, layered | 5,000 | 4.13 s | 4.50 s | 2.07 s | 763 |
| TypeScript, one long chain | 100 | 0.70 s | 0.69 s | 0.07 s | 34 |
| TypeScript, one long chain | 500 | 0.93 s | 1.02 s | 0.22 s | 94 |
| TypeScript, one long chain | 2,000 | 1.93 s | 2.11 s | 0.87 s | 319 |
| TypeScript, one long chain | 5,000 | 3.91 s | 4.38 s | 2.05 s | 769 |
| Python (Pyright), layered | 100 | 0.98 s | 1.06 s | 0.06 s | 31 |
| Python (Pyright), layered | 500 | 1.36 s | 1.61 s | 0.21 s | 91 |

**Method.** [`bench/lsp.mjs`](../bench/lsp.mjs) generates projects with a known call graph: one function `target`, 12 callers in their own files, and 2 callers of each of those. Every 20th file adds a decoy: a method also named `target`, a call to it and a comment with the word. *Layered* projects import in 10 layers (longest chain 11 files); *one long chain* has file i import files i+1 to i+3, a stress case. Each run is `node plugins/orchestra/lsp/lsp.mjs refs|calls <file> target` in a fresh process, so the language server starts cold. Grep is `grep -rnw --include=*.ts target .` (or `*.py`). TypeScript and Pyright are installed into temp folders, nothing globally.

**Limits.**

- Projects are synthetic. Real code has bigger files and uneven imports.
- Every run started the language server cold; a running server answers faster.
- The decoy rate was chosen, not measured, so grep's hit counts show it returns lines to sort through, not how many a real codebase gives.
- Not run: Python at 2,000 files or more, Python with a long chain, and chains longer than 5,000 files.
- One Windows machine, not idle during the run.

## Code navigation tokens

**Result.** With the `lsp` command, Haiku used 30% fewer work tokens on 3 open-source codebases (239k against 339k with grep), and 65% fewer on a 1,960-file TypeScript app (657k against 1,870k). Opus on the same app used 16% fewer (1,351k against 1,599k). Every language-server arm found all 8 callers on the app's trace question; grep missed some.

Sums over each table's questions. Work tokens in thousands, tool calls in brackets.

| Table | Grep | Plugin LSP tool | `lsp` wrapper command | LSP plus graphify |
| --- | --- | --- | --- | --- |
| Haiku, 3 codebases, 9 questions, 1 run each | 339.2 [97] | | 238.9 [54] | |
| Haiku, 1,960-file TypeScript app, 3 questions, mean of 3 runs | 1,870 [62] | 2,146 [72] | 657 [15] | 1,737 [68] |
| Opus (high effort), same app and questions, mean of 3 runs | 1,599 [47] | 1,707 [40] | 1,351 [26] | |

Recall on the app's trace question: Haiku with grep found 8 of 8 callers in 2 of 3 runs and 7 in the third; Opus with grep found 6 of 8 in every run; every language-server arm found 8 of 8 in every run.

**Method.** An agent answered who-calls, impact and trace questions about real code, once with grep only and once with a language server. Work tokens are the agent's tokens minus those of a no-tool run. [`bench/codenav-tokens.mjs`](../bench/codenav-tokens.mjs) runs nothing: it copies the published figures, per question and arm, from `docs/superpowers/specs/2026-10-30-lsp-measurement.md` into `bench/results/codenav-tokens.json`. That note has the full method.

**Limits.**

- Not rerun for this page. Few runs per cell, with a large spread between runs.
- The first table counts tokens differently from the other two; do not compare across them.

## Rerun

From the repository root, with Node, git, grep and npm on the PATH, and network access for the npm installs:

```
node bench/liveview.mjs           # about 9 minutes here
node bench/lsp.mjs                # about 3 minutes here, including the npm installs
node bench/lsp.mjs --no-python    # TypeScript only
node bench/codenav-tokens.mjs     # under 1 second, no runs
```

Each prints a table and overwrites its file in `bench/results/`.
