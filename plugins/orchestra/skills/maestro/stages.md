# Stages, modes and skills

Every session starts in ponytail full. The principal switches its own mode as it moves through the stages (`ponytail:ponytail` with `lite` or `ultra`, or "stop ponytail" to turn it off) and states the mode in every subagent briefing. The maestro stays at full.

| Stage | Who | Ponytail | Skills |
| --- | --- | --- | --- |
| Brainstorm and mockups | Principal, with the owner; mockups by a builder and a reviewer subagent (see Mockup recipe) | off; the fix round lite | `superpowers:brainstorming`, one direction skill by surface (`impeccable:impeccable` for app screens, `frontend-design` for pages, never two), `taste-skill` reviewing impeccable's app screens, the impeccable detector before showing a mockup, `design:design-critique` before showing a mockup, `design:ux-copy` for the mockup's words, `dataviz` for charts |
| Spec | Principal | lite | `security-audit` early on sensitive specs (access, credentials, public pages, email) |
| Plan | `planner` (Opus, high) | ultra: cuts what the spec does not ask for, never what it does | `superpowers:writing-plans` |
| Backend, database and integration work | `implementer` (Sonnet, medium) or `implementer-advanced` (Opus, high) | full | Principal: `superpowers:subagent-driven-development`, `superpowers:dispatching-parallel-agents`. Subagent: `test-driven-development`, `verification-before-completion`, `systematic-debugging` |
| UI implementation and polish | `implementer` | lite | `impeccable:impeccable` (Operate mode, craft floor before any UI edit, the approved mockup's DESIGN.md as its contract), `test-driven-development`, `verification-before-completion`, `dataviz`. `frontend-design` and `taste-skill` stay in the mockups |
| Infrastructure (servers, CI, scripts, dependencies) | `implementer-advanced` | ultra | as for backend |
| Mechanical work (docs, renames, formatting) | `mechanic` (Haiku, low) | full | none |
| Searches and summaries | `explorer` (Haiku, low) | full | none |
| Reviews | `spec-reviewer` (Sonnet), `quality-reviewer` (Opus), `impeccable:impeccable-finish-reviewer` | off | `verification-before-completion`; `quality-reviewer` uses the `ponytail:ponytail-review` method; `design:accessibility-review` and `design:ux-copy` with the third UI review; the principal uses `superpowers:receiving-code-review` on the findings |
| Close-out and PR | Principal; `verifier` (Sonnet, low) | full | `superpowers:requesting-code-review` (dispatches a whole-branch reviewer using `ponytail:ponytail-review`), `ponytail:ponytail-debt` (lists the `shortcut:` comments in the PR description), `security-audit` before a PR that touches access, credentials, public pages or email, `superpowers:finishing-a-development-branch` |
| Between releases | Maestro | full | `ponytail:ponytail-audit` on the code and the impeccable audit on the screens, to open cleanup workstreams |

`dataviz` ships with recent Claude Code versions; `security-audit` is Cloudflare's skill, listed in the orchestra marketplace. Skip either one if it is missing. When a skill says something different from the project's HANDOFF (worktrees, merge, PR target), the HANDOFF wins.

## Model and effort

orchestra's nine agents set their own model and effort. Every other agent (the mockup builder, reviewer and fixer, any `general-purpose` agent) gets both on the Agent call, from this map:

- setting a direction, reviews and UX fixes: Opus, max;
- building out an approved direction, screen by screen: Opus, high;
- searches, copies, screenshots and mechanical edits: Sonnet or Haiku, low.

Max everywhere costs much more for little gain in the bulk stages. Agents never inherit the session's effort: a principal raised to max still dispatches each agent at the level its call or definition sets. A resumed agent keeps the effort it started with; to change it, dispatch a new one. Say each agent's model and effort in your wave-end and PR-ready reports to the maestro.

## Mockup recipe

After the brainstorm, the principal runs each UI mockup through five steps instead of drawing it itself.

One skill owns the direction, picked by the surface, and a different skill reviews it. `frontend-design`, `taste-skill` and `impeccable:impeccable` each plan a direction of their own, so stacking two makes the second throw the first away (6.0 out of 10 in a blind comparison, the weakest first builds). Two rounds of blind comparison on an app screen and a landing page found:

- App screens: impeccable building, a taste-skill review and an impeccable fix scored 9.0, ahead of impeccable alone (8.0) and `frontend-design` with a review (7.5).
- Pages: `frontend-design` with the review below and a fix scored 8.5, ahead of impeccable reviewed by taste-skill (8.0), for under half the tokens.
- Every setup where taste-skill set the direction placed in the bottom half (6.25 to 7.5), even with impeccable building it. Its review, on the other hand, found what impeccable's own finish review missed.

1. **Brief.** One file: the goal, the facts the page may state (from the README and the spec, never invented), the brand traps (ground colour, fonts that must load, what each shape means, no overflow at 1440, 768 and 390) and the budget below. Keep the creative direction open: a brief that names the idea makes every build look alike.
2. **Builder** (`general-purpose`, Opus, effort max, since it sets the direction; ponytail off) with the skill for its surface, named in its prompt:
   - An app screen (a view of an app, a dashboard, settings, an inbox): `impeccable:impeccable` in Operate mode, as new work, with its own direction step and finish review.
   - A page (a landing, marketing or docs page): `frontend-design`.
   - `taste-skill` deals directions only when the owner asks for them; the builder then builds the one the owner picks, with its surface's skill.

   Plus `design:ux-copy` for buttons, empty states, errors and confirmations (the interface speaks, never apologizes). It checks each round with taste-skill's `inspect.mjs` (`--app` for an app screen) as a neutral gate: unless taste-skill dealt the direction, pass `--allow hairline,outlined-box,mono,few-pictures,still-page`, since those are taste-skill's house style, not defects. What counts is wrapped headlines, tiny text, overflow, covered text and contrast. It fixes from the text output first, opens screenshots only at the end of a round, one per width, and stops at the first build with 0 FAIL.
3. **Reviewer** (a separate subagent, Opus, effort max), looking at the screenshots with a different skill's eyes than the builder's:
   - An app screen built with impeccable: `taste-skill`'s critique rubric (`references/critique.md` and `references/app-screens.md`) and its inspector's findings, without the five house-style rules above.
   - A page built with `frontend-design`: the impeccable detector and `design:design-critique`.

   Either way it checks the words with `design:ux-copy` (each copy finding gives the current and the proposed text), checks every claim against the facts, and returns at most 8 one-line findings (what, where and at which width, the fix, high, medium or low) and a score. The builder never holds the reviewer's screenshots. Each review cost about 1M tokens; the page review found 11 of the jurors' 13 defects.
4. **Fix round** (the same builder, resumed, so still at max; ponytail lite): fixes only those findings, with its own skill. It may decline one that contradicts the brief or its DESIGN.md, saying why. At most 3 look rounds in all; then the owner sees it. The review and fix round added 0.5 to 1.5 points.
5. **Hand-off** (after the owner approves a mockup; a subagent, Opus, high): `impeccable:impeccable` with its `document` command writes DESIGN.md at the repository root from the approved mockup: its colours, type, spacing, components and do's and don'ts. When the project has one, it adds what the mockup brings; a redesign from scratch replaces it. If PRODUCT.md is missing, it writes one with `init`, answering from the spec and the brief, not the owner. A build made with impeccable wrote them already: check they match the approved mockup. Commit both with the spec. The implementer's impeccable and the finish reviewer read them, so they check the build against the approved direction instead of guessing it.

Max runs inside the recipe's caps: one build until 0 FAIL, at most 3 look rounds. Run without a cap, max cost 8.5 times a medium build, mostly from screenshots re-read on every request.

**Mixing directions.** When the owner picks parts of several directions ("the home of B, the plan of C"), take one visual base, carry the named parts over into it, and write why in the handoff note. Mixing two visual systems screen by screen gives an app with two faces.

### Redesign from scratch

When the owner asks for screens "as if built from scratch", the current UI must not reach the builders by any route. Banning its code, kit and screenshots is not enough: specs that describe layouts ("a top bar in 3 zones", "4 KPI cards") bring it back, and every direction comes out as the current app in a new skin. Add three rules to the recipe:

1. **A jobs-and-data inventory** in place of the specs: per role, the question they bring, the decision they make, the data that exists, the actions and the rules. Strip every layout, section name, block order and component. Which screens exist stays open too.
2. **Banned patterns:** the brief lists the current app's recognisable compositions, and the reviewer fails any direction that resembles them.
3. **One structural premise per direction**, set by the principal ("the plan as a live spreadsheet", "as a month timeline", "as a decision queue"), with the visual left to the builder. Without premises, the directions drift together.

## Risk-proportional review

The planner tags every task with a risk. The principal picks the reviews from the tag:

| Risk | Reviews |
| --- | --- |
| `mechanical` (docs, renames, text) | `spec-reviewer` only |
| `normal` | `spec-reviewer`, then `quality-reviewer` |
| `sensitive` (money, access, credentials, database) | `spec-reviewer`, `quality-reviewer`, then `security-audit`, in sequence |
| `ui` | as for its other risk, plus a third review (web UI with a dev server and browser checks; otherwise `ui` tasks get only the reviews of their other risk): `screenshotter` captures, then `impeccable:impeccable-finish-reviewer` against the approved mockup, with `design:accessibility-review` and `design:ux-copy` |

Spec and quality reviews run in parallel only on low-risk tasks. On risky tasks they run in sequence, so the quality reviewer sees code that already matches the spec.

Keep small changes light. A `ui` task that only adjusts an existing screen (spacing, colour, copy; no new screen, state or data) is `ui, mechanical`: `spec-reviewer` alone, then the finish review. The screenshotter captures only the widths and states the task changes; a new screen gets all of them.
