---
description: (Maestro) Open a new workstream, or adopt work already on a branch: check for overlap, create its worktree, test data and port, and start its session with a briefing
argument-hint: <workstream-name> [--adopt <branch>] <one-line goal>
---

You are the maestro (skill `orchestra:maestro`). Open the workstream described in: $ARGUMENTS

1. **Name:** lowercase letters, digits and `_` or `-` for the branch; test data uses the same name with `-` replaced by `_`. With `--adopt <branch>`, the workstream takes over work already on that branch: the branch keeps its own name, and the workstream name is only for the registry, the test data and the handoff note.
2. **Overlap check:** read `.orchestra/workstreams.md` and list `docs/superpowers/specs/`. If the goal overlaps an open spec or worktree, stop and tell the owner which one. When adopting, the branch's own worktree and open PR are not an overlap; another workstream on the same branch is.
3. **Schema queue:** if the goal likely changes a data schema and another open workstream already does, tell the owner it has to wait or go after that one.
4. **Capacity:** check that the item is ready and that the machine and the token limits have room, as "Capacity" in the maestro skill says. If not, tell the owner what holds it and when it can start. If so, set this workstream's task limit.
5. **Resources:** using the values in `CLAUDE.md` ("Project settings"):
   - `git fetch origin` and `git worktree add -b <branch> <worktree path> origin/<integration branch>`; with no remote, branch from the local integration branch. Unless the HANDOFF names another place, the worktree path is a sibling of the main checkout, `<main checkout>-<name>` (outside the repository, so test runners and searches never see it);
   - when adopting, create no branch. If `git worktree list` shows the branch already checked out, use that worktree as it is. Otherwise `git worktree add <worktree path> <branch>` for a local branch, or `git worktree add -b <branch> <worktree path> origin/<branch>` for one that exists only on the remote. Never reset, rebase or discard the work on it. Note how far it is behind the integration branch (`git rev-list --count <branch>..origin/<integration branch>`) and its open PR, if any (`gh pr list --head <branch>`);
   - if "Test data" is not `none`, run its Create command with the workstream name and note the "Tests read" value;
   - if "Dev server" is not `none`, pick the next free port.
6. **Register:** add a row to `.orchestra/workstreams.md` (not versioned; create it with this header if missing). Write the worktree path absolute (`<branch>` at `<absolute worktree path>`); the band also resolves a relative one against the main checkout:

   | Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |
   | --- | --- | --- | --- | --- | --- | --- |

7. **Session:** check the level of "Start a new principal session" in "Owner authorizations" (`CLAUDE.md`) and act on it. Then, in the desktop app, start a new session in the worktree folder (`start_session`, Opus at high effort, as orchestra's `docs/setup.md` recommends; a session comes up at your own effort at most, so when you run lower, raise it after the start with `set_session_effort`, which applies from its next turn) with this briefing, filled in (leave out the test data and port parts when the project has none):

   > You are the principal for `<name>`: <goal>. Load the `orchestra:principal` skill and follow it. Worktree `<path>` on branch `<branch>`. Test data `<ENV_VAR>=<value>`. Dev server port `<port>`. Task limit: `<n>` at once. Start with `superpowers:brainstorming` with the owner, then the spec. Report to the maestro session `<maestro session id>` in one line on cross-workstream decisions, schema changes, wave ends (with your context size) and when the PR is ready. Nothing else: progress goes in your handoff note, since every message wakes the maestro.

   When adopting, replace "Start with `superpowers:brainstorming` with the owner, then the spec." with: "This workstream adopts work already on `<branch>` (<n> commits behind `<integration branch>`; open PR <number or none>). Start by writing the spec from what exists: read the branch's diff against the integration branch and the PR's description and comments, then write what is built, what is left and what is unclear. Confirm that spec with the owner before any new code, then plan only the remaining work."

   Outside the desktop app, print the briefing for the owner to paste into a new session.
8. Report: branch, worktree, test data, port and the session link; when adopting, also how far behind the branch is and its PR.
