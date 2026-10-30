---
description: (Maestro) Open a new workstream: check for overlap, create its worktree, test data and port, and start its session with a briefing
argument-hint: <workstream-name> <one-line goal>
---

You are the maestro (skill `orchestra:maestro`). Open the workstream described in: $ARGUMENTS

1. **Name:** lowercase letters, digits and `_` or `-` for the branch; test data uses the same name with `-` replaced by `_`.
2. **Overlap check:** read `.orchestra/workstreams.md` and list `docs/superpowers/specs/`. If the goal overlaps an open spec or worktree, stop and tell the owner which one.
3. **Schema queue:** if the goal likely changes a data schema and another open workstream already does, tell the owner it has to wait or go after that one.
4. **Capacity:** check that the item is ready and that the machine and the token limits have room, as "Capacity" in the maestro skill says. If not, tell the owner what holds it and when it can start. If so, set this workstream's task limit.
5. **Resources:** using the values in `CLAUDE.md` ("Project settings"):
   - `git fetch origin` and `git worktree add -b <branch> <worktree path> origin/<integration branch>`; with no remote, branch from the local integration branch. Unless the HANDOFF names another place, the worktree path is a sibling of the main checkout, `<main checkout>-<name>` (outside the repository, so test runners and searches never see it);
   - if "Test data" is not `none`, run its Create command with the workstream name and note the "Tests read" value;
   - if "Dev server" is not `none`, pick the next free port.
6. **Register:** add a row to `.orchestra/workstreams.md` (not versioned; create it with this header if missing). Write the worktree path absolute (`<branch>` at `<absolute worktree path>`); the band also resolves a relative one against the main checkout:

   | Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |
   | --- | --- | --- | --- | --- | --- | --- |

7. **Session:** check the level of "Start a new principal session" in "Owner authorizations" (`CLAUDE.md`) and act on it. Then, in the desktop app, start a new session in the worktree folder (`start_session`, Opus at high effort, the README's recommendation) with this briefing, filled in (leave out the test data and port parts when the project has none):

   > You are the principal for `<name>`: <goal>. Load the `orchestra:principal` skill and follow it. Worktree `<path>` on branch `<branch>`. Test data `<ENV_VAR>=<value>`. Dev server port `<port>`. Task limit: `<n>` at once. Start with `superpowers:brainstorming` with the owner, then the spec. Report to the maestro session `<maestro session id>` in one line on cross-workstream decisions, schema changes, wave ends (with your context size) and when the PR is ready.

   Outside the desktop app, print the briefing for the owner to paste into a new session.
8. Report: branch, worktree, test data, port and the session link.
