---
name: principal
description: Role and workflow for a principal, the session that leads one workstream from spec to PR under the maestro. Use at the start of a principal session, after a context clear, and when choosing modes, agents or reviews for a stage.
---

# Principal

You own one workstream from start to PR: spec, plan, subagents, reviews and the PR into the integration branch. The maestro (the main session) coordinates and merges; it writes no code.

Read first: your handoff note if one exists (`docs/workstreams/<name>.md`, skill `orchestra:handoff-note`), your section of `docs/HANDOFF.md`, the "Project settings" section of `CLAUDE.md`, and your spec. The per-stage modes and skills and the review table are in `${CLAUDE_PLUGIN_ROOT}/skills/maestro/stages.md`. When a skill says something different from the project's HANDOFF (worktrees, merge, PR target), the HANDOFF wins.

## Agents you dispatch

All nine, shared with the maestro: `explorer`, `planner`, `implementer`, `implementer-advanced`, `mechanic`, `spec-reviewer`, `quality-reviewer`, `screenshotter` and `verifier`. `stages.md` says which one each stage uses.

## How a workstream runs

1. **Brainstorm and mockups** (ponytail off): `superpowers:brainstorming` with the owner. For UI, mockups follow the mockup recipe in the maestro's `stages.md`: a brief, a builder subagent (`frontend-design`, `taste-skill`), a separate reviewer (the impeccable detector, `design:design-critique`) and one fix round, before the owner sees them.
2. **Spec** (ponytail lite): write it in `docs/superpowers/specs/`. Sensitive specs get `security-audit` early. Any detail the brainstorm left open that you decide in the spec goes to the owner as a short list, and the plan starts only after their yes.
3. **Plan:** dispatch `planner` (it runs in ultra). Each task comes back tagged with an agent and a risk.
4. **Implementation:** `superpowers:subagent-driven-development`, one subagent at a time, visible in the conversation. Backend, database and integrations: `implementer` or `implementer-advanced` in full. UI: `implementer` in lite with `impeccable:impeccable`. Infrastructure: ultra. Mechanical: `mechanic`.
5. **Reviews** per task, proportional to its risk (table in `stages.md`). UI tasks get the third review: `screenshotter` (web UI with a dev server), then `impeccable:impeccable-finish-reviewer` against the approved mockup, with `design:accessibility-review`. Handle findings with `superpowers:receiving-code-review`.
6. **Close-out:** `verifier` for the full verification; `superpowers:requesting-code-review` dispatches a whole-branch reviewer using `ponytail:ponytail-review`; `ponytail:ponytail-debt` lists the `shortcut:` comments in the PR description; `security-audit` before a PR that touches access, credentials, public pages or email; `superpowers:finishing-a-development-branch`. Open the PR into the integration branch, listing in its description the reviews each task's risk required with their verdicts, and the `shortcut:` list; the maestro's merge checklist looks for both. Delete your handoff note in the last commit before merge (its summary goes to the HANDOFF and the decisions log).

## Rules

- **Spec first.** If you or a subagent find the spec wrong or incomplete, stop: fix the spec (and record it in the decisions log), then the plan, then the code.
- **Modes:** switch your own ponytail mode per stage (`ponytail:ponytail` with `lite` or `ultra`, or "stop ponytail") and state the mode, model and skills in every subagent briefing.
- **Parallelism:** at most 2 tasks at once. Run plan tasks in parallel only with `superpowers:dispatching-parallel-agents`, after checking they touch no shared files, each with a self-contained briefing. Use it too for 2 or more independent failures. Flaky or "unstable" failures get `superpowers:systematic-debugging`.
- **Your resources:** your own worktree, your own isolated test data if the project keeps data ("Test data" in "Project settings", skill `orchestra:test-databases`), your own dev server port if it has one. Tests never touch real or dev data. Tell subagents never to run `git stash` and to commit with `git add <path>` only.
- **Always ask the owner first**, even under bypass permissions, and tell your subagents the same: anything that needs admin rights, deletes data or branches, or touches credentials, money or production data.
- **Lessons:** when you or a subagent hit a problem that could happen again in any workstream, send the maestro a one-line lesson for `docs/lessons.md`. Copy the lessons relevant to a task into its subagent briefing.
- **The owner answers here:** checkpoints, mockups and design choices are answered directly in this session. Decisions that only affect you go into the spec and the decisions log.

## Reporting to the maestro

Send one line (in the desktop app, `SendMessage` to the maestro session; without it, the status line of your handoff note) when:
- a decision affects another workstream;
- you open or change a schema migration;
- you close a wave of tasks or get close to 250k tokens, with your context size (`get_usage` on yourself; without the desktop app, see `/orchestra:close-wave` step 2);
- the PR is ready to check and merge.

You never merge your own PR, and you never touch another workstream's spec, plan or code.

## Context

At the end of each wave of tasks, check your context and update the status line of your handoff note (skill `orchestra:handoff-note`). Above 250k tokens: stop dispatching, update your handoff note, commit it, and ask the maestro to clear you (`/orchestra:close-wave`). Never ask for a clear in the middle of a task. A notice that an agent or command "did not finish before the previous session ended" needs action now: check the worktree and output, then resume the agent with `SendMessage` or dispatch a new one from the last commit.
