# orchestra

This repository is the orchestra plugin for Claude Code (`plugins/orchestra/`), its installer (`install.mjs`, published to npm), the marketplace (`.claude-plugin/marketplace.json`), the docs (`docs/`, `README.md`) and the benchmark scripts (`bench/`). Plugin code is plain Node, no dependencies.

## Changing the plugin

- Work on a branch and open a PR into `main`; never push to `main`. Merge only after both required checks pass: `test (ubuntu-latest)` and `test (windows-latest)`.
- Run the tests before each PR:

  ```bash
  node --test plugins/orchestra/tests/*.test.mjs plugins/orchestra/codemap/tests/*.test.mjs plugins/orchestra/cost/tests/*.test.mjs plugins/orchestra/lsp/tests/*.test.mjs plugins/orchestra/liveview/tests/*.test.mjs
  ```

- A change users get (skills, agents, commands, hooks, templates, liveview, band) bumps `version` in `plugins/orchestra/.claude-plugin/plugin.json` and adds a `## <version>` section at the top of `CHANGELOG.md`, in the same PR. A merge that changes the version publishes the GitHub release with that section as its notes, and fails if the section is missing. A docs-only change needs neither.
- Changelog entries say what changed for the user and why, in plain words. Never claim a result that was not measured.
- When a rule changes in a skill or template, update the docs page that describes it (`docs/stages.md`, `docs/agents.md`, `docs/memory.md`, `docs/commands.md`, `docs/setup.md`) and, if it shows there, the stage cards in `docs/index.html`.
- Stage with `git add <path>` only, never `git add -A`. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
