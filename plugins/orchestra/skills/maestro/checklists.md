# Merge, release, hotfix and code graph checklists

Run them in order and stop at the first item that fails. Before each merge, check its level in "Owner authorizations" (`CLAUDE.md`): under bypass permissions nothing else stops a merge.

## Workstream PR into the integration branch

1. The PR targets the integration branch, from the workstream's own branch.
2. The PR description lists the reviews each task's risk tag required (spec, quality, `security-audit`, the third UI review), with their verdicts.
3. The close-out is done: the whole-branch review (`requesting-code-review` with `ponytail-review`) and the `shortcut:` list from `ponytail-debt` are in the description.
4. CI is green (`gh pr checks <number>`). A red or pending check is never merged.
5. Schema change: this workstream is first in the schema queue, rebased on the latest integration branch, and its migration was regenerated after the rebase.
6. The handoff note was deleted in the last commit, and its lasting summary is in `docs/HANDOFF.md` and the decisions log.
7. Any lesson the workstream sent is in `docs/lessons.md` or queued for the next docs PR, so it is not lost when the workstream closes.
8. Merge it (`gh pr merge <number>`) with the method the project uses for workstream PRs; the workstream branch may be deleted after merge, the permanent branches never.
9. After merging:
   - dispatch `verifier` on the integration branch (the full suite, including the tests reviewers skipped without test data);
   - when the code graph is on ("Code graph" below), pull the main checkout (`git pull --ff-only` on the integration branch; skip it with no remote) and run `graphify update .` there. If graphify says it kept the old graph because the new one has fewer nodes, run `graphify update . --force`. A failure never blocks the merge: report it in the next status round and carry on with the next item;
   - drop the workstream's test data ("Test data" in "Project settings");
   - remove its row from `.orchestra/workstreams.md` and record it in "Where we are" (HANDOFF) through the next docs PR;
   - delete its report in `.orchestra/sessions/` (the file whose `workstream` is this one), so the band stops showing it;
   - tell the next workstream in the schema queue it can rebase;
   - mark the session as an archive candidate.

## Release (integration branch into production branch)

1. Everything meant for this release is merged, and no workstream PR is half-merged.
2. `verifier` passes in a fresh worktree on the latest integration branch, and the release PR's CI is green.
3. The release PR description says: what goes in, migrations, 👤 steps, and how to roll back.
4. Merge with a merge commit (`gh pr merge <number> --merge`): never squash or rebase, never `--delete-branch`.
5. The deploy that follows is covered by the "Release" level in "Owner authorizations". Run the project's own read-only health check after it, and report it in the next status round.

## Hotfix

1. Branch from the production branch, PR into the production branch, same reviews as its risk requires, and CI green.
2. Merge with a merge commit, never `--delete-branch`.
3. Right after: a PR from the production branch back into the integration branch, merged with a merge commit, so the fix is not lost at the next release.

## Code graph

One graph of the integration branch, built with graphify in the main checkout and never committed. The graph is on when `graphify-out/graph.json` exists in the main checkout. Only TypeScript and JavaScript projects. Run only `graphify extract . --code-only` and `graphify update .`: they call no LLM. Never install graphify, never run its paid passes, and never switch the main checkout's branch: when it is not on the integration branch, stop at "First build" and tell the owner, and skip the update after a merge and report it in the next status round.

### Measure and propose

Run this at `/orchestra:init` and at each wave end (`/orchestra:close-wave` in the maestro) while the graph is off and "Code graph" in "Project settings" is `none`.

1. In the main checkout, `git fetch origin`, then count the TS and JS files tracked on the integration branch: `git ls-tree -r --name-only origin/<integration branch> | grep -cE '\.(ts|tsx|js|jsx|mjs|cjs)$'`. With no remote, use the local branch; at init, before the integration branch exists, use `HEAD`. Declaration files (`.d.ts`) count too.
2. Below 500, do nothing and say nothing.
3. At 500 or more, propose the first build at its "Build the code graph" level in "Owner authorizations", with the count and its cost: about a minute, no tokens, about 10 MB on disk, ignored by git. If `graphify --help` does not run, add that `pip install graphifyy` installs it.
4. A no sets "Code graph" to `declined`: never propose it again. At init, write it in `CLAUDE.md` right away; at a wave end, it goes through the next docs PR, and while that PR is open it counts as `declined`. "Later" or "not installed yet" leaves it at `none`, so the next wave end proposes it again.

### First build

After the owner's yes, in the main checkout, on the integration branch, up to date (`git pull --ff-only`; skip it with no remote):

1. Check that `.gitignore` lists `graphify-out/`. If it does not (a project set up before this version), add `graphify-out/` to `.git/info/exclude` now, and to `.gitignore` in the next docs PR.
2. Check that every worktree inside the main checkout is ignored: for each path from `git worktree list` that sits under the main checkout, `git check-ignore -q <path>` must succeed. graphify reads the same `.gitignore` and `info/exclude` files, so a path git ignores is a path graphify skips. If one is not ignored, the scan would sweep in a whole copy of the code: tell the owner to add it to `.gitignore` or `.graphifyignore`, and stop.
3. Run `graphify extract . --code-only`. The graph is now on; "Code graph" stays `none`.
