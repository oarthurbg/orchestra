# Code graph: design

Phase 2, item 4 of `docs/ROADMAP.md`. Approved with the owner on 2026-10-30.

## Goal

On a large TypeScript or JavaScript project, the explorer and planner answer "who calls X", "what breaks if X changes" and "trace this flow" from a code graph instead of sweeping files with grep. The maestro decides when the graph is worth building, builds it once with the owner's yes, and keeps it current after each merge. graphify stays optional: a project without it works exactly as today, and orchestra still needs no database, server or Docker.

## What graphify is (checked on the installed CLI)

[graphify](https://github.com/Graphify-Labs/graphify) is a Python CLI (`pip install graphifyy`, Apache-2.0), not a Claude Code plugin.

- **The code pass is free.** `graphify extract <path> --code-only` parses code locally (AST) with no LLM and no API key, and writes `<path>/graphify-out/graph.json`. Only docs, papers and images go through a paid semantic pass, and naming communities with an LLM is a separate command (`label`).
- **`graphify update <path>`** re-parses changed code files, also with no LLM, and rewrites `graph.json`, `graph.html` and `GRAPH_REPORT.md` in `<path>/graphify-out/`. After a deletion it wrote the smaller graph; its help says `--force` overrides a guard that keeps the old graph when the new one has fewer nodes.
- **Queries are free:** `affected "<node>"` (reverse traversal: who calls or imports a node), `explain "<node>"`, `path "A" "B"` and `query "<text>"` read `graph.json` and call no LLM. Each takes `--graph <path>`, so it works from any folder.
- **What it scans:** it skips `node_modules`, reads `.gitignore` and `.graphifyignore` in every folder, and reads git's `info/exclude`, where nested worktree paths are recorded.
- **Build time and size:** 50 seconds and 9 MB for a 1,263-file Next.js app; 90 seconds for 678 Python files.

## Measurements

Each question was asked twice by a fresh subagent: once with grep only, once told to query the graph first and confirm with grep. "Work" is the agent's tokens minus the 78k a subagent spends before doing anything (measured with an agent that used no tools). Explorer runs on Haiku, planner runs on Opus, one run per cell. Two identical runs of one question differed by 5k, about 25% of its work, so a single cell is noisy and only totals and direction count.

| Codebase | Runs | Grep only: work, tool calls | Graph first: work, tool calls | Gain |
| --- | --- | --- | --- | --- |
| networkx (Python, 580 files, 192k lines) | 3 explorer | 87k, 43 | 68k, 21 | not trusted: the graph found 1 of 9 callers |
| Python standard library (678 files, 308k lines) | 4 explorer, 1 planner | 89k, 28 | 96k, 29 | none |
| Private Next.js app (TypeScript, 1,263 files, 135k lines) | 3 explorer, 1 planner | 129k, 32 | 98k, 22 | about 25% |
| Private Next.js app (TypeScript, 195 files, 23k lines) | 3 explorer | 55k, 16 | 52k, 11 | about 5%, noise |

What the runs showed:
- **Python:** the graph misses calls made through a module attribute (`shutil.copyfileobj(...)`, `nx.shortest_path(...)`), which is how most Python code calls across modules. On "who calls X" it found 1 of 9, 2 of 6, and once the wrong function of the same name. Every graph-first agent had to grep anyway.
- **TypeScript:** named imports resolve, so `affected` returned the full caller list on every "who calls" and "impact" question. The gain grows with how many files an answer spreads over: none at 195 files, about 25% at 1,263. On the planner task the graph-first plan was also better: it found an existing helper the grep-only plan missed.
- **Every language:** free-text `query` returned noise and sometimes printed edges backwards. A name shared by a component and a server function sent one trace to the wrong node. `affected` and `explain` on a precise node, then grep, worked.

## Decisions

1. **Code pass only.** orchestra runs `extract --code-only`, `update`, `affected` and `explain`, never a paid pass, and never installs graphify.
2. **TypeScript and JavaScript only, from 500 files.** Python showed no gain, and other languages are untested. 500 is a guess between the two TypeScript data points (no gain at 195, a clear gain at 1,263), to be calibrated in a real-project trial.
3. **One gate, on the first build.** A new "Owner authorizations" line, `Build the code graph: ask`. The update after each merge is a routine step with no question.
4. **Not committed.** `graphify-out/` is ignored, and one graph lives in the main checkout, on the integration branch. Agents in worktrees query it with `--graph`.

## Parts

### 1. Project settings line

`templates/CLAUDE.md`, "Project settings", gets one line:

- Code graph: `none` | `graphify` | `declined`

`none` is the default. `graphify` means the graph is built and kept current. `declined` means the owner said no, and the maestro never proposes it again. The owner can change it by hand at any time.

### 2. Owner authorizations line

`templates/CLAUDE.md`, "Owner authorizations", gets one line, starting at `ask` like the others:

- Build the code graph (graphify, first build only): `ask`

The maestro skill's list of gated actions names it too.

### 3. Measuring and proposing

At `/orchestra:init` (a new step after the existing ones that look at the project) and at each wave end in the maestro (`/orchestra:close-wave` in the maestro), when "Code graph" is `none`:

1. Count the TS and JS files tracked on the integration branch, from the main checkout:
   `git ls-tree -r --name-only origin/<integration branch> | grep -cE '\.(ts|tsx|js|jsx|mjs|cjs)$'`
   (`origin/` is left out when the project has no remote). Declaration files (`.d.ts`) are counted too; they are a small share in an app.
2. Below 500, do nothing and say nothing.
3. At 500 or more, propose the build at the "Build the code graph" level, with the count and one line on what it costs: about a minute, no tokens, about 10 MB on disk, ignored by git. If `graphify --help` does not run, the proposal also says that `pip install graphifyy` installs it.
4. A no sets "Code graph" to `declined`. "Later" or "not installed yet" leaves it at `none`, so the next wave end proposes it again.

At init, the line is written only after the owner answers; at a wave end, the change goes through the next docs PR like any other `CLAUDE.md` change.

### 4. First build

In the main checkout, on an up-to-date integration branch (`git pull --ff-only`):

1. Check that `.gitignore` lists `graphify-out/`. `/orchestra:init` now adds it next to `.orchestra/` in its `.gitignore` step, for every project; a project set up before this version gets it in the docs PR that records "Code graph".
2. Run `graphify extract . --code-only`.
3. Check its `found N code` line against the number of tracked files (`git ls-files | wc -l`). N can only be larger when the scan swept in copies (a worktree folder graphify did not see as ignored): then delete `graphify-out/`, tell the owner which folders to add to `.graphifyignore`, and stop.
4. Set "Code graph" to `graphify`.

### 5. After each merge

The merge checklist's "After merging" list gets one item, run by the maestro: when "Code graph" is `graphify`, pull the main checkout (`git pull --ff-only` on the integration branch) and run `graphify update .` there. If graphify reports that it kept the old graph because the new one is smaller, run `graphify update . --force`. A failure is reported in the next status round and never blocks the merge.

### 6. Explorer and planner

Both agent files get the same short rule:

- The graph, if any, is `<main checkout>/graphify-out/graph.json`; the main checkout is the first line of `git worktree list`. If the file or the `graphify` command is missing, search with grep as usual and do not mention it.
- For "who calls X", "what breaks if X changes" and "how does A reach B", start with `graphify affected "<name>()" --graph <path>` (and `explain` for one node, `path` between two). Pick the node by its file when a name exists twice. Do not use free-text `graphify query`.
- The graph maps the integration branch, not your branch, and it misses calls through a module attribute or dynamic dispatch. Confirm every line you report with grep or Read, and grep for what the graph might miss.

Implementers, reviewers and the other agents do not change.

### 7. Docs

- `README.md`: graphify in "Requirements" as optional, with one line on when the maestro proposes it.
- `docs/ROADMAP.md`: item 4 says it is built, with a link to this spec, like item 1. The calibration in a real-project trial stays listed.

## Not in scope

- Python and other languages. The upstream fix is in graphify's Python extractor (resolving `module.attr()` through the import table). A language server's "find references" (Pyright, tsserver) is another route, unmeasured. Both are follow-ups.
- The paid semantic pass, community labels, `graph.html`, graphify's own Claude Code integration (`graphify claude install`) and its git hooks.
- Token tracking from the band's session reports. The measurements above replace it for now.

## Testing

Everything this workstream changes is prompt text: templates, a checklist, a command, two agents, a skill and docs. There is no code to unit test.

- `claude plugin validate .` and `claude plugin test .` in `plugins/orchestra` pass.
- The confidentiality scan and the no-em-dash check pass on the diff.
- A dry run of parts 3 to 6 on a scratch copy of a TypeScript app: the count command, the first build and its `found N code` check, an update after deleting a file, and an explorer that follows the new rule and reaches the graph from a worktree.
