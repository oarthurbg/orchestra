# Changelog

What changed in each version of the orchestra plugin. The band's Changelog button opens this page. Older versions are in the [commit history](https://github.com/oarthurbg/orchestra/commits/main).

## 1.11.1

- The mockup builder, its fix round and UX fixes run at high, not max. The blind test behind the mockup recipe found the capped recipe with the builder at high or medium scored 7.3 and 7.4 out of 10 against 7.7 for an uncapped max build, with better accuracy, for about a third of the tokens. Max came back later without a new test. High also gives the owner a faster loop between rounds.

## 1.11.0

Four ideas from Akita's [ai-memory](https://github.com/akitaonrails/ai-memory) (MIT), as rules rather than a service:

- A session resuming a workstream checks the handoff note against `git log` and `git status` first: newer commits or uncommitted changes mean the session before stopped without updating it, often on a usage limit, and git wins. A new session takes over only once the old one has stopped. The merge checklist also catches notes left behind in `docs/workstreams/`.
- Writing rules for handoff notes, the HANDOFF and the maestro's resume block: the latest state wins, running work is pending, exact text for errors, paths, commands and numbers, conditions kept word for word, nothing made up. In ai-memory's test, a model's summary dropped 8 of 15 planted facts.
- Lessons: what goes in (a checkable do or never-do that can happen again) and what stays out, one line per lesson with its dates and source, and promotion to a new "Rules from lessons" section in `CLAUDE.md`, at most 15 rules, each approved by the owner. Rule files past about 200 lines are followed less.
- Between releases, a read-only reviewer checks lessons, decisions, the HANDOFF and the promoted rules for contradictions, stale entries and duplicates.

## 1.10.1

- The band's buttons no longer run past the 10-second limit Claude Code gives a button press, which showed as "ui.press hook skipped: ran past its 10s budget". Update now shows "Updating orchestra..." at once and runs the two `claude plugin` commands in the background, then shows the result or the failure toast. A ponytail level button switches at once, even mid-turn, while its command waits for the session to go idle.

## 1.10.0

- Docs can be in any language. The `CLAUDE.md` template lists the names that stay in English because orchestra's tools read them: the file and folder paths, the branch lines, the note's `Status:`, `waiting on:` and `Plan:`, plan tasks as `### Task N:`, the HANDOFF's `## Where we are` and `## Next workstreams`. Init lists docs that break it, and agents rename them as they go. A plan split in parts is named `<plan>-part-2.md`. See [Docs in another language](docs/setup.md#docs-in-another-language).
- The liveview finds the plan in more projects:
  - the integration branch comes from the branch guard's config, so a `CLAUDE.md` in another language no longer hides it;
  - a note's plan line counts in any language (`Plano:`), or its first plan path;
  - a plan split in parts reads as one plan;
  - a row without a plan says why, such as `2 plans added` or `no "### Task N:" headings`.
- `docs/HANDOFF.md` stays under about 12 KB, since every session reads it: the current state and the last 5 merges, one line per backlog item with a link, and only the project's own workflow rules. `/orchestra:close-wave` checks its size in the maestro, and the next docs PR trims it.

## 1.9.2

- The delete guard closes the holes an audit found. It now refuses:
  - a wildcard delete in the session's own folder that can reach `.git`: `rm -rf .*`, or PowerShell's `Remove-Item * -Force`, whose `*` matches dot names;
  - nested shells written the usual way: `bash -lc`, `powershell -NoProfile -Command`, Git Bash's `cmd //c`;
  - subshells and groups, such as `(cd /etc && rm -rf ssh)`;
  - prefixes such as `FOO=1`, `env`, `timeout 10` and `nice -n 5`;
  - `Push-Location`, and the `-Path:<path>` form;
  - deletes whose paths come from a pipe or `xargs`, such as `Get-ChildItem … | Remove-Item`. The agent is told to name the paths on the delete itself.
- It no longer refuses deletes under `/tmp` on macOS, whose temp folder is under `/var/folders`, or `cmd /c del /f`, whose `/f` it read as drive F:.

## 1.9.1

- `spec-reviewer` runs on Opus (medium), not Sonnet. In a test of 10 reviewers on one correction of a 12-screen prototype, Opus found more of the 13 serious problems than Sonnet at every effort from medium to xhigh (9 against 2 at medium, in about the same time). Akita's October benchmark saw Sonnet 5.5 miss a planted bug behind an `assert true` test.
- Reviews by agents orchestra doesn't define, the mockup reviewer among them, run at xhigh, not max. In the same test, Opus xhigh found 12 of the 13 and max 10, in 2.5 times the time high took, and Anthropic's effort benchmark also shows max far slower than high. Setting a direction and UX fixes stay at max.

## 1.9.0

- A delete guard for bypass permissions. When Claude Code runs shell commands without asking, orchestra refuses deletes that reach outside the session's folder and the temp folder, of the folder itself or its `.git`, or of a path it cannot read (an unset variable, `$(...)`), and the agent is told to ask the owner instead. It covers `rm`, `Remove-Item`, `rd`, `del`, `rimraf`, `find -delete`, `rsync --delete` and `robocopy /MIR`, in Bash, PowerShell and `cmd /c`. Agents running unattended have wiped home folders through a mis-expanded `$HOME`. In modes that ask before each command, it stays out of the way.

## 1.8.3

- A long workstream name in the band keeps its column wide enough to show it whole, up to 32 characters and what the other columns leave. Past that it ends in an ellipsis. Before, a name wider than its column ran under the status mark.

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
