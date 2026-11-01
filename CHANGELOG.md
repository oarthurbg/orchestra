# Changelog

What changed in each version of the orchestra plugin. The band's Changelog button opens this page. Older versions are in the [commit history](https://github.com/oarthurbg/orchestra/commits/main).

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
