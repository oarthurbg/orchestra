# Decision inbox: design

Phase 2, item 3 of `docs/ROADMAP.md`. Brainstormed with the owner on 2026-10-30, who picked mockup B, a page in the liveview, over mockup A, answers in the band.

## Goal

One page that answers: which decision is waiting on me, and what do I look at to make it? It lists every question a workstream is waiting on the owner to answer, oldest first, each with its options and the files on that workstream's branch worth looking at. The owner answers in the session itself; the page opens it.

Approved prototype: [`liveview/inbox-prototype.html`](liveview/inbox-prototype.html), with screenshots `liveview/inbox-dark-1440.jpg` and `liveview/inbox-dark-390.jpg`. It was built with taste-skill (the liveview's app style, `achromatic-ledger` on the brand) and checked with its inspector at 1440, 768 and 390 (0 FAIL), impeccable's detector (clean) and impeccable's critique, whose fixes are in.

## Where it lives

- A second view of the liveview page, at `/inbox`. `server.mjs` serves `page.html` for both `/` and `/inbox`; the page picks the view from `location.pathname`. One file keeps one set of tokens.
- The top bar gets two links, `Overview` (`/`) and `Inbox`, the current one on a `--raised` ground. `Inbox` carries a saffron count of waiting questions, hidden at zero, read by screen readers as ", 3 waiting".
- The overview is unchanged.

## Data

### From the band

The band's session file (format `v: 1`, `docs/superpowers/specs/2026-10-30-band-mod-design.md`) gains two fields. Readers that do not know them ignore them, so the format stays `v: 1`.

| Field | Value |
| --- | --- |
| `options` | The labels of the open `AskUserQuestion`'s first question, in order; `[]` when there is none or the wait comes from the `Status:` line. |
| `waitingSince` | ISO time the state last became `waiting`; `null` while not waiting. Kept across rewrites while the state stays `waiting`. |

`detail` keeps its current text (`asks: <question>`, or the `Status:` line's `waiting on:` text).
`shortcut: only the first of several questions in one AskUserQuestion is shown; show a count if sessions start batching questions.`

### From git

`sources.mjs` gains `branchFiles(worktree, integration)`:

- `git diff --name-status <integration>...HEAD` in the workstream's worktree, with the integration ref resolved as `findPlan` does (origin first). Committed files only.
- Kept: added (`A`) or modified (`M`) files that are images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`), `pdf`, `html`, or `md` under `docs/superpowers/specs/` or `docs/superpowers/plans/`.
- Each gets a `kind`: `Mockup` when the path contains `mockup`, `Screenshot` when it contains `screenshot`, otherwise `Image`, `PDF`, `Page` (html), `Spec` or `Plan`; and a `change`: `added` or `changed`.
- Order: pictures first, then pages, PDFs, specs and plans, each by path.
- Cached per worktree while `HEAD` does not move, like the plan lookup.

### In the snapshot

`/api/snapshot` gains `inbox`: one entry per session file in `waiting` state, oldest `waitingSince` first (a missing one sorts last).

```json
{ "session": "<id>", "workstream": "billing", "stage": "build",
  "question": "Approve the invoice mockup, or change how the totals sit?",
  "options": ["Approve as it is", "Move totals above the line items"],
  "since": 1793450000000, "link": "claude://...", "stale": false,
  "files": [{ "n": 0, "path": "docs/mockups/invoice-light.png", "kind": "Mockup", "change": "added", "picture": true }],
  "pr": { "label": "#14", "href": "https://github.com/<owner>/<repo>/pull/14" } }
```

- `question` is `detail` without its `asks: ` prefix.
- `files` comes from `branchFiles` for a registered workstream; an unregistered session or a missing worktree gets `[]`.
- `pr` comes from the report's `pr`. It links when it is an `https://` URL, or `#N` with an `origin` remote on `github.com`; otherwise it is text. `none` or empty gives no PR row.
- `stale` is true when the report is older than 30 minutes (the band's stale rule).

## The file route

`GET /api/file?s=<session id>&n=<index>` serves file `n` of that session's current `files` list, and nothing else.

- The server looks the pair up in the latest snapshot; an unknown session or index is 404. No path ever comes from the request.
- It reads the committed content with `git show HEAD:<path>` in the worktree, as bytes, capped at 20 MB (413 above).
- The type comes from the extension; `md` is served as `text/plain; charset=utf-8`.
- `html` and `svg` get `Content-Security-Policy: sandbox`, so their scripts run in an opaque origin and cannot reach the liveview's API. Every file gets `X-Content-Type-Options: nosniff` and `cache-control: no-store`.
- The existing `Host` check (403) applies to this route too.

## The page

The prototype is the reference for every value it shows; the index, the stale and no-link cards, and the kept "opened" state are specified here only.

- **Title row:** `h1` "3 decisions waiting on you" ("decision" for one; requests count as decisions). The line under it: "**billing has waited longest, 2 h 10 m.** Oldest first. Each answer goes in its own session." No button in the title row.
- **Index:** above 4 questions, a compact list under the title: workstream, the question cut to one line, the wait, each linking to its card.
- **One card per question,** 5fr ask and 7fr evidence, 32px apart:
  - A line with the saffron triangle, the workstream in bold, "`<stage>` stage", and "Waiting 2 h 10 m" on the right, in vermilion past 2 hours. It is a `<time>` whose accessible name says "waiting 2 hours 10 minutes".
  - The question as the card's `h2`, Archivo 800 at 22px (20px on a phone), balanced, clamped at 3 lines with the full text in `title`. A visually hidden "billing asks: " starts it, so heading navigation hears who asks. 22px sits above the overview's 17px card titles on purpose: here the question is the content.
  - The options as one sentence, "It offers **A**, **B**, or **C**." Above 3 options they become a bulleted list. With none: "No options offered: it needs your own words." Options are text, never buttons: nothing is answered here.
  - The evidence: up to two pictures as 16:10 thumbnails cropped from the top, captioned with the file name, each opening the file in a new tab; with one picture, the file list takes the second column. Then the other files as rows (kind, file name with the full path in `title`, `added` or `changed`), at most 5, then "N more on the branch"; then the PR row. With no files and no PR: "**Nothing on the billing branch yet.** The question is all there is; the session has the rest."
  - "Answer in billing", opening the session's `link`. The first card's button is filled; the others are outlined. One primary action per view.
- **After a click:** the card dims and its button becomes "Opened in billing. It leaves the inbox once answered." Kept in `sessionStorage` per session and `waitingSince`, so a reload keeps it and a new question does not inherit it.
- **No link:** the button becomes the text "No link to this session. Open it from the app's sidebar."
- **Stale:** the band's outlined half circle replaces the triangle, and the wait line reads "No report for 42 min; the question may be answered already."
- **Empty:** `h1` "Nothing is waiting on you", the line "Every workstream is working on its own.", and a card: "When a workstream asks you something, its question and the files to look at show up here." with an outlined "Go to the overview".
- **One column** below 900px: ask, evidence, then the button, so the files are seen before answering.
- **Phone** below 640px: the wordmark, the freshness stamp and the three-way theme switch leave the top bar; one "Theme: System" button cycles System, Light and Dark; the freshness stamp moves under the title. Both thumbnails stay, side by side.
- **Refresh, errors and theme:** as the overview: the 5-second poll, "Stale since" and the offline line in the top bar, the theme kept in `localStorage`.

## Changes elsewhere

- **Band** (`hooks/band/register.tsx`): writes `options` from the `AskUserQuestion` input and `waitingSince` on the transition into `waiting`; the band spec's format table gains the two fields.
- **liveview:** `server.mjs` (the `/inbox` and `/api/file` routes), `sources.mjs` (`branchFiles`), `snapshot.mjs` (`inbox`), `page.html` (the view and the nav).
- **README** liveview section: one line on the inbox and on Chrome asking once before it opens `claude://` links.
- **ROADMAP** item 3 links to this spec. Its "read from the transcripts" is replaced by the band's reports.

## Testing

- **Band:** an open `AskUserQuestion` writes its options and `waitingSince`; closing it clears both; a `Status:` wait writes `[]` and keeps `waitingSince` across rewrites.
- **branchFiles:** a seeded repository with a branch that adds a mockup, a screenshot, a spec, a plan, a source file and a deleted image gives exactly the four kept files, in order, with their kinds and changes.
- **Snapshot:** waiting sessions only, oldest first; the `asks: ` prefix stripped; `stale` past 30 minutes; the PR link rules.
- **File route:** serves a listed file's committed bytes; 404 for an unknown session or index and for any `path` parameter; the sandbox header on `html` and `svg`; 403 on a foreign `Host`.
- **Page:** checked in a browser at 1440, 768 and 390, light and dark, with three questions, ten questions (the index), six options, eight files, a stale card, a card without a link, and none.

## Out of scope

- Answering from the page. The band already marks a waiting session; answering stays in the session.
- Files kept outside git, such as scratch mockups.
- The overview's other "needs you" reasons (over 250k, stale, unregistered).
- Keyboard shortcuts to move between cards.
- Sorting by how much work a question blocks.
