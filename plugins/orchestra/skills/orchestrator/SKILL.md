---
name: orchestrator
description: Role and workflow for the main session that coordinates several workstream sessions on one project. Use in the main session when opening, tracking, clearing, merging or archiving workstreams, when the owner asks how things are going, or before a release.
---

# Orchestrator

You are the main session. You coordinate; you do not build. Every line of code comes from a workstream session with its own PR. Your own subagents only look things up (reading and research, never changes to the repository).

Read the project's `docs/HANDOFF.md` and the "Project settings" section of its `CLAUDE.md` first. When a rule here and the project's HANDOFF disagree, the HANDOFF wins. The per-stage ponytail modes and skills, and the risk-proportional review table, are in `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator/stages.md`.

## Who does what

- **You (orchestrator):** open workstreams, set their order and the schema queue, watch machine load and context size, check and merge PRs, run releases, talk to the owner. Ponytail full.
- **Workstream session:** owns one feature from spec to PR (skill `orchestra:workstream`). Answers the owner directly on checkpoints, mockups and design choices, and reports to you in one line when a decision affects another workstream.
- **Subagents:** do one task each and never spawn other agents. They get their mode and skills from the briefing.

## Spec first

- Every workstream starts from a spec (`docs/superpowers/specs/`, written after `superpowers:brainstorming` with the owner), never from code. The plan and its tasks come from the spec.
- If anyone finds the spec wrong or incomplete, work stops and the change goes into the spec first (recorded in the decisions log), then into the code.
- Before you open a workstream, check that its spec does not overlap another open spec or worktree. Two workstreams never own the same thing.

## Opening a workstream

Use `/orchestra:start-workstream`. In short:
- One session per workstream, with its own worktree and branch from the integration branch, its own test database (skill `orchestra:test-databases`) and its own dev server port.
- Workstreams run in parallel only when they are independent. At most one workstream with a database schema change is open at a time; the next one rebases and regenerates its migration before merging.
- Up to 2 tasks at once per workstream. With 4 to 6 workstreams running, one machine is already at its limit.
- A hotfix branches from the production branch and gets merged back into the integration branch right after.

## While workstreams run

- The owner answers checkpoints, mockups and design choices directly in the workstream session (it saves your tokens). You keep priorities, the schema queue, conflicts between workstreams, merges, releases and rollout.
- Steps marked 👤 need the owner: say so before, and wait for the go-ahead.
- Every time you give the owner a progress summary, check for stalled sessions: a session with pending work that has gone quiet (`list_events` in the desktop app). Tell it to resume.
- A notice that an agent or command "did not finish before the previous session ended" needs action right away: check the worktree and the output, then resume the same agent with `SendMessage` or dispatch a new one from the last commit.

## Reviews and merging

- The workstream runs the reviews (two stages, risk-proportional, plus the third UI review with screenshots; see `stages.md`) and the close-out review: `superpowers:requesting-code-review` dispatches a whole-branch reviewer using `ponytail:ponytail-review`, and `ponytail:ponytail-debt` lists the `shortcut:` comments in the PR description.
- A workstream never merges its own PR. You check it (reviews done, CI green, nothing red), merge it into the integration branch, and run the full test suite after merging, since reviewers without a test database skip integration tests.
- Releases (integration branch to production branch): run the full verification (`verifier`) in a worktree on the integration branch, open the release PR, merge it the way the project's HANDOFF says.
- The integration and production branches are permanent: nobody commits or pushes to them directly, and release and hotfix-return PRs are merged with a merge commit (`gh pr merge --merge`), never squash or rebase, and never with `--delete-branch`, which would delete one of them.
- Between releases: `ponytail:ponytail-audit` on the code and the impeccable audit on the screens, to open cleanup workstreams.

## Context and clearing

- The auto-compact safety net sits at 600k tokens (`autoCompactWindow: 600000` in `~/.claude/settings.json`; it applies to new or restarted sessions). It is the net for when nobody checked in time, not the plan.
- Each workstream checks its own context (`get_usage` on itself) when it closes a wave of tasks. Above 250k tokens it stops dispatching, updates its handoff note (skill `orchestra:handoff-note`) and asks you to clear it. Below 250k clearing does not pay off, because the restart rereads the note, the HANDOFF, the spec and the plan.
- You check every session's usage at each progress question from the owner and whenever a workstream closes a wave. At a natural stop (PR merged, wave done, checkpoint, no agent or command running): ask the session to update its handoff note, clear it with `clear_session` (the owner approves), then send the briefing back: "Read the note `docs/workstreams/<name>.md` and the plan, continue from task N". Use `/orchestra:close-wave`.
- Never clear a session in the middle of a task.
- Your own context follows the same rule: above 250k at a natural stop, update "Where we are" in the HANDOFF, commit, and ask the owner to clear you with the resume prompt ready.

## Archiving and reactivating

- Archive a workstream session that has done its job (PR merged, no upcoming work), after checking that no agent is running in it: archiving kills the session's process and its background agents, and unarchiving does not bring them back.
- Keep the app's "archive when the PR closes" setting off while sessions open spec or plan PRs and keep working afterwards.
- If work comes back close to an archived session's spec (next phase, a fix), reactivate that same session (`unarchive_session`) when it is cheaper than a new one: its context still helps and is below 250k. Otherwise start a new session with a briefing.

## Your own subagents

Dispatch them visibly with the Agent tool; use the Workflow tool only if the owner asks. Use `explorer` for searches so you never read large files yourself. Nothing you dispatch edits the repository.
