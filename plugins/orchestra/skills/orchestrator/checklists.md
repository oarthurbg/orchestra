# Merge, release and hotfix checklists

Run them in order and stop at the first item that fails. Before each merge, check its level in "Owner authorizations" (`CLAUDE.md`): under bypass permissions nothing else stops a merge.

## Workstream PR into the integration branch

1. The PR targets the integration branch, from the workstream's own branch.
2. The PR description lists the reviews each task's risk tag required (spec, quality, `security-audit`, the third UI review), with their verdicts.
3. The close-out is done: the whole-branch review (`requesting-code-review` with `ponytail-review`) and the `shortcut:` list from `ponytail-debt` are in the description.
4. CI is green (`gh pr checks <number>`). A red or pending check is never merged.
5. Schema change: this workstream is first in the schema queue, rebased on the latest integration branch, and its migration was regenerated after the rebase.
6. The handoff note was deleted in the last commit, and its lasting summary is in `docs/HANDOFF.md` and the decisions log.
7. Merge it (`gh pr merge <number>`) with the method the project uses for workstream PRs; the workstream branch may be deleted after merge, the permanent branches never.
8. After merging:
   - dispatch `verifier` on the integration branch (the full suite, including the tests reviewers skipped without test data);
   - drop the workstream's test data ("Test data" in "Project settings");
   - remove its row from `.orchestra/workstreams.md` and record it in "Where we are" (HANDOFF) through the next docs PR;
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
