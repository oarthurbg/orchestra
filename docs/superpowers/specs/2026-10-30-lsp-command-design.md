# Code navigation command: design

Phase 2, item 5 of `docs/ROADMAP.md`. Built on the measurements in [`2026-10-30-lsp-measurement.md`](2026-10-30-lsp-measurement.md): a command whose output carries each reference's source line and each caller's function name cut Haiku explorers' work tokens by about 30% across three codebases and 65% on a 1,960-file app. On Opus the saving shrank to about 16%, but grep missed 2 of 8 callers that the language server found. Claude Code's own `LSP` tool, which prints bare positions, saved nothing.

The owner asked for the roadmap to be finished without stopping, so the open choices below were decided by the maestro, each with its reason.

## Goal

Explorers and planners answer "who calls X", "what breaks if X changes" and "how is X reached" with a language server instead of sweeping files with grep. One command, no build step, no index to keep up to date, and grep as the fallback whenever the command cannot answer.

## The command

`node "${CLAUDE_PLUGIN_ROOT}/lsp/lsp.mjs" <subcommand> <file> <symbol> [options]`, run from anywhere inside the project.

- **Where it lives:** `plugins/orchestra/lsp/lsp.mjs`, plus small modules beside it if it grows. Zero dependencies of its own, like the liveview.
- **Why not `bin/`:** Claude Code puts a plugin's `bin/` folder on the Bash tool's `PATH`, but its docs say nothing about subagents or Git Bash on Windows. `${CLAUDE_PLUGIN_ROOT}` is substituted in agent bodies, so each agent's own file carries the full command and nothing depends on `PATH`.

### Subcommands

| Subcommand | Answers | Output, one line per item |
| --- | --- | --- |
| `refs <file> <symbol>` | every reference to the symbol | `path:line  enclosing  \|  source line` |
| `calls <file> <symbol> [--depth N]` | who calls it, up to N levels (default 1, at most 3) | `name  path:line`, indented two spaces per level |
| `defs <file> <symbol>` | where a symbol used in this file is defined | `path:line  enclosing  \|  source line` |

- `<file>` is the file where the symbol is declared (for `refs` and `calls`) or used (for `defs`), relative to the current folder or absolute.
- `<symbol>` is an identifier. The command finds its first occurrence in the file as a declaration (for `refs` and `calls`) or any occurrence (for `defs`). `--line N` picks the occurrence on line N instead, for names declared twice.
- `enclosing` is the name of the innermost function, method or class around the line (`Class.method` for a method), or `<module>` at the top level.
- `refs` marks the declaration line `(declaration)` and import lines `(import)` after the enclosing name, so a reader can skip them without opening the file.
- Paths are relative to the project root, with forward slashes, so the output is the same on every system.
- The source line is trimmed and cut at 160 characters.
- At most 200 lines are printed; a last line says how many more there are.

### Languages

- **TypeScript and JavaScript** (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`): the TypeScript language service of the project's own `typescript` package, resolved from the project root. The project is loaded from the nearest `tsconfig.json` or `jsconfig.json` above the file, or the file's folder alone when there is none. Calling the language service directly avoids the two problems the measurements met with `typescript-language-server`: same-file answers from its syntax-only server, and monorepos with one `tsconfig.json` per package.
- **Python** (`.py`, `.pyi`): `pyright-langserver --stdio` from `PATH`, spoken to over JSON-RPC, rooted at the project root.
- **Anything else,** or a language whose server is missing: no answer (exit code 3), and the agent uses grep.

The project root is the nearest folder above the file holding `.git` (a folder or, in a worktree, a file).

### Exit codes and messages

| Code | Meaning | Printed (stderr, one line) |
| --- | --- | --- |
| 0 | answered, even with no references | the answer on stdout |
| 1 | the symbol is not in the file | `symbol <name> not found in <file>` |
| 2 | bad arguments | the usage line |
| 3 | no language server for this file | why: `no typescript package in this project`, `pyright-langserver not on PATH (npm install -g pyright)`, `unsupported file type .rb` |
| 4 | the server failed or took longer than 60 s | the reason |

Each run starts the language service, answers and exits. `shortcut: a cold start costs 2 to 4 s on 300 to 600 files and more on larger repos; keep a server resident per worktree if agents start waiting on it.`

## Who uses it

- **explorer** and **planner**: their agent files gain a "Code navigation" paragraph. For a who-calls, impact or trace question about TypeScript, JavaScript or Python, run the command first (`refs` for who-calls and impact, `calls --depth N` for trace), then open files only to answer what the command did not. On exit code 3 or 4, use grep and say so in the answer. Grep stays the tool for text that is not a symbol: strings, comments, config keys, file names.
- Nobody else changes. The principal and the maestro brief these agents as before.

## Setup for the owner

- TypeScript projects need nothing: the project's own `typescript` package is used.
- Python projects need Pyright on `PATH` (`npm install -g pyright` or `pip install pyright`). `/orchestra:init` checks for it when the project has Python files and, if it is missing, tells the owner the one command to install it. It installs nothing itself.

## Testing

- **Pure logic, no server:** argument parsing, finding the symbol's position in a file, the enclosing-name rules for TypeScript and Python, import and declaration marks, output formatting and the 200-line cap, exit codes 1, 2 and 3.
- **TypeScript, end to end:** a fixture project under `plugins/orchestra/lsp/tests/fixtures/ts/` with a function called from three files, one of them through a re-export, plus a class method and a same-named local variable in another file that must not be counted. `refs` finds exactly the right lines with their enclosing names; `calls --depth 2` gives the expected tree; `defs` lands on the declaration. The `typescript` package for the test comes from the machine (the fixture's own `node_modules` if present, then a global install); without it the test is skipped with a message saying so.
- **Python, end to end:** a small fixture under `tests/fixtures/py/` with the same shape, skipped unless `pyright-langserver` is on `PATH`.
- Run with `node --test plugins/orchestra/lsp/tests/*.test.mjs`. `claude plugin validate` must still pass.

## Docs

- README: a short "Code navigation" section (what it is, the Pyright note for Python, that grep is the fallback).
- `docs/agents.md`: one line each under explorer and planner.
- ROADMAP item 5: built, linking this spec. Item 4 stays parked.
- Plugin version 0.6.0.

## Out of scope

- A resident server per worktree (the shortcut above).
- Other languages (Go, Rust, Java): the same command could add them through their language servers later.
- Changing Claude Code's own `LSP` tool or the official LSP plugins.
- Rename, hover and outgoing calls.
