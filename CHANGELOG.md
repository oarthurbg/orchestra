# Changelog

What changed in each version of the orchestra plugin. The band's Changelog button opens this page. Older versions are in the [commit history](https://github.com/oarthurbg/orchestra/commits/main).

## 1.8.2

- A session that was already open when `/orchestra:init` set up the project now finds it within 5 seconds: the band shows its workstreams and the arrow, and the maestro starts the liveview and shows its button. Before, the band looked for the project only when the session started, so it stayed empty until a restart.

## 1.8.1

- Mockups get one review round, then the owner. In a third blind comparison, a second review and fix cost about 4M tokens and lost a point on the app screen: its fixes undid the first round's choices. What is left after one round are judgement calls only the owner can settle.
- The mockup reviewer checks 768 as its own width. A hero diagram cut off at 768 got past every reviewer in the comparison, and every juror saw it.

## 1.8.0

- Mockups pick their builder by surface, and a different skill reviews each one. A second blind comparison tried taste-skill and impeccable together:
  - App screens: impeccable builds, taste-skill's critique reviews, impeccable fixes. It scored 9.0 out of 10, against 8.0 for impeccable alone.
  - Pages: `frontend-design` builds, the impeccable detector and `design:design-critique` review, then a fix round. It scored 8.5, the best page, for under half the tokens of the next.
- taste-skill moves from direction to review. Every setup where it set the direction placed in the bottom half, even with impeccable building it, while its review found what impeccable's own finish review missed. It still deals directions when the owner asks.

## 1.7.0

- Mockups use one direction skill, not two stacked. In a blind comparison of design-skill setups, `frontend-design` followed by `taste-skill` made the weakest first builds (6.0 out of 10, against 7.5 for `frontend-design` alone and 8.0 for impeccable alone): each plans a direction of its own, and the second threw the first away. `frontend-design` is the default; `taste-skill` fits a page with no brand yet, and impeccable the strongest app screen at about twice the tokens.
- The builder's check keeps only what points at real defects (wrapped headlines, tiny text, overflow, covered text, contrast) and allows taste-skill's house style (hairlines, outlined boxes, monospace, picture and motion counts) when another skill set the direction.
- The approved mockup is written down as impeccable's DESIGN.md before the spec, so the implementer and the finish reviewer check the build against it instead of guessing the direction.

## 1.6.1

- Archiving is left to the desktop app's inactivity archive (1 day): it costs no tokens and skips sessions that are running or have background work. The maestro archives by hand only when the owner asks. In a test, the app's archive-on-PR-close archived a principal minutes after its spec PR merged, so it stays off.
- An archived session refuses messages, so the maestro checks for that and unarchives a session before messaging it.

## 1.6.0

Changes from running orchestra on a real project for a week, where the maestro turned out to be the largest cost.

- The maestro wakes less and clears sooner. Principals message it only at milestones and keep progress in their handoff notes; it answers a progress note in one line, and clears itself at the end of every wave and above 200k tokens.
- The band wakes the maestro once when the 5-hour or weekly limit reaches a set share (`limitAlertAt`, 90% by default), so no cron has to wake it to check. See [Limit alert](docs/band.md#limit-alert).
- `/orchestra:cost` shows where the project's tokens went, per branch and per session.
- Agents don't inherit the session's effort, so principals now set model and effort on every agent orchestra doesn't define, from a map in the stages guide.
- The mockup recipe has a "redesign from scratch" variant that keeps the current app out of the new directions, and a rule for mixing directions. `design:ux-copy` checks the words in the finish review too.
- Small UI changes get lighter reviews, and screenshots cover only what a task changes.
- The verifier runs only in a clean worktree. Releases can rely on the last principal's verification when nothing merged since, and their server steps come from the deploy scripts at the release commit.
- Notes for clearing a session with Remote Control on, raising a new session's effort, and archiving finished sessions together.

## 1.5.2

- Mockups now get their words checked: the builder writes buttons, empty states, errors and confirmations with `design:ux-copy`, and the reviewer checks them. It comes in the `design` plugin orchestra already installs.

## 1.5.1

- `/orchestra:codemap` now maps C# and .NET projects: it follows `using` lines to the folder that declares each namespace, finds `Program.cs` entry points, counts solutions and projects, and pairs a separate tests tree with the code it tests.
- It recognizes fix commits written in Portuguese and Spanish (corrige, correção, conserta, defeito, arregla), and test folders named `testes`.

## 1.5.0

- `/orchestra:codemap` maps a codebase that already exists into `docs/codebase-map.md`: how it is built, its parts, its conventions, where the risk is, and a little history. A script gathers the facts from the code and git history at no token cost, and the explorer writes them up. See [`/orchestra:codemap`](docs/commands.md#orchestracodemap).
- The maestro runs it when it takes stock of an ongoing project. Planners and principals read the map first, and a task that changes one of its risk files is reviewed as sensitive.

## 1.4.0

- orchestra now fits a project already under way. In its first session, the maestro takes stock of open PRs, unmerged branches, worktrees, issues and roadmap files, and suggests for each one: adopt it, let it finish, backlog or close. You decide every row. See [Already have a project?](docs/setup.md#already-have-a-project).
- `/orchestra:start-workstream <name> --adopt <branch> <goal>` turns work already on a branch into a workstream. Its principal starts with a spec of what is built and what is left.
- `/orchestra:init` handles projects with a single branch such as `main`.
- Each new version is now published as a GitHub release, with its changelog section as the notes.

## 1.3.8

- The liveview's key is a table that says what each symbol means, folded under the workstreams until you open it. It remembers whether you left it open.

## 1.3.7

- A guide to every command: [Commands](docs/commands.md). `/orchestra:help <command>` explains one in the chat, for example `/orchestra:help liveview`.

## 1.3.6

- `/orchestra:help` lists orchestra's commands, says which one to run next in this project, and links the docs.

## 1.3.5

- `/orchestra:settings` shows and changes orchestra's settings from any Claude Code window, for example `/orchestra:settings tailscale on`.
- `/orchestra:liveview` follows the Tailscale setting.

## 1.3.4

- The liveview can open to your Tailscale network, so you can see it on your phone: the `liveviewTailnet` setting or `/orchestra:liveview phone`. Off by default.

## 1.3.3

- While the liveview runs, the band's weekly run-out comes from the work still planned instead of the week's average pace.

## 1.3.2

- The band offers an update when a newer orchestra is out, with Changelog, Update and Later buttons, then tells you to run `/reload-plugins`.

## 1.3.1

- A collapsed band's arrow points inward.
- ponytail's level buttons stand without a label.
- The limits show the bare percentage.
- In a narrow pane the status and context columns keep their text, and the header keeps its limits on one line.

## 1.3.0

- The arrow can collapse the band to its header and footer, which names the most urgent workstream.
