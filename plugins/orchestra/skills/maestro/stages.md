# Stages, modes and skills

Every session starts in ponytail full. The principal switches its own mode as it moves through the stages (`ponytail:ponytail` with `lite` or `ultra`, or "stop ponytail" to turn it off) and states the mode in every subagent briefing. The maestro stays at full.

| Stage | Who | Ponytail | Skills |
| --- | --- | --- | --- |
| Brainstorm and mockups | Principal, with the owner; mockups by a builder and a reviewer subagent (see Mockup recipe) | off; the fix round lite | `superpowers:brainstorming`, `frontend-design`, `taste-skill`, the impeccable detector before showing a mockup, `design:design-critique` before showing a mockup, `dataviz` for charts |
| Spec | Principal | lite | `security-audit` early on sensitive specs (access, credentials, public pages, email) |
| Plan | `planner` (Opus, high) | ultra: cuts what the spec does not ask for, never what it does | `superpowers:writing-plans` |
| Backend, database and integration work | `implementer` (Sonnet, medium) or `implementer-advanced` (Opus, high) | full | Principal: `superpowers:subagent-driven-development`, `superpowers:dispatching-parallel-agents`. Subagent: `test-driven-development`, `verification-before-completion`, `systematic-debugging` |
| UI implementation and polish | `implementer` | lite | `impeccable:impeccable` (Operate mode, craft floor before any UI edit), `test-driven-development`, `verification-before-completion`, `dataviz`. `frontend-design` and `taste-skill` stay in the mockups |
| Infrastructure (servers, CI, scripts, dependencies) | `implementer-advanced` | ultra | as for backend |
| Mechanical work (docs, renames, formatting) | `mechanic` (Haiku, low) | full | none |
| Searches and summaries | `explorer` (Haiku, low) | full | none |
| Reviews | `spec-reviewer` (Sonnet), `quality-reviewer` (Opus), `impeccable:impeccable-finish-reviewer` | off | `verification-before-completion`; `quality-reviewer` uses the `ponytail:ponytail-review` method; `design:accessibility-review` with the third UI review; the principal uses `superpowers:receiving-code-review` on the findings |
| Close-out and PR | Principal; `verifier` (Sonnet, low) | full | `superpowers:requesting-code-review` (dispatches a whole-branch reviewer using `ponytail:ponytail-review`), `ponytail:ponytail-debt` (lists the `shortcut:` comments in the PR description), `security-audit` before a PR that touches access, credentials, public pages or email, `superpowers:finishing-a-development-branch` |
| Between releases | Maestro | full | `ponytail:ponytail-audit` on the code and the impeccable audit on the screens, to open cleanup workstreams |

`dataviz` ships with recent Claude Code versions; `security-audit` is Cloudflare's skill, listed in the orchestra marketplace. Skip either one if it is missing. When a skill says something different from the project's HANDOFF (worktrees, merge, PR target), the HANDOFF wins.

## Mockup recipe

After the brainstorm, the principal runs each UI mockup through four steps instead of drawing it itself. In a blind test this scored within 0.4 of a max-effort build (7.3 and 7.4 against 7.7 out of 10), with better accuracy, for about a third of the tokens.

1. **Brief.** One file: the goal, the facts the page may state (from the README and the spec, never invented), the brand traps (ground colour, fonts that must load, what each shape means, no overflow at 1440, 768 and 390) and the budget below. Keep the creative direction open: a brief that names the idea makes every build look alike.
2. **Builder** (`general-purpose`, Opus, effort high or medium, ponytail off): `frontend-design`, then `taste-skill` with three directions dealt. It fixes from the `inspect.mjs` text output first and opens screenshots only at the end of a round, one per width. It stops at the first build with 0 FAIL.
3. **Reviewer** (a separate subagent, Opus, effort high): looks at the screenshots, runs the impeccable detector and `design:design-critique`, checks every claim against the facts, and returns at most 8 one-line findings and a score. The builder never holds the reviewer's screenshots.
4. **Fix round** (the same builder, resumed, ponytail lite): fixes only those findings. At most 3 look rounds in all; then the owner sees it.

Use effort max, if at all, for one capped polish pass on the mockup the owner approved. Run without a cap, max cost 8.5 times a medium build, mostly from screenshots re-read on every request.

## Risk-proportional review

The planner tags every task with a risk. The principal picks the reviews from the tag:

| Risk | Reviews |
| --- | --- |
| `mechanical` (docs, renames, text) | `spec-reviewer` only |
| `normal` | `spec-reviewer`, then `quality-reviewer` |
| `sensitive` (money, access, credentials, database) | `spec-reviewer`, `quality-reviewer`, then `security-audit`, in sequence |
| `ui` | as for its other risk, plus a third review (web UI with a dev server and browser checks; otherwise `ui` tasks get only the reviews of their other risk): `screenshotter` captures, then `impeccable:impeccable-finish-reviewer` against the approved mockup, with `design:accessibility-review` |

Spec and quality reviews run in parallel only on low-risk tasks. On risky tasks they run in sequence, so the quality reviewer sees code that already matches the spec.
